import { fixupPluginRules } from "@eslint/compat";
import { Linter } from "eslint";
import solid from "eslint-plugin-solid";

const solidConfig: Linter.Config[] = [
  {
    files: ["**/*.tsx"],
    plugins: {
      solid: fixupPluginRules(
        solid as unknown as Parameters<typeof fixupPluginRules>[0],
      ),
    },
    rules: {
      ...(solid.configs.typescript.rules as Linter.RulesRecord),
      // React-only: nested component defs don't remount in Solid
      "react/no-unstable-nested-components": "off",
    },
  },
];

// eslint-disable-next-line import/no-default-export
export default solidConfig;
