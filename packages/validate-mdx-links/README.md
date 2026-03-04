# validate-mdx-links

Validates internal links in MDX files. Wraps `next-validate-link` with heuristics that cut false positives for relative paths, file extensions, and framework-specific routing.

## Supported Frameworks

- **Next.js** — App Router (`app/`) and Pages Router (`pages/`)
- **Fumadocs** — content-directory scanning (`content/`)
- **TanStack Router** — `src/routes/` with `$params`, `_layout` prefixes, `[.]` literal dots

Detection reads `package.json` dependencies first, then falls back to directory heuristics.

## Install

```bash
npm add -D validate-mdx-links
```

## CLI

```bash
validate-mdx-links --files "content/**/*.mdx" --verbose
```

| Flag | Default | Description |
|------|---------|-------------|
| `--files` | — | Glob pattern for MDX files to validate |
| `--content-dir` | — | Content directory for URL scanning; sets `--files` to `${contentDir}/**/*.mdx` when omitted |
| `--cwd` | `process.cwd()` | Working directory |
| `--verbose` | `false` | Print every scanned route |

Exits `1` on broken links, `0` otherwise.

### Relative links

The CLI resolves relative links (`./sibling`, `../other-dir/page`) against the content directory. It checks multiple path variants — with and without `.mdx`, and with `page.mdx` (App Router index) — before reporting a broken link.

### Heading fragments

Heading IDs follow GitHub Slugger conventions (duplicate tracking, non-ASCII preservation). Links like `./page#section` validate against extracted headings.

## API

```ts
import { validateMdxLinks, printErrors } from "validate-mdx-links";

const errors = await validateMdxLinks({
  cwd: "/path/to/docs",
  files: "content/**/*.mdx",
  contentDir: "content",
  verbose: true,
});

if (errors.length) {
  printErrors(errors);
  process.exit(1);
}
```

`validateMdxLinks` returns `ValidationResult[]`; each entry has `file` and `detected` fields. Pass the array to `printErrors` or build a custom reporter.
