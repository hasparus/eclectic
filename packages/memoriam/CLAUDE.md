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

## Naming

User-visible noun for a site is **"site"** (not "memorial"),
matching the DB table (`sites`) and URL (`/sites/[id]`). The
product is still "Memoriam"; only the per-tenant unit got renamed.
Existing comments / variable names that say "memorial site" are
fine — they're accurate description. Don't drive-by rename them.

## i18n

Paraglide JS. Messages live in `messages/{en,pl}.json`; compiled
output in `src/lib/paraglide/` is **generated** (gitignored).
Strategy is cookie-based (`PARAGLIDE_LOCALE`), no URL prefix —
user content lives at `/`, `/<slug>` etc. without colliding with
locale paths.

Adding a string:

1. Add the key to `messages/en.json` and `messages/pl.json`.
2. Run `bunx paraglide-js compile --project ./project.inlang --outdir ./src/lib/paraglide`
   (or just `bun run dev` — the Vite plugin recompiles on save).
3. Import via `import { m } from '$lib/paraglide/messages'` and
   call `m.your_key()` (with `{}` parameters for placeholders).

Key naming: `<feature>_<context>`, e.g. `signin_email_label`,
`sites_create_submit`. Reuse `common_*` for cross-feature labels
(roles, visibility, etc.). When a key shows in two places at
different lengths, add both (`common_visibility_public` and
`common_visibility_short_public`) — runtime string-splitting is
fragile across translations.

E2e tests pin to the base locale (English) by default — no
cookie set means `baseLocale`. `e2e/i18n.e2e.ts` exercises the
switcher round-trip; other suites assert on English strings.

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
