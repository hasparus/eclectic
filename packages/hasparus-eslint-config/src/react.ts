import { Linter } from "eslint";
import reactPlugin from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";

import { shimLegacyPlugin } from "./fixup.js";

// React add-on: layer on top of the root config (which already defines the
// `react` plugin + JSX hygiene). Adds react/recommended, jsx-runtime, and
// react-hooks — the React-DOM/hooks semantics the base omits.
const react: Linter.Config[] = [
  {
    files: ["**/*.jsx", "**/*.tsx"],
    plugins: { "react-hooks": shimLegacyPlugin(reactHooks) },
    rules: {
      ...reactPlugin.configs.flat.recommended!.rules,
      ...reactPlugin.configs.flat["jsx-runtime"]!.rules,
      ...reactHooks.configs["recommended-latest"].rules,
    },
    // explicit version so react rules skip getFilename-based version detection
    settings: { react: { version: "999.999.999" } },
  },
];

// eslint-disable-next-line import-x/no-default-export
export default react;
