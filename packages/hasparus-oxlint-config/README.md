# @hasparus/oxlint-config

my shared [oxlint](https://oxc.rs) config

mostly warnings except definitive bugs, which get a red squiggly.

## Usage

```ts
// oxlint.config.ts
import { defineConfig } from "oxlint";
import base from "@hasparus/oxlint-config";

export default defineConfig({
  extends: [base],
  overrides: [{ files: ["src/**/*.ts"], rules: { "no-console": "warn" } }],
});
```

`perfectionist`, `sonarjs`, and `better-tailwindcss` run through oxlint's
`jsPlugins` and ship as dependencies of this package.

## Type-aware linting

Every type-aware rule oxlint has is on, and `options.typeAware` comes with
them, so plain `oxlint` runs the lot — there is no `--type-aware` to remember
and no lint script to change. The option travels through `extends`, so it only
takes effect from your root config; a nested config that extends this one
inherits the rules and loses the switch.

The rules run in `oxlint-tsgolint`, a peer dependency, which most package
managers install for you. Without it oxlint lints nothing at all, so the config
says as much on stderr, with the one command that fixes it.

Severities match [`@hasparus/eslint-config`](../hasparus-eslint-config) where
it has an opinion, so a file that passes one linter passes the other. Only
`typescript/require-await` is off, because the ESLint rule of that name is off
here too.

To decline the whole thing:

```ts
export default defineConfig({ extends: [base], options: { typeAware: false } });
```

## What it turns off for you

Two rules are wrong often enough in a particular place that the config says so:

- **`import/no-default-export`** in Next's App Router conventions —
  `app/page.tsx`, `layout`, `sitemap`, `robots` and the rest. Next reads them
  by default export. `app/api/**/route.ts` keeps the rule, because route
  handlers export `GET`/`POST` by name.
- **`unicorn/prefer-dom-node-text-content`** in `e2e/**` and `playwright/**`
  spec files. A Playwright locator is not a DOM node: `innerText()` reads what
  the page renders and `textContent()` reads the source, so the rule's fix
  rewrites the assertion. Helpers beside the specs keep the rule, since a
  `page.evaluate` body really does hold DOM nodes.

They ship as a named export rather than inside the base, because `extends`
drops a base config's `overrides`. Spread them into your own:

```ts
import base, { overrides } from "@hasparus/oxlint-config";

export default defineConfig({
  extends: [base],
  overrides: [...overrides],
});
```

Where each one looks:

|            | covers                                                             |
| ---------- | ------------------------------------------------------------------ |
| App Router | an `app/` directory at any depth, convention filenames only        |
| Playwright | an `e2e/` or `playwright/` directory at any depth, spec files only |

The Pages Router is not covered: every file under `pages` is a route, so there
is no filename left to narrow on, and the glob would swallow the
`components/pages/` folder plain React projects keep. That, or a Playwright
suite in `tests/`, wants a line of its own:

```ts
overrides: [{ files: ["tests/**/*.spec.ts"], rules: { "unicorn/prefer-dom-node-text-content": "off" } }],
```

## License

MIT
