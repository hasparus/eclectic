# validate-mdx-links

Wraps `next-validate-link` with heuristics for false positives.
Handles relative links, with and without `.mdx` extension, and treats `page.mdx` (Next.js App Router) as an index file.

## Install

```bash
pnpm add -D validate-mdx-links
```

## CLI

```bash
validate-mdx-links --files "content/**/*.mdx" --verbose
```

- `--cwd` defaults to `process.cwd()`
- `--verbose` prints every scanned route
- exits `1` on broken links, `0` otherwise

Relative links lose `.mdx` in MDX or JSX. The CLI checks `./foo`, `./foo.mdx`, and `../foo/page.mdx` before complaining.

## API

```ts
import { validateMdxLinks, printErrors } from "validate-mdx-links";

const errors = await validateMdxLinks({
  cwd: "/path/to/docs",
  files: "content/**/*.mdx",
  verbose: true,
});
```

You get an array of `{ file, detected }`. Pass it to `printErrors` or build your own reporter.
