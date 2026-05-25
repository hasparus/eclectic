# Memoriam

Memorial sites with a collaborative family-tree layer. Family
members co-edit pages live (or offline, syncing later). Each
person can have a fully editable memorial page. Trees link across
families.

Forked from [michael/editable-website](https://github.com/michael/editable-website)
at commit `35e3b65` (2026-05-06) and being reshaped into a
multi-tenant SaaS. See [PLAN.md](./PLAN.md) for the roadmap and
[CLAUDE.md](./CLAUDE.md) for working notes.

## Status

Early. Phase 1 (foundation refactor) lands the multi-tenant
backend. The editor still depends on the upstream `svedit`
package; the Automerge + local-first switch is Phase 3.

## Architecture (brief)

- **One memorial = one SQLite database.** Per-site DBs live under
  `data/sites/<site_id>/`, each with its own `db.sqlite3` and
  `assets/` directory. A separate platform DB (planned, Phase 2)
  holds users, sites, sessions, short codes, and the cross-site
  genealogy registry (people, relationships).
- **Page content as a node graph.** Inherited from svedit:
  `{ id → node }` map with typed properties (`annotated_text`,
  `node`, `node_array`, etc.). Pages, nav, and footer are
  separate documents stitched together for editing.
- **Asset pipeline.** Images resized client-side via canvas +
  WebP encoded with `@jsquash/webp` in a worker;
  SHA-256-keyed deduplication; server verifies the streamed
  body matches the claimed hash before storing.
- **Auth (current).** Single admin password per request session.
  Will be replaced in Phase 2 with platform-level users +
  per-site roles.
- **Sync (planned, Phase 3).** Automerge per page, with
  `automerge-repo` doing offline-first storage in IndexedDB and
  WebSocket sync to a server-side relay. Explicit "save" goes
  away; deltas flow continuously.

## Running locally

```sh
bun install
cp .env.example .env  # set ADMIN_PASSWORD
bun --filter memoriam run dev
```

Re-seed the demo data:

```sh
bun --filter memoriam run dev:seed
```

Run tests:

```sh
cd packages/memoriam && bun run test
```

## Deploy

Deferred until we pick a target. The current code assumes a
Node.js runtime with a persistent filesystem (VPS or Fly.io).
See [PLAN.md § Deploy target](./PLAN.md#deploy-target) for the
trade-off analysis.
