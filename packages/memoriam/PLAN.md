# Memoriam — technical plan

Memorial sites where multiple family members co-edit, often asynchronously,
across time zones, devices, and patchy connections. Read-heavy (mourners
visit, family edits). One memorial = one site = one SQLite database.

This document plans the path from the vendored `editable-website` fork
(commit `35e3b65`) toward a production multi-tenant SaaS.

## Architectural decisions (the forks)

These are the load-bearing choices everything else hangs off. Decide before
writing fork code.

1. **DB-per-site SQLite**, not per-tenant column. Each memorial gets
   `data/<site_id>/db.sqlite3` + `data/<site_id>/assets/`. A separate
   platform DB (`data/_platform.sqlite3`) holds `users`, `sites`,
   `site_members`, `domains`, `invites`, `sessions`. Per-site `sessions`
   and `ADMIN_PASSWORD` from the upstream are deleted; auth becomes
   platform-level.
2. **CRDT-first document model** via Automerge 2.x. One Automerge doc
   per page, one shared Automerge doc for nav+footer per site,
   conventional SQLite for the site index (page list, slugs,
   cross-page refs). Public visitors never load Automerge — they get
   SSR'd HTML. Automerge's mark-based RichText handles the
   `annotated_text` annotation-as-reference problem natively (marks
   can carry structured values like `{ href, target }`), avoiding the
   awkward side-array dance a Yjs binding would require. Trade: ~250
   KB gzipped bundle for editors (acceptable for this read-heavy
   product), no built-in awareness primitive (presence ships on a
   separate websocket channel).
3. **Local-first storage** via `@automerge/automerge-repo` with
   `automerge-repo-storage-indexeddb` on the client. The server is
   a sync relay + persistence (`automerge-repo-storage-nodefs` or
   per-site SQLite blob storage), not the source of truth at edit
   time. Explicit "save" goes away; deltas flow continuously.
4. **Fork, don't depend.** The svedit + editable-website license is
   unresolved and the upstream is a one-person project. Vendor both,
   accept the maintenance cost, contribute back only what's mutually
   useful.
5. **TypeScript, strict.** Drop the JSDoc-with-`strict:false` middle
   ground. Convert during the fork phase while the code is still small
   and we're touching everything anyway.

## Phase 0 — Spikes (1 week, throwaway)

Two weekend spikes to de-risk before committing to phase 1. If either
fails the plan changes shape.

- **Spike A — Svedit + Automerge binding.** Bind a single `prose` block
  (text with `strong`/`emphasis` annotations, then add `link` to test
  the mark-with-value path). Measure: does the Svedit selection model
  survive concurrent inserts from a peer? How clean is mapping
  `annotated_text` → Automerge RichText with marks? Bail criterion:
  if the binding requires forking svedit core, the fallback is **not**
  Tiptap+Yjs (would force abandoning Automerge — `automerge-prosemirror`
  exists but is less mature than y-prosemirror) but rather building
  the block editor directly on Automerge primitives ourselves. That's
  a bigger lift; weight it carefully before bailing.
- **Spike B — Per-site SQLite at scale.** Open 1,000 SQLite files via a
  LRU connection cache. Measure: cold-open latency, memory per
  connection, LRU eviction behavior, file-descriptor pressure under
  load. Cheap insurance against "this works at 10 sites but melts at
  500."

Output of phase 0: go/no-go decision + a concrete shape for the binding.

## Phase 1 — Foundation fork (2 weeks)

Get the vendored code into a shape we can build on. No new features.

- [ ] Vendor `svedit` into `packages/svedit-vendored/` and re-point the
      memoriam import.
- [ ] TypeScript migration. `strict: true`. Start with `src/lib/server/`
      and `src/lib/*.js`, then routes, then components last.
- [ ] Kill `src/lib/server/db.js` singleton. Replace with
      `get_db(site_id)` backed by an LRU cache (key: site_id, value:
      `DatabaseSync` instance + last-access timestamp, eviction at e.g.
      256 open connections). Touches every call site in `api.remote.js`.
- [ ] Per-site asset paths. `ASSET_PATH` becomes
      `join(DATA_DIR, site_id, 'assets')`. Update
      `src/lib/server/asset_storage.js` to take `site_id`.
- [ ] Lazy per-site migrations. On `get_db(site_id)`, check
      `PRAGMA user_version`, run any pending migrations, set version.
      Cache "this site is up to date" in memory.
- [ ] **Security fix:** auth-gate `POST /api/assets`,
      `POST /api/assets/[id]/variants`, and `DELETE /api/assets/[id]`.
      Verify `X-Content-Hash` matches the body (compute SHA-256
      server-side during stream-to-disk, reject if mismatch).
- [ ] Fix Range header support in `src/routes/assets/[...path]/+server.js`
      so videos seek properly (currently sets `Accept-Ranges: bytes`
      without honoring the header).
- [ ] Replace `sleep_sync(100)` in `migrate.js` with a real timestamp
      collision fix (incrementing suffix, or use rowid order).
- [ ] Delete `eslint.config.js.orig`, trim `ARCHITECTURE.md` /
      `IMPLEMENTATION_PLAN.md` of duplication, drop the AI-written
      sprawl.
- [ ] Set up test infrastructure: `vitest` + `@playwright/test`. No
      tests yet; just the harness.

## Phase 2 — Platform layer (2 weeks)

The piece that doesn't exist upstream. Multi-user, multi-site, with
tenant routing.

- [ ] Platform DB schema: `users`, `sites`, `site_members` (user_id,
      site_id, role: owner/editor/viewer), `domains` (custom domain →
      site_id), `invites`, `platform_sessions`.
- [ ] Auth: email magic link (lowest friction for grieving families,
      no password to forget). `nodemailer` + Resend or Postmark for
      transactional. Optional Google OAuth as second method.
- [ ] Site creation flow. New memorial = generate site_id, create
      `data/<site_id>/`, run migrations, seed with a default page, add
      creator as owner in `site_members`.
- [ ] Tenant resolution in `hooks.server.js`. Order: custom domain
      lookup → subdomain (`<site_id>.memoriam.app`) → fallback. Stash
      `event.locals.site_id` and `event.locals.db`.
- [ ] Member management UI: invite by email, accept invite, role
      changes, leave site, transfer ownership.
- [ ] Visibility levels per site: public, unlisted (link only),
      private (invited members only). Enforced in
      `hooks.server.js` before serving page HTML.
- [ ] Per-site storage quota tracking (sum asset bytes from disk on
      cron, store in platform DB, enforce on upload).
- [ ] Rate limiting on auth endpoints (per IP + per email).
- [ ] **Permanent short URLs.** `short_codes` table in the platform DB:
      `(code TEXT PRIMARY KEY, site_id, created_at, target_path)`.
      Codes are forever — never reassigned, never deleted, even if the
      underlying site is deleted (then resolves to a tombstone page).
      Resolved by a dedicated `/r/<code>` redirect endpoint kept
      deliberately small and dependency-light, so it can be moved to a
      Cloudflare Worker / standalone process and survive outages of the
      main app. This is the URL we'll print on physical objects
      (phase 5 QR feature). Get this table right *now* — every code
      issued is a permanent commitment.

## Phase 3 — CRDT + local-first (3-4 weeks)

The architectural switch. This is the largest single chunk of work and
the highest-risk one.

- [ ] Write the Svedit ↔ Automerge binding. Per-page doc shape:
      a top-level map with `nodes` (map of id → node map), node_array
      properties as Automerge lists of string ids, scalars as plain
      properties, `annotated_text` as Automerge RichText with marks
      (`{ name: 'strong' }`, `{ name: 'emphasis' }`,
      `{ name: 'link', value: { href, target } }`). The mark-value
      approach replaces the upstream's "annotation references a link
      node" indirection — link annotations no longer need a separate
      node in the node map. Note this schema simplification in the
      migration code.
- [ ] Replace Svedit's transaction `apply` with an
      `Automerge.change(doc, d => ...)` call. Svedit's session state
      mirrors the materialized Automerge doc; subscribe to repo
      changes to push patches back into Svedit's reactive state.
- [ ] Replace Svedit's undo stack with Automerge's history-based
      undo (track per-actor change heads; "undo" = applying the
      inverse of the last local change set). Less mature than
      `Y.UndoManager` — budget extra time here, or accept simpler
      "undo last local change" semantics for v1.
- [ ] Post-merge schema GC pass: walks the graph, prunes dangling
      `node` / `node_array` references, enforces schema arity. Less
      relevant for annotations now that they're mark-values, but
      still needed for node_array deletes that strand referenced
      nodes.
- [ ] `automerge-repo-storage-indexeddb` adapter on the client.
- [ ] Sync server: mount `automerge-repo` with the websocket network
      adapter as a SvelteKit `/ws/[site_id]/[page_id]` endpoint. For
      storage, either `automerge-repo-storage-nodefs` writing to
      `data/<site_id>/automerge/` or a custom adapter that stores
      doc binaries as BLOBs in the per-site SQLite (`page_docs`
      table). SQLite-backed storage keeps the "everything for a site
      lives in one directory + one DB" invariant; nodefs is simpler.
      Decide during this phase based on backup ergonomics.
- [ ] Replace explicit "save" with continuous sync. The save button
      goes away. `SaveProgressModal` becomes a sync status indicator
      (connected / syncing / offline / conflicts).
- [ ] Asset upload flow rewrite: hash + dedupe + upload happens
      immediately on paste/drop, the resulting `asset_id` is written
      into the Automerge doc, blob URL is the optimistic local-only
      render until upload completes. No more "swap blob → asset on
      save."
- [ ] Sync conflict tests: multi-client fuzz harness that creates N
      Automerge repos against a sync server, performs random ops with
      simulated partitions and reconnects, verifies convergence and
      schema invariants post-merge. CRDT bugs are nasty — test
      infrastructure is half the work.

## Phase 4 — Collaboration UX (1-2 weeks)

Building on the CRDT foundation to make co-editing feel right.

- [ ] Multiplayer cursors via a side-channel presence protocol —
      Automerge has no built-in awareness primitive. Reuse the
      websocket connection that `automerge-repo` already holds open
      and multiplex a presence channel alongside the sync channel.
      Broadcast `{ user_id, name, color, selection }` on selection
      changes; ephemeral, never persisted, dropped on disconnect.
      Disable in view mode.
- [ ] "X is here" indicators in the page list.
- [ ] Optimistic edit attribution: show who last touched each block
      (stored in CRDT alongside content, not as separate metadata).
- [ ] Comment threads anchored to nodes (separate Y.Doc per page for
      comments, kept separate so content edits don't fight with
      threaded conversations).
- [ ] Mobile editing pass. The upstream has experimental mobile
      support; with collab + offline, mobile becomes a primary
      surface (aunt on a plane writing a eulogy).

## Phase 5 — Memorial-specific features (ongoing)

The product layer that justifies why this isn't just generic Webflow.
Sequence loosely; each is independent.

- [ ] **Timeline / life events block.** Schema: array of `{ date,
      title, description, media }`. Renders as a vertical timeline
      with year markers. Common ask for memorials.
- [ ] **Family tree block.** Lightweight tree of `{ name, relation,
      link_to_their_memorial? }`. Cross-memorial links are a network
      effect — if Grandma's memorial links to Grandpa's memorial,
      both pages benefit.
- [ ] **Guestbook / condolences.** Append-only, moderated by site
      owners. Can be a separate Y.Doc or just a SQLite table —
      condolences don't need rich co-editing.
- [ ] **Audio block.** Eulogies, voice memos, recorded interviews
      with the deceased. MP3/Opus, server-side waveform generation
      for the player UI.
- [ ] **Photo gallery improvements.** Date grouping, EXIF extraction
      for time + location, optional map view of where photos were
      taken. Faces? Maybe later — privacy-sensitive territory.
- [ ] **Anniversary reminders.** Per-user opt-in emails: "It's been
      a year since X's memorial was created." Drives return visits
      and re-edits.
- [ ] **Memorial book PDF export.** Generate a print-ready PDF from
      the site content. High-value product hook (paid feature?
      gifted to family?).
- [ ] **QR codes for engraving.** Generate scannable codes pointing
      to the permanent short URL (`mmr.am/<code>` from phase 2), in
      print-ready formats for stonemasons and plaque engravers.
      Specifics:
      - Encode the short URL, not the canonical site URL. The short
        code is our permanent point of indirection — domain or
        architecture changes don't invalidate the engraving.
      - Error correction level **H** (~30% damage tolerance). Outdoor
        granite weathers; lichen grows; rain etches. Don't ship L or M.
      - SVG primary export (vector, infinite scale, what engravers
        want). PDF secondary with bleed marks, dimension labels, and
        the human-readable URL printed below the QR as fallback for
        scanners that fail.
      - Three preset sizes: memorial card (~25mm), plaque (~50mm),
        headstone (~80-100mm). Each preset enforces a minimum module
        count so the engraver doesn't shrink it below the readable
        threshold.
      - Warn in the UI when the medium is low-contrast (engraved
        grey-on-grey granite barely works — recommend an inset of
        contrasting material, or accept reduced scannability).
      - Owner-only download. Log every QR generation against the
        `short_codes` row (which medium, when) — useful for support
        ("the QR on my mother's grave doesn't work") and for the
        long-term commitment audit trail.
- [ ] **Full archival export.** ZIP of the SQLite DB + assets
      directory. "Your memorial, your data, forever."
- [ ] **Multi-language.** Families spread across countries.
      Per-page language tags, optional auto-translation suggestions
      via an LLM (cheap, low-stakes — owner reviews before
      publishing).
- [ ] **Custom domains.** Resolve `memorial.smithfamily.com` →
      site_id via `domains` table. Caddy on-demand TLS in front
      of SvelteKit handles cert provisioning.

## Phase 6 — Operational hardening (cross-cutting)

Not a phase you "do" — checklist that gates production launch.

- [ ] Per-site automated backups (cron `cp -r` to S3 / R2 / Backblaze).
- [ ] Test coverage. Aim for ~70% on `src/lib/server/`, the auth flow,
      the asset endpoints, and the CRDT binding. Don't bother with
      Svelte component tests beyond smoke.
- [ ] Monitoring: per-site disk usage, sync server connection count,
      error rates by site_id (for "your site is broken" support).
- [ ] Image format upgrade: AVIF in addition to WebP for the variant
      pipeline. Substantial size win on modern browsers.
- [ ] Constant-time comparison anywhere that's still doing string
      equality on secrets (invite tokens, magic-link tokens).
- [ ] CSRF on remote-function commands (verify SvelteKit's
      `experimental.remoteFunctions` includes CSRF — if not, add it).
- [ ] Privacy policy + GDPR delete flow ("delete this memorial"
      hard-removes the per-site DB + asset directory + all backups
      within 30 days).
- [ ] Pricing / quota enforcement: free tier (1 site, 500 MB), paid
      tier (unlimited sites, 10 GB each, custom domain). Hook into
      Stripe.

## What we explicitly will not do

Worth writing down so we don't drift.

- **No multi-region.** SQLite-per-site + Fly volume is single-region
  by design. If/when this matters, switch to Turso (`@libsql/client`
  is a small swap) rather than building our own replication.
- **No realtime video calls / live streams.** Memorial sites are
  async by nature. Real-time video is a different product.
- **No social network features.** No follows, no feed, no
  recommendations. Each memorial is its own thing.
- **No federated identity.** Magic link + Google. No "sign in with
  Apple/Facebook/Twitter," no SAML/SSO.
- **No public API in v1.** Add when a partner needs it.

## Risk register

- **Svedit license uncertainty** (HIGH). Need a conversation with the
  author before launch. Worst case: maintain a permanent fork.
- **CRDT binding effort overrun** (HIGH). Spike A is the load-bearing
  de-risk. If Spike A bails out, the fallback is building the block
  editor directly on Automerge primitives (we keep the CRDT choice,
  lose the editor head-start). Switching CRDTs at this point would
  also bail on the `annotated_text` mark-value mapping that was a
  reason to pick Automerge — don't fall back to Yjs without
  re-litigating the whole decision.
- **Automerge undo maturity** (LOW-MEDIUM). The history-based undo
  story is less polished than `Y.UndoManager`. Worst case: v1 ships
  with simple "undo last local change" semantics and richer undo
  comes later. Acceptable degradation.
- **Per-site SQLite file-descriptor pressure** (MEDIUM). Spike B
  measures it. Mitigation: aggressive LRU eviction, smaller default
  cache size, monitoring on ulimit headroom.
- **Asset storage growth** (MEDIUM). Memorials are photo-heavy.
  Plan for object storage (S3/R2) migration in phase 6+ if Fly
  volumes get expensive.
- **Grief is a sensitive context** (HIGH). Bugs that delete
  someone's grandmother's photos are not the same as bugs in a
  task tracker. Test coverage and backup hygiene are not optional.
- **Engraved URLs are forever** (HIGH). Once a QR is etched on
  granite, that short code must resolve correctly for decades. This
  constrains every architectural change downstream: domain swaps
  need a redirect, table migrations on `short_codes` need to
  preserve every row, shutdown is not a clean option (see below).
  Mitigation: keep the redirect endpoint tiny and portable, mirror
  `short_codes` to an off-platform store (e.g. a public git repo or
  IPFS), document the recovery story in the ToS.

## Open questions

- Subdomain vs path-based tenant routing for free tier? (Subdomain
  is cleaner UX but needs wildcard TLS.)
- Do owners pay, or is it a "gift to family" model where one person
  pays and invites others?
- Comment moderation: pre-publish review by default, or post-publish
  with takedown?
- Long-term storage promise: "we'll keep this online forever" is
  emotionally weighted, and once we ship QR codes for engraving it
  becomes a hard commitment, not a promise. Concrete policy needed
  *before* the first QR is downloaded:
  - Escrow plan: which third party holds the `short_codes` mirror
    and the redirect-endpoint code if we shut down?
  - Minimum sunset period (e.g. 5 years guaranteed redirect even
    after shutdown).
  - Pricing model that funds the redirect endpoint independently
    of editing infra — one-time "perpetuity fee" per QR issued?
    Endowment-style?
  - Open-source the redirect endpoint + short-code format so the
    community can keep it running if we vanish.
