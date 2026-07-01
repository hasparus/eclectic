import { Linter } from "eslint";
import solid from "eslint-plugin-solid";

import { shimLegacyPlugin } from "./fixup.js";

const solidTypescript = solid.configs["flat/typescript"];

const solidConfig: Linter.Config[] = [
  {
    files: ["**/*.tsx"],
    plugins: { solid: shimLegacyPlugin(solidTypescript.plugins.solid) },
    rules: {
      ...solidTypescript.rules,
      // React-only: nested component defs don't remount in Solid
      "react/no-unstable-nested-components": "off",
    },
  },
];

// eslint-disable-next-line import-x/no-default-export
export default solidConfig;
