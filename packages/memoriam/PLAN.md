# Memoriam — technical plan

Memorial sites where multiple family members co-edit, often
asynchronously, across time zones, devices, and patchy connections.
Read-heavy (mourners visit, family edits). One memorial = one site
= one SQLite database.

**Product surface**: rich memorial pages *plus* a collaborative
family-tree layer competing with Geni and MyHeritage. The wedge
vs. those incumbents is that each person in the tree can have a
fully editable memorial page (live, multiplayer, local-first)
rather than a database row with a sad photo slot. The wedge vs.
generic site builders is the genealogy graph: cross-family
linking, GEDCOM import, tree visualization, smart-merge
suggestions.

This is the roadmap; current architecture lives in [CLAUDE.md](./CLAUDE.md).

## Architectural decisions (the forks)

1. **DB-per-site SQLite**. Each memorial gets `data/<site_id>/db.sqlite3`
   + `data/<site_id>/assets/`. Platform DB
   (`data/_platform.sqlite3`) holds cross-site state: `users`,
   `sites`, `site_members`, `domains`, `invites`,
   `platform_sessions`, `short_codes`, plus the genealogy registry
   (`people`, `relationships`, `couples`, `person_memorials`,
   `person_access`). People are platform-level because one person
   can be linked from many memorials.
2. **CRDT-first via Automerge 2.x.** One Automerge doc per
   `documents` row (page, nav, footer); per-site tree doc; per-site
   page-broadcast doc. Public visitors get SSR'd HTML, never load
   Automerge. Trade: ~250 KB gzipped bundle for editors,
   per-character merge for `annotated_text` via `Automerge.splice`.
3. **Local-first storage** via `@automerge/automerge-repo` +
   `IndexedDBStorageAdapter` on the client, `NodeFSStorageAdapter`
   on the server. Explicit save still ships today; continuous
   sync replaces it in Phase 3 v2.
4. **Fork, don't depend.** svedit is vendored at
   `src/lib/svedit/`; the npm dep is dropped. Upstream is a
   one-person project with unresolved licensing.
5. **TypeScript strict everywhere; camelCase in code,
   snake_case in SQL columns and JSON document keys.** Svedit's
   schema-metadata keys (`kind`, `properties`, `node_types`,
   `default_node_type`, `allow_newlines`, `type`) stay as
   svedit dictates. Migration function names (used as IDs in
   `_migrations`) stay as-written for cross-deploy compatibility.
6. **Validation crosses trust boundaries.** arktype at every
   `SQLite row → typed value` and `JSON.parse → typed value`
   boundary via `parseRow` / `parseRowOptional` / `parseRows` /
   `parseJSON` helpers in `db_row.ts`. Server-side error
   composition uses neverthrow's `Result<T, AppError>`; the
   wire format stays as a discriminated union (devalue strips
   class methods).
7. **Deploy target: undecided.** See § Deploy target below.
   Current code (per-site SQLite on a persistent filesystem) is
   shaped for VPS / Fly.io. Decide before Phase 3 v2 because the
   sync server's shape depends on it.

## Phase 1 — Foundation fork ✅

- Per-site SQLite via `getDb(siteId)` + LRU connection cache,
  lazy migrations.
- Per-site assets under `data/<site_id>/assets/`; auth-gated
  asset endpoints; SHA-256 verify on upload; HTTP Range on
  read.
- TypeScript strict pass across `src/lib/server/`, `src/lib/`,
  `src/lib/client/`, route-level files, all Svelte components,
  and vendored svedit. 0 svelte-check errors.
- vitest harness + 74 unit tests; Playwright e2e suite (51
  tests, 0 retries needed).

## Phase 2 — Platform layer ✅

- Platform DB schema with users, sites, members, invites,
  domains, sessions, short_codes, magic-link tokens, plus
  genealogy registry. Foreign keys enabled.
- Tenant resolution in `hooks.server.ts`: custom domain →
  subdomain (`<id>.memoriam.app`) → `MEMORIAM_DEFAULT_SITE_ID`
  fallback.
- Magic-link auth with rate limiting (5/hr/email, 30/hr/IP);
  Resend email delivery; AuthDialog UI; invite accept flow at
  `/auth/invite`.
- Site CRUD UI; member management with role changes, transfer,
  remove (refuses last-owner removal); visibility enforcement
  (private → 404 for non-members).
- Per-site storage quota (1 GiB default, env-configurable);
  short-code redirect endpoint at `/r/<code>`.
- **Family tree feature** (Phases A → C):
  - People as platform-level entities; per-edge `kind` for
    parent edges; `couples` table for marriages.
  - `/sites/[siteId]/tree` route — d3-dag Sugiyama layout,
    Svelte 5 SVG cards, drawer with editable facts.
  - Inline ghost cards for + Parent / + Spouse / + Child;
    delete cascades; URL-mirrored selection (`?focus=`).
  - **Living-relative redaction**: `redactTree` at the load
    boundary; viewers see "Living relative" placeholders,
    admins see full fidelity. Memorial subject is always
    exempt.
  - Per-edge type chip (A / F / S / ?); multi-marriage badge.
  - Hand-rolled GEDCOM 7 import + export (browser-safe parser,
    server-side reducer).
  - Fan-chart fallback at `?view=fan`; toggle is `<a href>`
    links so it works pre-hydration.
- **App UI translation (EN + PL) via Paraglide JS.** Cookie-based
  locale (`PARAGLIDE_LOCALE`), no URL prefix.

## Phase 3 — Multiplayer + local-first

- [x] **Tree multiplayer MVP** — per-site Automerge tree doc;
  WebSocket sync endpoint at `/ws/automerge?site=<id>` with
  cookie + role check before upgrade. Tree page stays
  SQLite-rendered; doc is the broadcast channel.
- [x] **Page-edit broadcast MVP** — per-site Automerge "broadcast"
  doc; `saveDocument` / `updatePageSlug` / `deletePage` tick
  `updated_at`; other tabs `invalidateAll()` on change.
- [x] **svedit ↔ Automerge per-document binding (Option A)** —
  `Session.attach_automerge_handle(handle, splice_fn)` mirrors
  every transaction's `ops` into the bound doc via
  `handle.change()`; `#applying_remote` re-entry guard; remote
  change → `this.doc.nodes` replace (with shallow-equal dedup).
  Per-character text merge via `Automerge.splice` for
  `annotated_text` properties; `#mirroring_locally` guard
  prevents the local-echo from re-rendering the contenteditable
  mid-keystroke. Per-document doc URL stored in
  `document_automerge_docs`; bootstrap from SQLite on first
  open.
- [x] **JSDoc → TS conversion of vendored svedit.** Real
  TypeScript syntax across all `.svelte.ts` files and Svelte
  components; arktype validation at SQLite + JSON boundaries
  in `api.remote.ts`, `members.ts`, `people.ts`, `sites.ts`,
  `automerge_server.ts`.

### Phase 3 v2 — CRDT-authoritative (in flight)

Once `saveDocument` is replaced by continuous sync, the explicit
save button goes away and the local-first promise (offline edits
that converge on reconnect) actually holds. The pieces:

- [ ] **Cursor preservation across remote patches.**
  `#on_automerge_change` currently wholesale-replaces
  `this.doc.nodes`; the DOM selection survives only when the
  text nodes' identity does. Switch to a patch-applying path
  that mutates per-key so the local caret stays put when a
  peer types upstream.
- [ ] **RichText for annotations.** Today `annotations` is
  replaced as a whole array; concurrent edits in the same
  paragraph can stomp each other's marks. Migrate the array to
  Automerge marks (`{ name: 'strong' }`,
  `{ name: 'link', value: { href, target } }`); the
  mark-value pattern replaces the upstream's
  "annotation-references-a-link-node" indirection.
- [ ] **Replace save with continuous sync.**
  `SaveProgressModal` becomes a sync-status indicator
  (connected / syncing / offline). `saveDocument` and friends
  stop running on user action; the doc IS the source of truth.
- [ ] **Asset upload on paste/drop.** Hash + dedupe + upload
  immediately, write the `asset_id` into the doc, keep the
  blob URL as the optimistic render until upload completes.
- [ ] **Automerge history undo.** Replace svedit's transaction
  stack with `Automerge.getHeads` + `Automerge.applyChanges`
  inverse. Less mature than `Y.UndoManager`; budget extra
  time or ship "undo last local change" semantics for v1.
- [ ] **Sync conflict tests.** Multi-client fuzz harness:
  N repos against a sync server, random ops, simulated
  partitions and reconnects, verify convergence + schema
  invariants. CRDT bugs are nasty; the test infra is half the
  work.

### Phase 3 type-safety follow-ups

From [TYPE_AUDIT.md](./TYPE_AUDIT.md). Ordered by effort/value:

- [x] §B1 — drop vestigial `session as unknown as { ... }` casts
  in `Command.svelte.ts`.
- [x] §A1 — arktype-validate `JSON.parse(documents.data)` via
  `parseJSON(DocumentDataSchema, ...)`.
- [ ] §B4 — discriminate `inspect()`'s return type
  (`{ kind: 'property'; type; node_types?; ... } | { kind:
  'node'; id; type; properties; ... }`). Removes 3 force-casts
  and improves IDE narrowing across all callers.
- [ ] §B3 — export `SveditContext` so `create_gap_computation`
  can widen instead of being cast through `unknown`.
- [ ] §D — tighten `app_utils.ts`'s file-local node shapes.
- [ ] §E — audit the 2 risky non-null assertions in
  `Transaction.svelte.ts:281` and `Overlays.svelte:223`.
- [ ] §F — flip `noUncheckedIndexedAccess: true`. Multi-day
  migration; catches the same hydration-race bug class we fixed
  in §A1.

## Phase 4 — Collaboration UX

- [ ] Multiplayer cursors via a presence side-channel
  multiplexed onto the existing `automerge-repo` WebSocket.
  `{ user_id, name, color, selection }` broadcast on selection
  changes; ephemeral; never persisted.
- [ ] "X is here" indicators in the page list.
- [ ] Optimistic edit attribution (who last touched each block,
  stored in CRDT alongside content).
- [ ] Comment threads anchored to nodes. Separate doc per page
  so content edits don't fight with threaded conversations.
- [ ] Mobile editing pass. With collab + offline, mobile becomes
  a primary surface (aunt on a plane writing a eulogy).

## Phase 5 — Memorial-specific features

Sequence loosely; each is independent.

- [ ] **Timeline / life-events block.** Array of
  `{ date, title, description, media }`; vertical timeline
  with year markers.
- [ ] **Family tree, v2 follow-ups:** cross-tree linking
  (two users overlap on the same person, propose merge),
  smart matching (fuzzy name + dates + place + relationship
  context), tree-specific privacy controls, source documents
  (scanned certificates, census records — stored
  platform-level since they belong to the person not the
  memorial), per-person aliases.
- [ ] **Guestbook / condolences.** Append-only, owner-moderated.
- [ ] **Audio block.** Eulogies, voice memos, recorded
  interviews. MP3/Opus, server-side waveform for the player UI.
- [ ] **Photo gallery improvements.** Date grouping, EXIF
  extraction, optional map view. Face recognition is deferred —
  privacy-sensitive territory.
- [ ] **Anniversary reminders.** Per-user opt-in emails.
- [ ] **Memorial book PDF export.** Print-ready PDF from site
  content. Paid feature?
- [x] **QR codes for engraving.** Vector SVG + print-ready PDF
  in three preset sizes (card / plaque / headstone). Encodes
  `/r/<code>` short URLs so domain or architecture changes
  don't invalidate the engraving.
- [ ] **QR codes — deferred follow-ups.** Bleed marks (paper
  only), low-contrast warning (granite engraving), audit log
  of generations against `short_codes` rows.
- [ ] **Full archival export.** ZIP of the SQLite DB + assets
  directory. "Your memorial, your data, forever."
- [ ] **Custom domains.** Resolve via `domains` table; Caddy
  on-demand TLS handles cert provisioning.
- [ ] **Explicitly out of scope:** DNA matching (regulated
  industry, different costs), ethnicity estimates, historical
  record databases (we don't license census corpora).

## Phase 6 — Operational hardening

Checklist that gates production launch. Not a phase you "do".

- [ ] Per-site automated backups (cron `cp -r` to S3 / R2 /
  Backblaze).
- [ ] Test coverage to ~70% on `src/lib/server/`, auth flow,
  asset endpoints, CRDT binding.
- [ ] Monitoring: per-site disk usage, sync server connection
  count, error rates by site_id.
- [ ] Image format upgrade: AVIF in addition to WebP.
- [ ] Constant-time comparison on every remaining secret
  equality check (invite tokens, magic-link tokens).
- [ ] CSRF on remote-function commands (verify SvelteKit's
  `experimental.remoteFunctions` includes it).
- [ ] Privacy policy + GDPR delete flow ("delete this memorial"
  hard-removes the per-site DB + assets + all backups within
  30 days).
- [ ] Pricing / quota enforcement. Free tier (1 site, 500 MB)
  vs. paid (unlimited sites, 10 GB each, custom domain).
  Stripe.

## Deploy target

Decision needed before Phase 3 v2. Current code shape (per-site
SQLite + filesystem assets) fits Fly.io / VPS unchanged.

### A. Fly.io / VPS (current shape)

Single Node process + persistent volume. `node:sqlite` on disk,
filesystem assets, `automerge-repo` with `NodeFSStorageAdapter`,
WebSocket relay as a SvelteKit endpoint. Zero rework, cheapest
at MVP scale, single-region, ops are on us. **Recommended if
shipping fast matters.**

### B. Cloudflare (Workers + D1 + R2 + Durable Objects)

Workers for HTTP, Durable Objects (one per active page) holding
Automerge state with WebSocket hibernation. D1 per site, R2 for
assets. Multi-region by default. **2-4 weeks of rework** on
`node:sqlite` → D1 and filesystem → R2; the architectural shape
stays. Better as a v2 migration once A has validated the
product.

### C. Vercel (Functions + Turso + external sync)

Worst fit. Vercel WebSocket support is limited; we'd run a
second host just for sync. Read-heavy + asset-heavy profile
fights Vercel's strengths. Skip unless team familiarity is the
deciding factor.

## What we explicitly will not do

- **No multi-region** at MVP. Switch to Turso later if needed.
- **No realtime video / live streams.** Different product.
- **No social network features.** No follow, feed,
  recommendations.
- **No federated identity.** Magic link + Google. No
  SAML/SSO/Apple/Facebook/Twitter.
- **No public API in v1.** Add when a partner needs it.
- **No DNA matching, ethnicity, licensed corpora.** Different
  industry, different costs, regulatory exposure.

## Risk register

- **CRDT binding effort overrun** (HIGH). Phase 3 v2 cursor
  preservation + RichText annotations + history-based undo are
  the load-bearing items. Worst case: ship v1 with the current
  wholesale-replace and "undo last local change" semantics.
- **Genealogy expands surface area** (HIGH). Cross-tree
  merging, GEDCOM round-trip edge cases, per-person privacy
  all add up. Risk is building a mediocre tree feature that
  loses to Geni rather than shipping a great memorial feature.
  Sequence carefully — memorials need to feel done first.
- **Per-site SQLite file-descriptor pressure** (MEDIUM).
  Mitigate via LRU eviction, smaller default cache, monitoring
  on ulimit headroom.
- **Asset storage growth** (MEDIUM). Memorials are photo-heavy.
  Plan for object storage (S3/R2) migration in Phase 6+.
- **Grief is a sensitive context** (HIGH). Bugs that delete
  someone's grandmother's photos are not the same as bugs in a
  task tracker. Test coverage + backup hygiene are not optional.
- **Engraved URLs are forever** (HIGH). Once a QR is etched on
  granite, the short code must resolve correctly for decades.
  Constrains every architectural change downstream: domain
  swaps need redirects, `short_codes` migrations preserve
  every row, shutdown is not a clean option. Mitigation: keep
  the redirect endpoint tiny and portable; mirror
  `short_codes` to an off-platform store; document the
  recovery story in the ToS.
- **svedit license uncertainty** (HIGH). Vendored already.
  Conversation with the author needed before launch; worst
  case is a permanent fork (already prepared).

## Open questions

- Subdomain vs path-based tenant routing for free tier?
- Owners pay, or "gift to family" model where one person pays
  and invites others?
- Comment moderation: pre-publish review default, or
  post-publish with takedown?
- Long-term storage promise — once QR codes ship for engraving,
  "we'll keep this online forever" becomes a hard commitment:
  - Escrow plan for `short_codes` mirror + redirect endpoint
    code if we shut down?
  - Minimum sunset period (e.g. 5 years guaranteed redirect
    post-shutdown)?
  - Pricing model that funds the redirect endpoint
    independently of editing infra — one-time "perpetuity fee"
    per QR issued? Endowment-style?
  - Open-source the redirect endpoint + short-code format so
    the community can keep it running if we vanish?
