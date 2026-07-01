import { fixupPluginRules } from "@eslint/compat";
import { Linter } from "eslint";
import reactPlugin from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";

// React add-on: layer on top of the root config (which already defines the
// `react` plugin + JSX hygiene). Adds react/recommended, jsx-runtime, and
// react-hooks — the React-DOM/hooks semantics the base omits.
const react: Linter.Config[] = [
  {
    files: ["**/*.jsx", "**/*.tsx"],
    plugins: {
      "react-hooks": fixupPluginRules(
        reactHooks as unknown as Parameters<typeof fixupPluginRules>[0],
      ),
    },
    rules: {
      ...reactPlugin.configs.flat.recommended!.rules,
      ...reactPlugin.configs.flat["jsx-runtime"]!.rules,
      ...(reactHooks.configs["recommended-latest"].rules),
    },
    settings: { react: { version: "detect" } },
  },
];

// eslint-disable-next-line import/no-default-export
export default react;
