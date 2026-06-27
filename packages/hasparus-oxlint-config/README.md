# @hasparus/oxlint-config

oxlint mirror of [`@hasparus/eslint-config/the-guild`](../hasparus-eslint-config),
for projects that want oxlint's speed but the same rule list.

## Usage

```jsonc
// .oxlintrc.json
{
  "extends": ["./node_modules/@hasparus/oxlint-config/oxlintrc.json"],
  "overrides": [{ "files": ["src/**/*.ts"], "rules": { "no-console": "warn" } }]
}
```

`perfectionist`, `sonarjs`, and `better-tailwindcss` run through oxlint's
**alpha** `jsPlugins`. Those three eslint plugins are dependencies of this
package, so they resolve when you extend it — no extra installs.

## Gaps vs the ESLint config

oxlint can't reproduce these today:

- `perfectionist/sort-imports` — omitted; use oxfmt's `sortImports` instead.
- YAML / JSON / MDX **document** linting — dropped (no oxlint parser).
- Not yet in oxlint: `no-unreachable-loop`, `n/no-restricted-import`,
  `import/no-useless-path-segments`.
- `jsx-a11y` rules are present but its plugin is not enabled — oxlint's rule
  options diverge from the ESLint plugin's (follow-up).

## Regenerating

`oxlintrc.json` is generated from the-guild and hand-cleaned:

1. `npx @oxlint/migrate the-guild` (in `hasparus-eslint-config`).
2. Flatten the FlatCompat `files: [null]` overrides into root.
3. Drop rules for plugins oxlint can't load (`@stylistic`, `flowtype`,
   `babel`, `standard`, `jsonc`, `yml`, `mdx`); swap the globals blob for `env`.
4. `unicorn/prefer-export-from` → bare severity (option name diverges).

## License

MIT
