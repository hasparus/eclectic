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
      "react-hooks/immutability": "off",
      "react-hooks/refs": "off",
      "react/no-unknown-property": "off",
    },
  },
];

// eslint-disable-next-line import/no-default-export
export default solidConfig;
