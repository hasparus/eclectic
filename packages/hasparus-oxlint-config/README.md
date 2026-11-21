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
import base, { ignorePatterns } from "@hasparus/oxlint-config";

export default defineConfig({
  extends: [base],
  ignorePatterns: [...ignorePatterns],
  overrides: [{ files: ["src/**/*.ts"], rules: { "no-console": "warn" } }],
});
```

`ignorePatterns` comes along by hand, because `extends` drops a base config's
ignore patterns — see [below](#what-it-ignores). Everything else, `overrides`
included, arrives through `extends`.

`sonarjs`, `better-tailwindcss`, `no-only-tests`, `anti-slop` and `landmines`
run through oxlint's `jsPlugins` and travel with this package.

## Sorting

The base does not sort anything. For perfectionist's sorting rules — object
keys, union members, JSX props, interfaces and the rest, all natural order —
import the other preset instead. It is the base plus those rules, and exports
the same `ignorePatterns`:

```ts
import base, { ignorePatterns } from "@hasparus/oxlint-config/with-sorting";
```

They were in the base until 0.5.0. Sorting is an opinion about layout, and a
repo can have every other opinion here without it.

## Upgrading to 0.5

- **`tsrs` replaces `oxlint-tsgolint`.** oxlint 1.94 finds `tsrs-lint` and
  runs the type-aware rules in it. `npm install --save-dev tsrs` and remove
  `oxlint-tsgolint`.
- **Sorting moved to `/with-sorting`.** Change the import to keep it.
- **No need to spread `overrides`.** `extends` brings them; the old advice was
  wrong. Spreading them still works. Keep spreading `ignorePatterns`.
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
- **landmines.** Nine of its ten rules, as warnings. See [below](#landmines).
- **`anti-slop/no-module-mocking` is off**, because landmines'
  `no-test-doubles` reports the same line.
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
which it calls `quality`. It skips some false positives, such as a
`Record<"a" | "b", T>` whose keys are all known. nkzw also calls it faster:
`no-widen-then-assert` alone runs in half the time, but with all seventeen
rules on, the whole run takes as long as before. It also adds
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

## landmines

[landmines](https://github.com/interfere-inc/landmines) is a set of rules
against tests that pass without being true: mocks of the thing under test,
fixed sleeps, polling a spy against a deadline, retries, raised timeouts, and
MSW letting unmocked requests through to the network. It also has rules for
where tests live, what test files are called, open-ended `package.json`
exports, and explicit return types on implementations.

It is published as `@interfere/landmines`, so it is a dependency here rather
than a vendored copy. All ten rules are named; nine are on, as warnings.

Departures from its recommended config:

- **Warnings, not errors**, like everything else here.
- **`no-comments` is off.** It bans prose comments, and this config is made of
  them: every override and every rule turned off says why, beside it. Over this
  repository it reports 124 comments. To turn it on:
  `rules: { "landmines-style/no-comments": "warn" }`.
- **`test-file-names` is off for Playwright specs**, in the same `e2e/` and
  `playwright/` override as below. `.spec.ts` is Playwright's own convention.
- **`anti-slop/no-module-mocking` is off.** landmines' `no-test-doubles`
  reports the same `vi.mock` line, and also catches `vi.fn(impl)`, stubbed
  globals and patched prototypes.

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

These live in the base's `overrides`, and `extends` brings them along: a repo
that extends the base gets them with nothing to spread. They are also a named
export, `overrides`, because until 0.5.0 this README said `extends` dropped
them and asked you to spread them by hand. That was wrong — checked with
oxlint 1.78 and 1.94, with the package installed in `node_modules` — but a
config that still spreads them keeps working.

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

## What it ignores

`ignorePatterns` covers build output and the directories coding agents install
their own assets into (`.claude`, `.cursor`, `.codex` and the rest; a repo that
lints those is reviewing somebody else's code).

`extends` drops a base config's ignore patterns, so the list is a named export,
to spread into your own:

```ts
import base, { ignorePatterns } from "@hasparus/oxlint-config";

export default defineConfig({
  extends: [base],
  ignorePatterns: [...ignorePatterns],
});
```

Without it, oxlint lints `dist/`, `.claude/` and even `node_modules/`.

## License

MIT
