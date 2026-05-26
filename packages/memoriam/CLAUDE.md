# CLAUDE.md — memoriam

Vendored fork of `editable-website`. Roadmap and architectural
decisions live in [PLAN.md](./PLAN.md).

## Code

- **camelCase** for JS/TS identifiers, **PascalCase** for types
  and Svelte components. **snake_case** in SQL (columns, tables)
  and our JSON document keys — SQL idiom, worth keeping.
  Svedit's own schema-metadata keys (`kind`, `properties`,
  `node_types`, `default_node_type`, `allow_newlines`) stay as
  svedit dictates. The vendored code is mid-flip; finish during
  the TS migration (PLAN.md Phase 1), not as drive-by renames.
- Files using Svelte runes (`$state`, `$derived`, `$effect`)
  must use `.svelte.js` / `.svelte.ts`.
- Tailwind first; custom CSS only for things Tailwind can't
  express.
- Sentence case for comments and commit messages.
- Sacrifice grammar for concision.

## Server

Per-site SQLite is reached via `event.locals.db` (set in
`hooks.server.js`) or the `db()` accessor in `api.remote.ts`.
`locals.db` is **nullable** — it's null when the request didn't
resolve to a site (apex domain, unknown subdomain, etc.). The
`db()` accessor throws; in page server loads check
`locals.siteId` first and `error(404)` if the route requires a
site. The platform-wide DB (`locals.platformDb`) is always
available.

Edit permission is `locals.isAdmin`, derived in
`hooks.server.js` from the user's `site_members` role on the
resolved site (owner / editor → admin; viewer / non-member → not).
Use `requireAdminSession(locals)` in mutating remote functions.

There is no module-level DB singleton. The per-site LRU cache in
`src/lib/server/db.ts` owns every `DatabaseSync`;
`platform_db.ts` owns the single platform connection.

## Adding a node property

1. Add it to `documentSchema` in `src/lib/document_schema.js`.
2. Add it to the inserter in `src/routes/create_session.js`.
3. Write a migration in `src/lib/server/migrations.js` if existing
   documents need backfilling.
