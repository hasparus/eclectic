# Memoriam — technical plan

Memorial sites where multiple family members co-edit, often
asynchronously, across time zones, devices, and patchy connections.
Read-heavy (mourners visit, family edits). One memorial = one site =
one SQLite database.

**Product surface** (expanded scope): rich memorial pages *plus* a
collaborative family-tree layer competing with Geni and MyHeritage.
The wedge vs. those incumbents is that each person in the tree can
have a fully editable memorial page (live, multiplayer, local-first)
rather than a database row with a sad photo slot. The wedge vs.
generic site builders is the genealogy graph: cross-family linking,
GEDCOM import, tree visualization, smart-merge suggestions.

This document plans the path from the vendored `editable-website`
fork (commit `35e3b65`) toward production.

## Architectural decisions (the forks)

These are the load-bearing choices everything else hangs off. Decide before
writing fork code.

1. **DB-per-site SQLite**, not per-tenant column. Each memorial gets
   `data/<site_id>/db.sqlite3` + `data/<site_id>/assets/`. A separate
   platform DB (`data/_platform.sqlite3`) holds `users`, `sites`,
   `site_members`, `domains`, `invites`, `sessions`, `short_codes`,
   and the **genealogy registry** (`people`, `person_aliases`,
   `relationships`, `person_memorials`, `person_access`). Per-site
   `sessions` and `ADMIN_PASSWORD` from the upstream are deleted;
   auth becomes platform-level. The cross-cutting genealogy data
   lives in the platform DB because it is intrinsically cross-site —
   one person can be linked from many memorials.
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
5. **TypeScript, strict. camelCase in code, snake_case in
   storage.** Drop the JSDoc-with-`strict:false` middle ground.
   Convert during the fork phase while the code is still small.
   Same pass flips JS/TS identifiers to idiomatic camelCase
   (functions, variables) / PascalCase (types, components). **SQL
   column / table names and our JSON document keys stay
   snake_case** — that's SQL idiom and is worth respecting for the
   SQL-CLI / future-hire intelligibility. Boundary mapping
   (`row.created_at` → JS-side `createdAt` if you want it) is done
   explicitly at the destructuring site, not via convention. Other
   exceptions:
   - Svedit's own schema-metadata keys (`kind`, `properties`,
     `node_types`, `default_node_type`, `allow_newlines`, `type`)
     are svedit's contract.
   - Migration function names (used as IDs in `_migrations`) stay
     as-written for cross-deploy compatibility.
6. **Deploy target: undecided.** See § Deploy target below. The
   current code (per-site SQLite on a persistent filesystem) is
   shaped for a VPS or Fly.io. Cloudflare and Vercel are real
   options but require deeper rework; pick before Phase 3 because
   the Automerge sync server's shape depends on it.

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

- [x] Kill `src/lib/server/db.js` singleton. Replace with
      `getDb(siteId)` backed by an LRU cache (256-cap, eviction
      closes connections). Lazy migrations on first open per site.
- [x] Per-site asset paths under `data/sites/<site_id>/assets/`.
- [x] Lazy per-site migrations.
- [x] **Security:** auth-gate `POST /api/assets`,
      `POST /api/assets/[id]/variants`, `DELETE /api/assets/[id]`.
      `POST /api/assets` verifies SHA-256 of streamed body matches
      `X-Content-Hash`, rejects + cleans up on mismatch.
- [x] HTTP Range support for videos in `/assets/[...path]` (206 +
      416).
- [x] Replace `sleep_sync(100)` in `migrate.js` with a monotonic
      suffix on timestamps.
- [x] Delete `eslint.config.js.orig`, ARCHITECTURE.md, and
      IMPLEMENTATION_PLAN.md (the latter two were upstream AI
      sprawl).
- [x] Test infrastructure: vitest harness, 9 smoke tests covering
      per-site DB isolation, lazy migrations, invalid-id rejection,
      `constantTimeEqual`. Playwright deferred — no Svelte
      component tests yet.
- [x] Constant-time password comparison in `loginAdmin` (moved up
      from Phase 6).
- [x] TypeScript migration, `strict: true`, for:
      `src/lib/server/`, `src/lib/server_config`, `src/lib/*` (incl.
      `api.remote.ts` — accepted ~50 strict residual errors in
      svedit-adjacent surfaces), `src/lib/client/`, route-level
      `.js` files including `create_session.ts`. snake_case stays
      for SQL columns, our JSON document keys (`focal_point_x`,
      etc.), and svedit's schema contract.
- [ ] **TypeScript migration: components.** ~17 `.svelte` files,
      `create_session.ts`'s residual, `commands.svelte.js`, and
      `page_browser_context.svelte.js`. ~200 strict errors at
      baseline, mostly implicit-any on props/event handlers and
      svedit's `session.selection` shape. Substantial work — own
      session.
- [ ] **Vendor `svedit`** into `packages/svedit-vendored/`. Defer
      until Phase 3 — the Automerge binding will reshape svedit's
      integration surface anyway, vendoring before that means
      doing the work twice. Phase 0 Spike A will surface whether
      vendoring + a few patches is enough or a deeper fork is
      needed.

## Phase 2 — Platform layer (2 weeks)

The piece that doesn't exist upstream. Multi-user, multi-site, with
tenant routing.

- [x] Platform DB schema — `_platform.sqlite3` next to per-site DBs.
      Tables: `users`, `sites`, `site_members`, `domains`, `invites`,
      `platform_sessions`, `magic_link_tokens`, `short_codes`. Plus
      the genealogy registry: `people`, `person_aliases`,
      `relationships`, `person_memorials`, `person_access`. SQL
      idiomatic snake_case, foreign keys enabled. People are
      platform-level because they cross sites; memorial content
      stays in the per-site DB.
- [x] Tenant resolution in `hooks.server.js`. Order: custom domain
      lookup → subdomain (`<site_id>.memoriam.app`, configurable via
      `MEMORIAM_HOST_SUFFIX`) → `MEMORIAM_DEFAULT_SITE_ID` fallback.
      Stashes `event.locals.siteId`, `event.locals.db`,
      `event.locals.platformDb`, `event.locals.userId`, and
      `event.locals.isAdmin` (derived from membership role).
- [x] Site creation backend (`createSite`). Allocates a site_id
      (nanoid or caller's preference), inserts `sites` +
      `site_members(role=owner)` rows in one platform transaction,
      then opens the per-site DB which lazily runs the per-site
      initial migration (seeds nav + footer + home page).
- [x] Magic-link auth backend (`requestMagicLink`,
      `consumeMagicLinkToken`, `/auth/magic` route). Tokens are
      256-bit URL-safe base64, single-use, 15-minute TTL. Replaces
      the old single-password admin model entirely. Dev mode logs
      the magic link to stdout; transactional email integration
      (Resend / Postmark) is the remaining step.
- [x] Platform session model. Replaces per-site `sessions` table
      (dropped in a per-site migration). Cookie is `mm_session`,
      14-day sliding window, opaque session id keyed in
      `platform_sessions`.
- [x] **Permanent short URLs table** (`short_codes`). The actual
      `/r/<code>` redirect endpoint + QR generation are still TODO
      (Phase 5 work); the persistent table that backs them is in
      place now so every issued code is durable from day one.
- [x] AuthDialog UI updated to the email + magic-link flow (sends
      link, shows "check your email" screen). Old password input
      removed.
- [x] Email delivery via Resend, behind `sendMagicLink(email, link)`
      in `src/lib/server/email.ts`. Lazy-imports the SDK so the dev
      path (no `RESEND_API_KEY`) doesn't pull it in. Always returns
      ok-from-the-API-surface to prevent email enumeration; logs
      failures server-side. `MEMORIAM_EMAIL_FROM` and
      `MEMORIAM_PRODUCT_NAME` are configurable.
- [x] Site listing + creation UI. `/sites` route: signed-in users
      see every memorial they belong to (with role label) and can
      create a new one (display name + visibility picker).
      Authenticated guard redirects to `/?next=…` when no session.
- [x] Member management UI. `/sites/[siteId]` page renders the
      member list, current invites, role changes (owner-only),
      remove / leave (refuses last-owner removal), and ownership
      transfer (demotes previous owner to editor). Invite by email
      goes through `inviteMember` which emails an `/auth/invite`
      link via Resend. `/auth/invite?token=…` accepts the invite
      after verifying the signed-in user's email matches the
      invite's email (mismatch → clear error page). If the user
      isn't signed in, the invite link bounces through the
      magic-link flow with `next=` preserved.
- [x] Visibility-level enforcement in `hooks.server.js`. `private`
      sites resolve to `siteId = null` for non-members, so the rest
      of the request pipeline treats them as "no site found" (clean
      404 from page loads). `public` and `unlisted` stay reachable
      by URL.
- [x] Per-site storage quota tracking. `storage_quota.ts` recurses
      the assets directory on demand; `POST /api/assets` does a
      pre-upload check (refuses if already over) and a post-upload
      re-check (rolls back if the write pushed over). Cap defaults
      to 1 GiB, overridable via `MEMORIAM_SITE_QUOTA_BYTES`.
      DB-backed accounting + cron-based aggregation can come later
      if disk-walking on every upload becomes a bottleneck.
- [x] Rate limiting on auth endpoints. In-memory token bucket per
      email (5/hr) and per IP (30/hr) on `requestMagicLink`.
      Cluster-unsafe; swap for a shared store before
      multi-process production.
- [x] `/r/<code>` redirect endpoint backed by `short_codes` —
      designed small and dependency-light. Prefers custom domain
      → subdomain → site-id path prefix. `issueShortCode` library
      function lives in `short_codes.ts`; UI to mint codes is
      Phase 5 (QR generation).
- [x] Strip the dead `has_backend` flag. Removed from layout/page
      server loads, App.svelte props (and the `demo_doc` fallback),
      AppCtx interface, and Toolbar/Overlays/CreateLink/EditLink/
      LinkPreview consumers.
- [x] Playwright e2e suite. Accessible-query first (`getByRole`,
      `getByLabel`, `getByPlaceholder`, `getByText`), no
      `data-testid`. Covers auth (signin / signout / magic-link
      reuse), site creation + listing, invitation accept / reject /
      revoke, and visibility enforcement (private 403, public
      reachable). Runs against `bun run dev` on port 5174 with an
      isolated `.e2e-data` directory wiped per suite. The DB helper
      reads magic-link and invite tokens directly from the platform
      SQLite. `bun run e2e` runs the suite.
- [x] **Family tree — Phase A (read + minimal CRUD).** Extends
      the existing platform `people` / `relationships` schema with
      `sex`, full ISO `birth_date` / `death_date` (plus `_place`
      columns), `biography`, a per-edge `kind` for parent-of
      edges (bio / adoptive / foster / step / unknown), and a new
      `couples` table for marriages / partnerships with start /
      end dates and an end reason. `sites.subject_person_id`
      points each memorial at its focal person. Tree CRUD lives
      in `src/lib/server/people.ts` with a `getTreeRootedAt`
      recursive CTE walk (ancestors + descendants + everyone's
      spouses) and a `userCanEditPerson` ACL that grants writes
      transitively via `person_memorials` × `site_members`. The
      `/sites/[siteId]/tree` route renders the DAG via d3-dag
      Sugiyama on Svelte 5 SVG cards; clicking a card opens a
      side drawer with the person's facts (editable for
      admins). "+ Parent / + Spouse / + Child" affordances in
      the drawer open a modal that creates the new person and
      wires the appropriate edge / couple in one round-trip.
- [x] **Family tree — bug fixes + Phase B groundwork.** Death-date
      input now auto-unchecks `is_living`. d3-zoom is wired via a
      Svelte action on the canvas SVG (pan, pinch, wheel; bounded
      0.2-3x scale). Save confirmation lives in a `role="status"`
      span that flashes "Saved." for ~2.5s. Drawer Escape closes
      the drawer, modal Escape closes the modal — both via a
      single `<svelte:window onkeydown>` handler. Selected person
      lives in `?focus=<person_id>` so refresh / share preserve
      the drawer (local `$state` is the source of truth;
      `replaceState` mirrors to URL, doesn't push history).
      `deletePerson` + `removeCouple` remote functions land with
      explicit cascade (drops every relationship, couple,
      memorial link, access row, and nulls `sites.subject_person_id`
      tombstones). The drawer's "Delete person" button drives it
      with a confirm() dialog.
- [x] **Family tree — Phase A bugfix sweep.** Closed the remaining
      smoke-test items: modal backdrop click dismisses (using the
      `e.target === e.currentTarget` pattern, with svelte-ignore
      on the unavoidable a11y warnings — the window-level Esc
      handler covers keyboard a11y). Empty-state subject CTA is
      now an editable name field pre-filled with the site's
      display name — the previous fallback created a person
      literally named "Subject" when the site had no display
      name. Modal autofocuses its display-name input on open.
      Modal birth/death-date placeholders standardised on
      `YYYY-MM-DD`. Hardcoded English error strings ("Display
      name is required", "Could not add.") moved to the message
      catalogue. Empty-state CTA + add-relative submitAdd now
      surface server errors instead of swallowing them. Coverage
      backfill: unit tests for `removeParentEdge`,
      `removeCouple`, and the full `deletePerson` cascade
      (subject_person_id nulled, relationships + couples +
      memorials + access rows dropped, peer people survive); e2e
      for editing a non-subject person's facts + reload, the
      year-only date acceptance path, the empty-state error
      branch, modal backdrop click, and modal autofocus.
- [x] **Family tree — Phase B (canvas UX + privacy).** Four
      features landed together because they all touch the SVG
      render path:
      *Inline ghost cards* — every card sprouts three "+"
      affordances (top: parent, right: spouse, bottom: child) at
      30% opacity, bumping to full on hover or keyboard focus.
      Each is a proper `role="button"` with an
      `aria-label="Add a parent of {name}"` for screen readers
      and opens the existing add modal with the right anchor.
      *Living-relative redaction* — server-side at the load
      boundary (`redactTree(payload, subjectId)` in `people.ts`).
      `isLikelyLiving(person)` decides; the memorial subject is
      always exempt. Redacted records get `is_redacted: true`
      plus nulls for every sensitive field — `person_id`,
      `is_living`, and `sex` survive so the layout still places
      the card. The client renders the "Living relative"
      placeholder keyed off the flag. Viewers see redacted;
      owners and editors see full fidelity.
      *Per-edge type chip* — a single-letter glyph in a circle
      at each non-biological parent edge's midpoint. `A` for
      adoptive, `F` foster, `S` step, `?` unknown. Biological
      edges stay chip-less (default). The `<title>` element
      carries the long form for screen readers.
      *Multi-marriage badge* — a count badge in the top-right
      corner of any card whose person is in 2+ couples. Reads
      "× 2" visually, "2 marriages or partnerships" to a screen
      reader. Phase A's "cycling which spouse renders adjacent"
      tweak skipped — both spouses already render as separate
      dashed lines, so the badge is information-only for v1.
- [x] **Family tree — Phase C (interop + alternate view).**
      Hand-rolled GEDCOM 7 parser + reducer in `src/lib/gedcom.ts`
      (browser-safe so the import wizard can parse client-side and
      post the structured payload to `importGedcom`). Handles the
      subset we need: INDI (NAME / SEX / BIRT / DEAT / FAMC / FAMS
      / NOTE with CONT folding) and FAM (HUSB / WIFE / CHIL / MARR
      / DIV). GEDCOM date variants (`12 JUN 1925`, `JUN 1925`,
      `1925`, `ABT 1925`, `BET … AND …`) map to ISO `YYYY` /
      `YYYY-MM` / `YYYY-MM-DD`. The exporter is the inverse —
      `/sites/[siteId]/tree/export.ged` walks every person linked
      to the site via `person_memorials` and emits a synthetic FAM
      per couple + per parent-set. Import wizard at
      `/sites/[siteId]/tree/import` parses in the browser, shows a
      preview (people / families counts), then posts to the
      `importGedcom` remote function — which materialises rows in
      a single pass and auto-sets the first imported person as
      the site's subject if none exists. Fan-chart fallback at
      `?view=fan`: Sosa-Stradonitz half-circle in
      `fanLayoutTree`, with `fanWedgePath` building each annular
      sector and `fanWedgeLabelPosition` rotating labels along
      the radius. Toolbar toggle (Canvas / Fan chart) mirrors the
      choice into the URL alongside `?focus`. Optimistic-concurrency
      check on `tree_person.updated_at` and a placeable mobile-only
      breakpoint default are deferred — out of scope for v1.
- [x] **App UI translation (EN + PL) via Paraglide JS.** All
      user-facing strings live in `messages/{en,pl}.json`; Paraglide
      compiles them to tree-shakable typed functions in
      `src/lib/paraglide/`. Strategy is cookie-based
      (`PARAGLIDE_LOCALE`) — no URL prefix, so user-content slugs
      don't collide with locale segments. `LocaleSwitcher.svelte` is
      a small button pair (EN · PL) rendered on `/signin` and
      `/sites`; e2e covers the round-trip. The previous user-facing
      noun "memorial" was renamed to **"site"** across the UI
      strings (DB / URL / variable names stay as `sites`).

## Phase 3 — Multiplayer + local-first via Automerge (3-4 weeks)

The biggest *addition*, not a migration — there is no existing
multiplayer or sync layer to migrate from. Adding Automerge brings
two things at once: a CRDT-backed multi-user editing model and a
local-first sync story (IndexedDB cache, WebSocket relay, offline
edits that converge on reconnect). A consequence: the current
explicit-save flow goes away, because once edits are streaming
deltas to peers there's nothing to "save" — but that's downstream
of the addition, not the goal.

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
- [ ] **Family tree — first-class product surface, not a block.**
      Replaces the lightweight "family tree block" idea. Each user
      has one or more trees (rooted views into the platform person
      graph); memorials are pages that *belong to* a person in a
      tree, not vice versa. Sub-features, sequenced:
      - **Person editor.** CRUD for `people` rows, alias management,
        privacy controls, link/unlink to a memorial site.
      - **Relationship editor.** Add parent/child/spouse edges with
        certainty (`certain` / `probable` / `unverified`) and an
        optional source note (the document that backs the claim).
      - **Tree visualization.** SVG-based for trees up to ~500 people
        (Cytoscape.js or a custom layout), WebGL fallback above that
        (Sigma.js). Pan, zoom, click-to-focus, expand/collapse
        branches. Render relation certainty as edge styling.
      - **GEDCOM 5.5.1 import.** Industry-standard format —
        non-negotiable for adoption against Geni/MyHeritage. Parse
        INDI and FAM records, fuzzy-match against existing platform
        people (offer merge candidates rather than blind creating).
        Handle source citations as best-effort.
      - **GEDCOM export.** Round-trip support. Critical for "your
        data is yours" credibility.
      - **Cross-tree linking.** When two users' trees overlap on the
        same person (great-aunt on tree A = grandmother on tree B),
        either user can propose a merge; the other must accept.
        Merged person records share an underlying `person_id`; each
        side keeps a tree-specific view (root, alias, custom notes).
        Geni-style "global tree" emergent behavior.
      - **Smart matching.** Suggest "is this the same person?" on
        new person creation based on fuzzy name + dates + place +
        relationship context. v1 ships heuristic; v2 could use an
        embedding model.
      - **Tree-specific privacy.** Default rule: living people
        visible only to authenticated tree members. Deceased people
        default to "visible to anyone with the tree link." Owner
        can override per-person.
      - **Source documents.** Attach photos, scanned certificates,
        census records to a person. Stored as platform-level assets
        (separate from per-site memorial assets) since they belong
        to the person, not a memorial.
      - **Explicitly out of scope for v1:** DNA matching (different
        industry, regulatory complications — GDPR, HIPAA-adjacent),
        ethnicity estimates, historical record databases (we don't
        license census/birth-record corpora — partner if needed).
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
- [x] **QR codes for engraving — v1.** SVG-first QR generation built
      on the `qrcode` npm package. Composites the bundled logo into
      the centre (clamped to 20% of the QR area; EC level **H**
      ~30% redundancy absorbs the cut-out). Endpoint at
      `/sites/[siteId]/qr/[code]` is member-gated and cache-immutable
      (codes are permanent, rendering is deterministic). UI on
      `/sites/[siteId]` has a "Generate QR code" button + per-code
      preview and SVG download. The QR encodes the `/r/<code>` short
      URL so domain or architecture changes don't invalidate the
      engraving. Library wrapper lives in `src/lib/server/qr.ts`,
      unit-tested for scale clamping, EC level defaults, and logo
      composition.
- [x] **QR codes for engraving — v2.** Print-ready PDF export via
      `pdfkit` + `svg-to-pdfkit`. The QR stays vector inside the PDF
      (crisp at any zoom) with the short URL printed below as the
      human-readable fallback per RTL convention (every QR should
      survive a failed scan). Three preset sizes named for their
      physical edge length: `card` (25 mm), `plaque` (50 mm),
      `headstone` (80 mm); each renders to a square PDF page sized
      to the QR plus margins, with the memorial display name above
      and the URL below. Endpoint `?format=pdf&size=…` on the same
      QR route; UI exposes one labelled link per preset. Library
      wrapper at `src/lib/server/qr_pdf.ts`, unit-tested for
      structure / page dimensions / every preset.
- [ ] **QR codes — v3 follow-ups (deferred).** Bleed marks (only
      matters for full-bleed paper, irrelevant for stone markers),
      low-contrast warning (engraved grey-on-grey granite barely
      works — defer until a customer hits it; the colour options
      on `generateQrSvg` already allow contrast tuning), audit log
      of QR generations against `short_codes` rows (operational
      concern — wait for the first support ticket before paying
      the row-per-render cost).
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

## Deploy target

Decision needed before Phase 3 (Automerge sync server). The sync
server's shape, the asset storage model, and the per-site SQLite
strategy all hinge on this. Three live options, each with a
distinct architectural pull:

### Option A — VPS or Fly.io (current code's natural fit)

- **Compute**: a Node.js process with a persistent volume (Fly's
  managed volume, Hetzner / DigitalOcean disk).
- **Per-site DB**: `node:sqlite` on disk under
  `data/sites/<site_id>/db.sqlite3`. WAL mode, LRU connection
  cache. Already implemented in Phase 1.
- **Assets**: filesystem under `data/sites/<site_id>/assets/`.
  Already implemented.
- **Sync server**: `automerge-repo` with the WebSocket network
  adapter mounted as a SvelteKit endpoint, `automerge-repo-storage-nodefs`
  writing to the same per-site directory.
- **Backups**: `cp -r data/<site_id>/` per site on a cron. Off-box
  to S3 / R2 / Backblaze.
- **Pros**: Zero rework from Phase 1. Cheapest at low/medium
  scale. One process owns everything. Easy local dev. SQLite is
  fast and the dataset stays small per site.
- **Cons**: Single region (latency for far-away families).
  We own the box (patches, monitoring, scaling). Cold start
  semantics if we ever go serverless later.

### Option B — Cloudflare (Workers + D1 + R2 + Durable Objects)

- **Compute**: Workers (stateless edge functions) for HTTP
  routes; Durable Objects (one per active page) for live editing
  sessions holding Automerge state.
- **Per-site DB**: Cloudflare D1, one D1 database per site (D1
  supports per-tenant sharding cleanly). Migrate from
  `node:sqlite` query surface to D1's HTTP/wrangler client —
  similar SQL, different invocation. Substantial code touch but
  mechanical.
- **Assets**: R2 (S3-compatible). The current
  `asset_storage.js` filesystem ops become R2 PUT/GET. Streaming
  upload + SHA-256 verification still works.
- **Sync server**: Durable Objects hold Automerge state in
  memory + their built-in storage. WebSocket lives inside the DO
  ("WebSocket hibernation API" is well-suited). Each page = one
  DO instance. This is actually a very clean fit for our
  per-page Automerge model.
- **Pros**: Multi-region by default (low latency globally).
  Cheap at scale because pricing is per-request, not per-CPU-hour.
  Durable Objects are conceptually right for our model. No
  ops on our side.
- **Cons**: Significant rework — `node:sqlite` →
  D1, filesystem → R2, sync server → DO. Phase 1's filesystem
  and `node:sqlite` work has to be re-skinned (the architectural
  shape stays; the API changes). Vendor lock-in. DO pricing can
  bite at very high write volume.

### Option C — Vercel (Functions + Turso + external sync server)

- **Compute**: Vercel Serverless Functions for HTTP routes.
  Ephemeral, short-lived, no persistent state.
- **Per-site DB**: Turso (libSQL, SQLite-compatible) with
  per-site databases. `@libsql/client` is a near-drop-in for
  `node:sqlite`. Pricing is per-DB beyond the free tier.
- **Assets**: Vercel Blob or external R2/S3. Vercel Blob is
  pricey at scale.
- **Sync server**: Vercel's WebSocket support is limited.
  Need a separate process (small VPS, Fly machine, or
  Cloudflare DO) just for the Automerge sync — at which point
  we're already running infra outside Vercel.
- **Pros**: Excellent Svelte/SvelteKit DX. Easy preview deploys.
  Edge functions are fast for the read path.
- **Cons**: Worst architectural fit. Multi-region per-site DBs
  (Turso) cost more than DO storage. Need a second host for the
  sync server. Per-function pricing punishes us under load
  (memorial sites are read-heavy — lots of Function calls).
  Effectively a hybrid Vercel-plus-something, which means we
  manage two platforms.

### Recommendation

If shipping fast matters, **Option A (Fly.io)** is the path of
least resistance — current code runs essentially unchanged, ops
load is low for a single-region product, costs are predictable
and tiny at MVP scale. Defer multi-region until there's evidence
families across continents are co-editing.

If betting on the architecture long-term, **Option B (Cloudflare)**
is the most elegant — per-site D1, per-page Durable Objects, R2
for assets, multi-region by default. But it's ~2-4 weeks of
rework on top of Phase 1, much of it dragging the asset and DB
abstractions through API changes. Better as a v2 migration once
Option A has validated the product.

**Option C (Vercel)** is hard to recommend for this product. The
read-heavy + WebSocket-sync + asset-heavy profile fights Vercel's
strengths. Skip unless there's a specific reason (existing Vercel
contract, team familiarity).

Decision: pending. Will be made before Phase 3 starts.

## What we explicitly will not do

Worth writing down so we don't drift.

- **No multi-region.** SQLite-per-site + Fly volume is single-region
  by design. If/when this matters, switch to Turso (`@libsql/client`
  is a small swap) rather than building our own replication.
- **No realtime video calls / live streams.** Memorial sites are
  async by nature. Real-time video is a different product.
- **No social network features.** No follows, no feed, no
  recommendations. Trees are explicitly linked, not algorithmically
  surfaced.
- **No federated identity.** Magic link + Google. No "sign in with
  Apple/Facebook/Twitter," no SAML/SSO.
- **No public API in v1.** Add when a partner needs it.
- **No DNA matching, no ethnicity estimates, no licensed historical
  record databases.** That's where Ancestry / MyHeritage make their
  margin; it's a different industry with different costs and
  regulatory exposure. Compete on UX, collaboration quality, and
  the memorial-page differentiator, not on data corpus.

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
- **Genealogy expands surface area substantially** (HIGH).
  Tree visualization at scale, GEDCOM round-tripping, cross-tree
  merging, and per-person privacy all add up to ~2-3 months of
  focused work on top of the memorial editor itself. Risk is
  building a mediocre tree feature that loses to Geni rather than
  shipping a great memorial feature and adding the tree later. Plan
  the sequencing carefully — memorials need to feel done before
  the tree opens, or the product reads as "yet another family-tree
  startup."
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
