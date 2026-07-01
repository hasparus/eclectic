import tsParser from "@typescript-eslint/parser";
import * as astroParser from "astro-eslint-parser";
import { Linter } from "eslint";
import betterTailwind from "eslint-plugin-better-tailwindcss";
import perfectionistPlugin from "eslint-plugin-perfectionist";

import theGuild from "./the-guild.js";

const perfectionistOff: Linter.RulesRecord = Object.fromEntries(
  Object.keys(
    perfectionistPlugin.configs["recommended-natural"].rules ?? {},
  ).map((rule) => [rule, "off"]),
);

const tailwindClassIgnore = [
  "^zaduma-",
  "^te-",
  "^rm-arrow$",
  "^contains-task-list$",
];

const astro: Linter.Config[] = [
  ...theGuild,

  { rules: { ...perfectionistOff, "unicorn/prefer-global-this": "off" } },

  {
    files: ["**/*.tsx", "**/*.jsx"],
    rules: {
      "better-tailwindcss/no-unknown-classes": [
        "error",
        { ignore: tailwindClassIgnore },
      ],
    },
  },

  {
    files: ["**/*.astro"],
    languageOptions: {
      parser: astroParser,
      parserOptions: {
        extraFileExtensions: [".astro"],
        parser: tsParser,
        project: false,
        projectService: false,
      },
    },
    plugins: { "better-tailwindcss": betterTailwind },
    rules: {
      "better-tailwindcss/no-unknown-classes": [
        "error",
        { ignore: tailwindClassIgnore },
      ],
    },
  },
];

// eslint-disable-next-line import/no-default-export
export default astro;
