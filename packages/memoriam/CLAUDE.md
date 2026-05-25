# CLAUDE.md — memoriam

Vendored fork of `editable-website`. See [PLAN.md](./PLAN.md) for
the roadmap and architectural decisions.

## Commands

- `bun run dev` — start dev server
- `bun run dev:seed` — wipe `data/` and reseed
- `bun run build` — production build
- `bun test` — run vitest

## Naming

Idiomatic TypeScript / Svelte: **camelCase** for variables and
functions, **PascalCase** for types and Svelte components.

The vendored upstream uses snake_case throughout. New code should
be camelCase; the existing snake_case will flip during the
TypeScript migration tracked in PLAN.md Phase 1. Do not rename
opportunistically while making other changes — let the TS pass
own the rename.

**Sentence case** for headings, comments, commit messages.
Exception: "Svedit" is a proper noun.

Files using Svelte runes (`$state`, `$derived`, `$effect`) must
use the `.svelte.js` or `.svelte.ts` extension.

## Styling

Tailwind first; custom CSS only for things Tailwind can't express
(typically CSS custom properties like
`var(--svedit-editing-stroke)`). Use Tailwind's arbitrary-value
syntax for those: `text-(--svedit-editing-stroke)`.

## Request context

`hooks.server.js` populates `event.locals.siteId` (currently
`site_id` until the rename), `event.locals.db`, and
`event.locals.isAdmin` on every request. Backend code reads from
the request context — `api.remote.js` exposes a `db()` accessor
for that purpose. Never reach for a module-level singleton; the
per-site LRU cache in `src/lib/server/db.js` is the only owner of
`DatabaseSync` instances.

## Schema additions

When you add a property to a node type:
1. Add it to `documentSchema` in `src/lib/document_schema.js`.
2. Add it to the inserter in `src/routes/create_session.js`.
3. Write a migration in `src/lib/server/migrations.js` if existing
   documents need backfilling.
