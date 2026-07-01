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

## License

MIT
