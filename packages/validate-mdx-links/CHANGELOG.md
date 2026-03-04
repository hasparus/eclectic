# validate-mdx-links

## 1.2.0

### Features

- Auto-detect content-based frameworks (Fumadocs) — no longer limited to Next.js `app/` and `pages/` routes. Projects with `content/**/*.mdx` files now get proper URL scanning.
- `--content-dir` CLI flag to explicitly set the content directory for URL scanning.
- `--files` defaults to `${contentDir}/**/*.mdx` when `--content-dir` is provided without `--files`.
- Framework detection reads `package.json` dependencies (`fumadocs-core`, `fumadocs-mdx`, `fumadocs-ui`, `next`) before falling back to directory heuristics.
- Heading extraction for `#id` fragment validation using `github-slugger` — matches Fumadocs/GitHub heading ID generation (duplicate tracking, non-ASCII preservation).
- TanStack Router route scanning — `src/routes/` files are parsed using TanStack conventions (`_prefix` layout segments stripped, `$` splat routes become fallback regex patterns, `[.]` literal dots).

### API Changes

- `ValidateMdxLinksOptions` now accepts an optional `contentDir: string` field.

## 1.1.0

Initial public release. Next.js App Router and Nextra link validation with false positive filtering for relative links.
