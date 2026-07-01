import { Linter } from "eslint";
import solid from "eslint-plugin-solid";

const solidTypescript = solid.configs["flat/typescript"];

const solidConfig: Linter.Config[] = [
  {
    files: ["**/*.tsx"],
    // @ts-expect-error -- solid's rule types lag ESLint's flat Plugin type
    // (older @typescript-eslint/utils RuleContext); runtime-checked in solid.test.ts
    plugins: solidTypescript.plugins,
    rules: {
      ...solidTypescript.rules,
      // React-only: nested component defs don't remount in Solid
      "react/no-unstable-nested-components": "off",
    },
  },
];

// eslint-disable-next-line import-x/no-default-export
export default solidConfig;
