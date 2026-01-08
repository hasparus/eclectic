import { FlatCompat } from "@eslint/eslintrc";
import eslint from "@eslint/js";
import { Linter } from "eslint";
import importPlugin from "eslint-plugin-import";
import nPlugin from "eslint-plugin-n";
import perfectionistPlugin from "eslint-plugin-perfectionist";
// @ts-expect-error -- no types
import promisePlugin from "eslint-plugin-promise";
import sonarjsPlugin from "eslint-plugin-sonarjs";
import eslintPluginUnicorn from "eslint-plugin-unicorn";
import { defineConfig } from "eslint/config";
import globals from "globals";
import path from "node:path";
import { fileURLToPath } from "node:url";
import tseslint from "typescript-eslint";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: eslint.configs.recommended,
});

const guildSubconfigs = compat
  .config({
    extends: [
      "@theguild/eslint-config/react",
      "@theguild/eslint-config/json",
      "@theguild/eslint-config/yml",
      "@theguild/eslint-config/mdx",
    ],
  })
  .map((config) => {
    if (!config.plugins) return config;
    const { "@typescript-eslint": _, unicorn: __, ...plugins } = config.plugins;
    return { ...config, plugins };
  });

// rules from @theguild/eslint-config/base (can't import directly — uses @rushstack/eslint-patch)
const guildRules: Linter.Config["rules"] = {
  eqeqeq: ["error", "always", { null: "ignore" }],
  "import/extensions": "off",
  "import/first": "error",
  "import/no-default-export": "error",
  "import/no-duplicates": "error",
  "import/no-useless-path-segments": "error",
  "logical-assignment-operators": [
    "error",
    "always",
    { enforceForIfStatements: true },
  ],
  "n/no-restricted-import": [
    "error",
    [
      { message: "Use `fetch/node-fetch` instead.", name: "axios" },
      { message: "Use `dayjs/date-fns` instead.", name: "moment" },
      {
        message: "Use `clsx` instead because he is faster.",
        name: "classnames",
      },
    ],
  ],
  "no-console": "error",
  "no-else-return": ["error", { allowElseIf: false }],
  "no-implicit-coercion": [
    "error",
    { boolean: false, disallowTemplateShorthand: true },
  ],
  "no-lonely-if": "error",
  "no-restricted-globals": [
    "error",
    "stop",
    "close",
    { message: "Use Number.isNaN instead", name: "isNaN" },
  ],
  "no-self-compare": "error",
  "no-unreachable-loop": "error",
  "object-shorthand": ["error", "always"],
  "prefer-arrow-callback": ["error", { allowNamedFunctions: true }],
  "prefer-const": ["error", { destructuring: "all" }],
  "prefer-object-has-own": "error",
  "promise/no-multiple-resolved": "error",
  "promise/no-nesting": "error",
  quotes: "off",
  "sonarjs/no-gratuitous-expressions": "error",
  "sonarjs/no-identical-conditions": "error",
  "sonarjs/no-nested-switch": "error",
  "sonarjs/no-one-iteration-loop": "off",
  "sonarjs/no-unused-collection": "error",
  "sonarjs/no-use-of-empty-return-value": "error",
  "unicorn/filename-case": "off",
  "unicorn/no-array-for-each": "error",
  "unicorn/no-array-push-push": "error",
  "unicorn/no-empty-file": "error",
  "unicorn/no-instanceof-array": "error",
  "unicorn/no-lonely-if": "error",
  "unicorn/no-negated-condition": "error",
  "unicorn/no-useless-fallback-in-spread": "error",
  "unicorn/no-useless-spread": "error",
  "unicorn/numeric-separators-style": "error",
  "unicorn/prefer-array-find": "error",
  "unicorn/prefer-export-from": ["error", { ignoreUsedVariables: true }],
  "unicorn/prefer-includes": "error",
  "unicorn/prefer-logical-operator-over-ternary": "error",
  "unicorn/prefer-node-protocol": "error",
  "unicorn/prefer-string-trim-start-end": "error",
  yoda: "error",
};

export const theGuild = defineConfig(
  {
    ignores: [
      "dist",
      ".astro",
      "src/routeTree.gen.ts",
      "node_modules",
      "**/.wrangler/tmp/**/*",
      "**/.cache/**/*",
      ".git",
      "eslint.config.*",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.strict,
  ...tseslint.configs.stylistic,
  ...guildSubconfigs,

  {
    rules: {
      // I know `toSorted` exists, and I want to mutate stuff in place.
      "unicorn/no-array-sort": "off",
    },
  },

  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      parserOptions: {
        projectService: true,
      },
    },
    plugins: {
      import: importPlugin,
      n: nPlugin,
      promise: promisePlugin,
      sonarjs: sonarjsPlugin,
    },
    rules: {
      ...guildRules,
      "@typescript-eslint/consistent-type-definitions": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
    },
  },

  {
    plugins: {
      perfectionist: perfectionistPlugin,
    },
    rules: {
      ...perfectionistPlugin.configs["recommended-natural"].rules,
    },
  },
  {
    rules: {
      "perfectionist/sort-classes": "off",
      "perfectionist/sort-enums": "off",
      "perfectionist/sort-imports": [
        "warn",
        {
          internalPattern: ["^#.*"],
        },
      ],
      "perfectionist/sort-jsx-props": "warn",
      "perfectionist/sort-modules": "off",
      "perfectionist/sort-object-types": [
        "warn",
        {
          order: "asc",
          partitionByComment: true,
          type: "natural",
        },
      ],
      "perfectionist/sort-objects": [
        "warn",
        {
          order: "asc",
          partitionByComment: true,
          type: "natural",
        },
      ],
      "perfectionist/sort-union-types": [
        "warn",
        {
          groups: ["unknown", "keyword", "nullish"],
          order: "asc",
          type: "natural",
        },
      ],
    },
  },

  eslintPluginUnicorn.configs["recommended"],
  {
    rules: {
      "unicorn/filename-case": "off",
      "unicorn/import-style": "off",
      "unicorn/no-null": "off",
      "unicorn/prefer-node-protocol": "error",
      "unicorn/prefer-query-selector": "off",
      "unicorn/prevent-abbreviations": "off",
      "unicorn/switch-case-braces": "off",
    },
  },

  {
    files: ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "error",
      "no-undef": "off",
    },
  },
  {
    files: ["**/*.d.ts"],
    rules: {
      "import/no-default-export": "off",
      "no-var": "off",
    },
  },
  {
    files: [
      "**/jest.config.js",
      "**/webpack.config.js",
      "**/bob.config.js",
      "**/babel.config.js",
      "**/postcss.config.{js,cjs}",
      "**/rollup.config.js",
      "**/next-sitemap.config.js",
      "**/vite.config.ts",
      "**/tsup.config.ts",
      "**/prettier.config.js",
    ],
    rules: {
      "import/no-default-export": "off",
    },
  }
);
