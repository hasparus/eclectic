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

## Validation + result types

Input schemas use **arktype** (`type({...})`). Optional fields must
union with `undefined` — SvelteKit's `devalue` round-trip
preserves `{ key: undefined }`, and arktype's `'key?'` syntax
alone rejects that. Use `'key?': 'T | undefined'`.

Server-side error composition uses **neverthrow**'s `Result<T,
AppError>`. The wire format stays as a discriminated union
(`{ ok: true } & T | { ok: false } & AppError`) because
neverthrow's class instances lose their methods over JSON; the
boundary adapter `rpcFromResult(r)` converts at the
remote-function return point. `AppError` lives in
`src/lib/server/app_error.ts` (just `{ code, message }` plus the
`errOf(code, msg)` / `fromUnknown(...)` helpers).

Genealogy handlers are the reference pattern:

```ts
return rpcFromResult(
  requireUser(locals.userId)
    .andThen((userId) => requirePeopleEdit([id1, id2], userId))
    .map(() => doTheThing())
);
```

`requireUser`, `requireSiteEdit`, `requirePeopleEdit` are the
shared guards — each returns `Result<string, AppError>` threading
the user id through `.andThen` chains.

## Genealogy / family tree

People are platform-level. The platform DB owns the canonical
`people` row; a person can be linked to many memorial sites via
`person_memorials`. Relationships (parent-of, sibling-of) live in
`relationships`; marriages / partnerships live in `couples` as
their own table (start/end dates + end reason don't fit the edge
schema).

A site's central person is `sites.subject_person_id` (nullable
until set). The `/sites/[siteId]/tree` page is rooted on that id.

ACL for editing a person: `userCanEditPerson(personId, userId)`
returns true if the user (a) has an explicit `person_access` row
with role owner/editor, or (b) is an owner/editor of any site
this person is linked to via `person_memorials`. New people
created through `createPerson(remote)` auto-link to the site
the caller passed in and grant the caller `person_access.owner`.

Types live in `src/lib/people_types.ts` (client-safe) — never
`type`-import from `$lib/server/people` outside server files.

**GEDCOM 7 interop.** `src/lib/gedcom.ts` is the
browser-safe parser + reducer + exporter — the import wizard
parses client-side and posts the structured payload to
`importGedcom`. The exporter at `/sites/[siteId]/tree/export.ged`
emits the full subgraph (every person linked to the site via
`person_memorials`), synthesising a FAM record per couple + per
distinct parent-set since GEDCOM is family-record-centric.
Hand-rolled because the format is small enough that a dependency
costs more than it saves; the subset we care about is
INDI / FAM and a handful of date phrases.

**Fan-chart view.** `fanLayoutTree` in `tree_layout.ts` is a
Sosa-Stradonitz half-circle ancestor wheel; `fanWedgePath`
builds each annular sector. Opt-in via `?view=fan` — the canvas
(Sugiyama) is the default. Only renders ancestors; descendants
stay in the canvas view.

Tree visualisation: d3-dag's Sugiyama layout (parent-child DAG)
→ Svelte 5 SVG cards positioned in `src/lib/tree_layout.ts`.
Couples are rendered as a thin dashed line between the two
adjacent spouse cards; they don't participate in the Sugiyama
ranking. Card dimensions live in `tree_layout.ts` as `CARD_WIDTH`
/ `CARD_HEIGHT` — keep the values there and the Svelte template
in sync.

`isLikelyLiving(person)` is the redaction heuristic: returns true
if `is_living=1`, or if no death date is recorded AND birth was
<100y ago. Server-side `redactTree(payload, subjectId)` (in
`people.ts`) is called from the tree's `+page.server.ts` for
viewers; admins get full fidelity. Redacted records keep
`person_id` / `is_living` / `sex` so the layout still places the
card, and gain `is_redacted: true`. The page renders the
"Living relative" placeholder keyed off the flag. The memorial
subject is always exempt — pass its id as `keepId`.

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
