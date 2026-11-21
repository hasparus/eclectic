# anti-slop, vendored

Seventeen oxlint rules from two places, both MIT (see [`LICENSE`](./LICENSE)).
Neither upstream publishes these rules as a package to depend on, so the copy
lives here and ships inside `@hasparus/oxlint-config`.

**Twelve rules from [`@nkzw/oxlint-config`](https://github.com/nkzw-tech/oxlint-config)
3.0.0**, from its `quality/` directory. That directory is nkzw's rewrite of
dmmulroy/anti-slop at `13909c9e07590f5a85d93c62712259fe14a883f7`. It skips some
false positives the original reports, for example a `Record<"a" | "b", T>`
whose keys are all known, or `Record<string, unknown>` used as a generic
constraint. It also adds two new rules. nkzw publishes plain JavaScript, so
these files are a TypeScript port of it:

- `no-array-filter-map` (new)
- `no-chained-type-assertions`
- `no-conditional-empty-object-spread`
- `no-known-value-widening`
- `no-object-parameters`
- `no-reduce-accumulator-copy` (new)
- `no-reflect-apply`
- `no-reflect-get`
- `no-unknown-returns`
- `no-unknown-type-aliases`
- `no-unsafe-dictionary-type`
- `no-widen-then-assert`

The shared helpers in `shared/` are from the same place, except where noted
below.

**Five rules from [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop)**
at `446268e5d15baa968eaec669ff65358d36ae6259` (2026-08-14). nkzw dropped these,
so they stay as they were:

- `no-module-mocking`
- `no-runtime-typeof`
- `no-shape-in-symbol-names`
- `no-unknown-parameters`
- `require-safety-comment-for-type-assertion`

All seventeen register under one plugin name, `anti-slop`, in `index.ts`, so
existing disable comments keep working.

The rules are exercised from `../anti-slop.test.ts`, which runs the oxlint
binary over one violation apiece. A config a consumer loads out of
`node_modules` breaks by the plugin never loading, and a unit test of the rules
would not notice that. The `.js` beside each `.ts` is build output, git-ignored;
`bun run build` writes it.

## Checking the port

The port was checked against nkzw's JavaScript on 1,672 TypeScript files (zod
and eslint-plugin-solid sources, copied six times), plus a small file aimed at
the three rules those sources never trigger. Both copies reported the same
2,162 findings, at the same offsets. The five dmmulroy rules reported the same
8,809 findings before and after the port.

## Local deltas

One, in `shared/dictionary-types.ts`: `unsafeMembers[0] ?? null`, where upstream
writes `unsafeMembers[0]`. This package type-checks with
`noUncheckedIndexedAccess`, which does not narrow an index access through a
`length > 0` guard. Same value at runtime either way.

## Updating

For the nkzw rules, unpack the new `@nkzw/oxlint-config` and diff its
`quality/` directory against the version above. Port the changes by hand,
because the source is JavaScript and this copy is TypeScript:

```
npm pack @nkzw/oxlint-config@<version>
tar xzf nkzw-oxlint-config-<version>.tgz
diff -ru <old>/package/quality package/quality
```

For the dmmulroy rules:

```
git clone --depth 1 https://github.com/dmmulroy/anti-slop
cp anti-slop/src/rules/{no-module-mocking,no-runtime-typeof,no-shape-in-symbol-names,no-unknown-parameters,require-safety-comment-for-type-assertion}.ts \
  packages/hasparus-oxlint-config/anti-slop/rules/
```

Then record the new versions above, re-apply the delta, and run `bun run build
&& bun test`. The tests fail if a rule is added that the config does not name,
or renamed while the config still names it. `tsc -p tsconfig.json` fails if the
delta went missing.
