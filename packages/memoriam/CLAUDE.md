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

Backend code reaches the per-site SQLite via
`event.locals.db` (set in `hooks.server.js`) or the `db()`
accessor in `api.remote.js`. There is no module-level
singleton — the per-site LRU cache in `src/lib/server/db.js`
owns every `DatabaseSync`.

## Adding a node property

1. Add it to `documentSchema` in `src/lib/document_schema.js`.
2. Add it to the inserter in `src/routes/create_session.js`.
3. Write a migration in `src/lib/server/migrations.js` if existing
   documents need backfilling.
