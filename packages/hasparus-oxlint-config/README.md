# @hasparus/oxlint-config

my shared [oxlint](https://oxc.rs) config

mostly warnings except definitive bugs, which get a red squiggly.

## Usage

```sh
npm install --save-dev @hasparus/oxlint-config oxlint tsrs
```

```ts
// oxlint.config.ts
import { defineConfig } from "oxlint";
import base, { ignorePatterns, overrides } from "@hasparus/oxlint-config";

export default defineConfig({
  extends: [base],
  ignorePatterns: [...ignorePatterns],
  overrides: [...overrides, { files: ["src/**/*.ts"], rules: { "no-console": "warn" } }],
});
```

`ignorePatterns` and `overrides` come along by hand because oxlint reads both
from the root config only — see [below](#what-it-turns-off-for-you).

`sonarjs`, `better-tailwindcss`, `no-only-tests` and `anti-slop` run through
oxlint's `jsPlugins` and travel with this package.

## Sorting

The base does not sort anything. For perfectionist's sorting rules — object
keys, union members, JSX props, interfaces and the rest, all natural order —
import the other preset instead. It is the base plus those rules, and exports
the same `ignorePatterns` and `overrides`:

```ts
import base, { ignorePatterns, overrides } from "@hasparus/oxlint-config/with-sorting";
```

They were in the base until 0.5.0. Sorting is an opinion about layout, and a
repo can have every other opinion here without it.

## Upgrading to 0.5

- **`tsrs` replaces `oxlint-tsgolint`.** oxlint 1.94 finds `tsrs-lint` and
  runs the type-aware rules in it. `npm install --save-dev tsrs` and remove
  `oxlint-tsgolint`.
- **Sorting moved to `/with-sorting`.** Change the import to keep it.
- **`jsx-a11y` rules run now.** The config always set them, but never turned
  the plugin on, so oxlint dropped them without a word. Expect new warnings in
  `.jsx` and `.tsx` files.
- **New rules.** The `oxc` plugin's bug patterns (`missing-throw`,
  `bad-bitwise-operator`, `const-comparisons` and the rest), the React
  Compiler rules (`react/purity`, `refs`, `set-state-in-effect` and the rest),
  `preserve-caught-error`, `no-useless-assignment`, `array-callback-return`,
  `no-only-tests`, two new `anti-slop` rules, and a few more. Most are
  warnings. Definite bugs are errors, and so are the React Compiler rules,
  because `@hasparus/eslint-config` makes them errors.
- **Unused disable comments are reported**, as warnings.
- **`@nocommit` in a comment is an error**, so it cannot be merged by
  accident.

## anti-slop

[anti-slop](https://github.com/dmmulroy/anti-slop) is seventeen rules against the
shapes code takes when whoever wrote it could not see the type it needed —
`unknown` in a signature, `Record<string, unknown>` standing in for a shape, an
assertion claiming what nothing checked. A model writes them by the dozen and so
does a person in a hurry; the rules do not care which.

It publishes source to vendor rather than a package to depend on, so the copy
lives in [`anti-slop/`](./anti-slop) and ships inside this one. Nothing to
install, nothing to register — `extends` brings the plugin and all seventeen
rules, under `anti-slop/`.

Twelve of them come from
[`@nkzw/oxlint-config`](https://github.com/nkzw-tech/oxlint-config)'s port,
which it calls `quality`. That port is faster — `no-widen-then-assert` runs in
about half the time — and skips some false positives, such as a
`Record<"a" | "b", T>` whose keys are all known. It also adds
`no-array-filter-map` and `no-reduce-accumulator-copy`. The other five are the
ones nkzw dropped, still from dmmulroy's copy. The prefix stays `anti-slop/`,
so existing disable comments keep working.
[`anti-slop/README.md`](./anti-slop/README.md) says which rule came from where.

Two departures from upstream:

- **Warnings, not errors.** None of the seventeen is a bug, and
  `require-safety-comment-for-type-assertion` asks for a sentence of prose no
  `--fix` can write.
- **`no-runtime-typeof` runs with `allowInTypeGuards`.** The rule's answer to a
  `typeof` check is to parse at the I/O boundary instead, which presumes a
  parser. The checks it catches in practice are not reading I/O at all — they
  are discriminating a union TypeScript itself models with `typeof`. The option
  passes one inside a type predicate or assertion function and still reports one
  sitting in the middle of a function meant to be doing something else, so the
  narrowing keeps costing a name.

To decline the lot, spell them off:

```ts
export default defineConfig({
  extends: [base],
  rules: Object.fromEntries(
    Object.keys(base.rules)
      .filter((id) => id.startsWith("anti-slop/"))
      .map((id) => [id, "off"]),
  ),
});
```

## Type-aware linting

Every type-aware rule oxlint has is on, and `options.typeAware` comes with
them, so plain `oxlint` runs the lot — there is no `--type-aware` to remember
and no lint script to change. The option travels through `extends` and takes
effect from your root config; files covered by a nested config are linted with
it too.

The rules run in [`tsrs`](https://github.com/oxc-project/tsrs), the Rust port
of the TypeScript 7 compiler, a peer dependency which most package managers
install for you. oxlint 1.94 finds its `tsrs-lint` binary on its own. Without
it oxlint lints nothing at all, so the config says as much on stderr, with the
one command that fixes it. `oxlint-tsgolint` still works if that is what is
installed, but tsrs is what the config is tested against.

Severities match [`@hasparus/eslint-config`](../hasparus-eslint-config) where
it has an opinion, so a file that passes one linter passes the other. Only
`typescript/require-await` is off, because the ESLint rule of that name is off
here too.

To decline the whole thing:

```ts
export default defineConfig({ extends: [base], options: { typeAware: false } });
```

## What it turns off for you

Two rules are wrong often enough in a particular place that the config says so,
and one is right only in a particular place:

- **`import/no-default-export`** in Next's App Router conventions —
  `app/page.tsx`, `layout`, `sitemap`, `robots` and the rest. Next reads them
  by default export. `app/api/**/route.ts` keeps the rule, because route
  handlers export `GET`/`POST` by name.
- **`unicorn/prefer-dom-node-text-content`** in `e2e/**` and `playwright/**`
  spec files. A Playwright locator is not a DOM node: `innerText()` reads what
  the page renders and `textContent()` reads the source, so the rule's fix
  rewrites the assertion. Helpers beside the specs keep the rule, since a
  `page.evaluate` body really does hold DOM nodes.
- **`vitest/require-awaited-expect-poll`**, on in test files only. An
  unawaited `expect.poll` never fails the test.

They ship as a named export rather than inside the base, because `extends`
drops a base config's `overrides`. `ignorePatterns` is the same story — oxlint
reads those from the root config only — so it is a named export too, covering
build output and the directories coding agents install their own assets into
(`.claude`, `.cursor`, `.codex` and the rest; a repo that lints those is
reviewing somebody else's code). Spread both into your own:

```ts
import base, { ignorePatterns, overrides } from "@hasparus/oxlint-config";

export default defineConfig({
  extends: [base],
  ignorePatterns: [...ignorePatterns],
  overrides: [...overrides],
});
```

Where each one looks:

|            | covers                                                             |
| ---------- | ------------------------------------------------------------------ |
| App Router | an `app/` directory at any depth, convention filenames only        |
| Playwright | an `e2e/` or `playwright/` directory at any depth, spec files only |
| Tests      | `*.test.*`, `*.spec.*` and anything under `__tests__/`             |

The Pages Router is not covered: every file under `pages` is a route, so there
is no filename left to narrow on, and the glob would swallow the
`components/pages/` folder plain React projects keep. That, or a Playwright
suite in `tests/`, wants a line of its own:

```ts
overrides: [{ files: ["tests/**/*.spec.ts"], rules: { "unicorn/prefer-dom-node-text-content": "off" } }],
```

## License

MIT
