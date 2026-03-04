# validate-mdx-links

## 1.2.1

- Fix install command in README (use `bun`, not `npm`).

## 1.2.0

### Features

- Auto-detects content-based frameworks (Fumadocs). Projects with `content/**/*.mdx` files get proper URL scanning without Next.js `app/` or `pages/` routes.
- `--content-dir` CLI flag to set the content directory for URL scanning.
- `--files` defaults to `${contentDir}/**/*.mdx` when `--content-dir` is set without `--files`.
- Framework detection reads `package.json` dependencies (`fumadocs-core`, `fumadocs-mdx`, `fumadocs-ui`, `next`) before falling back to directory heuristics.
- Extracts headings for `#id` fragment validation via `github-slugger` — matches Fumadocs/GitHub ID generation (duplicate tracking, non-ASCII preservation).
- TanStack Router route scanning — parses `src/routes/` using TanStack conventions (`_prefix` layout segments stripped, `$` splat routes become fallback regex patterns, `[.]` literal dots). Gated on `@tanstack/react-start`, `@tanstack/start`, or `@tanstack/react-router` in `package.json`.
- Resolves relative links (`./sibling-post`, `../other-dir/page`) in content-based projects via `pathToUrl`.

### API Changes

- `ValidateMdxLinksOptions` accepts a new optional `contentDir: string` field.

## 1.1.0

Initial public release. Next.js App Router and Nextra link validation with false-positive filtering for relative links.
