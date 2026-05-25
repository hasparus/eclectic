# CLAUDE.md — memoriam

Vendored fork of `editable-website` (commit `35e3b65`). See
[PLAN.md](./PLAN.md) for the roadmap and architectural decisions.
ARCHITECTURE.md and IMPLEMENTATION_PLAN.md are upstream relics —
trim or delete before relying on them.

## Commands

- `npm run dev` — start dev server
- `npm run dev:seed` — wipe `data/` and reseed
- `npm run build` — production build
- `npm test` — run vitest

## Code style

**snake_case** for our identifiers (variables, functions, files,
test names). **camelCase** for web platform and framework APIs we
can't rename: `window.getSelection`, `document.activeElement`,
`navigator.clipboard`, DOM properties, `addEventListener`,
`preventDefault`, Svelte handlers (`onclick`, `onmousedown`, etc.).

**Sentence case** for headings, comments, commit messages.
Exception: "Svedit" is a proper noun.

Files using Svelte runes (`$state`, `$derived`, `$effect`) must use
the `.svelte.js` or `.svelte.ts` extension.

Tailwind first; custom CSS only for things Tailwind can't express
(typically CSS custom properties like
`var(--svedit-editing-stroke)`). Use Tailwind's arbitrary-value
syntax for those: `text-(--svedit-editing-stroke)`.

## SvelteKit landmines

The home route `/` must work in static / `VERCEL=1` mode. In any
file that runs from `/`, **do not** statically import backend
modules (`$lib/api.remote.js`, `$lib/server/db.js`, anything that
pulls them in). Lazy-import inside a `has_backend` guard so static
deploys do not evaluate database code at module load.

`hooks.server.js` sets `event.locals.site_id` and `event.locals.db`
for every non-Vercel request. Backend code should read those from
the request context (api.remote.js exposes a `db()` accessor) —
never reach for a module-level singleton.

## Schema additions

When you add a property to a node type:
1. Add it to `document_schema` in `src/lib/document_schema.js`.
2. Add it to the inserter in `src/routes/create_session.js`.
3. Write a migration in `src/lib/server/migrations.js` if existing
   documents need backfilling.
