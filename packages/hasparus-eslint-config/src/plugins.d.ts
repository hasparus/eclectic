// Type declarations for the two ESLint plugins we use that ship no types.
declare module "eslint-plugin-promise" {
  import type { ESLint } from "eslint";

  const plugin: ESLint.Plugin;
  export default plugin;
}

declare module "eslint-plugin-jsx-a11y" {
  import type { Linter } from "eslint";

  const plugin: { flatConfigs: { recommended: Linter.Config } };
  export default plugin;
}
