/**
 * @file ESLint rules for projects where I'm the main/only dev at The Guild
 * Note that all enabled rules here are set to "warn" apart from SonarJS.
 * Only Sonar and TypeScript deserve red squiggles.
 */
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
  eqeqeq: ["warn", "always", { null: "ignore" }],
  "import/extensions": "off",
  "import/first": "warn",
  "import/no-default-export": "warn",
  "import/no-duplicates": "warn",
  "import/no-useless-path-segments": "warn",
  "logical-assignment-operators": [
    "warn",
    "always",
    { enforceForIfStatements: true },
  ],
  "n/no-restricted-import": [
    "warn",
    [
      { message: "Use `fetch/node-fetch` instead.", name: "axios" },
      { message: "Use `dayjs/date-fns` instead.", name: "moment" },
      {
        message: "Use `clsx` instead because he is faster.",
        name: "classnames",
      },
    ],
  ],
  "no-console": "warn",
  "no-else-return": ["warn", { allowElseIf: false }],
  "no-implicit-coercion": [
    "warn",
    { boolean: false, disallowTemplateShorthand: true },
  ],
  "no-lonely-if": "warn",
  "no-restricted-globals": [
    "warn",
    "stop",
    "close",
    { message: "Use Number.isNaN instead", name: "isNaN" },
  ],
  "no-self-compare": "warn",
  "no-unreachable-loop": "warn",
  "object-shorthand": ["warn", "always"],
  "prefer-arrow-callback": ["warn", { allowNamedFunctions: true }],
  "prefer-const": ["warn", { destructuring: "all" }],
  "prefer-object-has-own": "warn",
  "promise/no-multiple-resolved": "warn",
  "promise/no-nesting": "warn",
  quotes: "off",
  "sonarjs/no-gratuitous-expressions": "error",
  "sonarjs/no-identical-conditions": "error",
  "sonarjs/no-nested-switch": "error",
  "sonarjs/no-one-iteration-loop": "off",
  "sonarjs/no-unused-collection": "error",
  "sonarjs/no-use-of-empty-return-value": "error",
  "unicorn/filename-case": "warn",
  "unicorn/no-array-for-each": "warn",
  "unicorn/no-array-push-push": "warn",
  "unicorn/no-empty-file": "warn",
  "unicorn/no-instanceof-array": "warn",
  "unicorn/no-lonely-if": "warn",
  "unicorn/no-negated-condition": "warn",
  // conflicts with Prettier
  "unicorn/no-nested-ternary": "off",
  "unicorn/no-useless-fallback-in-spread": "warn",
  "unicorn/no-useless-spread": "warn",
  "unicorn/numeric-separators-style": "warn",
  "unicorn/prefer-array-find": "warn",
  "unicorn/prefer-export-from": ["warn", { ignoreUsedVariables: true }],
  "unicorn/prefer-includes": "warn",
  "unicorn/prefer-logical-operator-over-ternary": "warn",
  "unicorn/prefer-node-protocol": "warn",
  "unicorn/prefer-string-trim-start-end": "warn",
  yoda: "warn",
};

const theGuild: Linter.Config[] = defineConfig(
  {
    ignores: [
      "dist",
      ".astro",
      "src/routeTree.gen.ts",
      "node_modules",
      "**/.wrangler/tmp/**/*",
      "**/.cache/**/*",
      ".git",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.strict,
  ...tseslint.configs.stylistic,
  ...guildSubconfigs,

  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      parserOptions: {
        projectService: {
          allowDefaultProject: true,
        },
      },
    },
    plugins: {
      import: importPlugin,
      n: nPlugin,
      promise: promisePlugin,
      sonarjs: sonarjsPlugin,
    },
    rules: {
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
      "unicorn/no-array-sort": "off",
      "unicorn/no-null": "off",
      "unicorn/prefer-node-protocol": "warn",
      "unicorn/prefer-query-selector": "off",
      "unicorn/prevent-abbreviations": "off",
      "unicorn/switch-case-braces": "off",
    },
  },

  {
    files: ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"],
    rules: {
      "@typescript-eslint/consistent-type-assertions": "warn",
      "no-undef": "off",
    },
  },
  {
    rules: {
      ...guildRules,
      // I know `toSorted` exists, and I want to mutate stuff in place.
      "unicorn/no-array-sort": "off",
      // This is just a better extension and I don't wanna rename files depending on content.
      "react/jsx-filename-extension": "off",
      // TypeScript should suffice here, and if not, I'd assume we have tests
      "unicorn/no-array-callback-reference": "off",
    },
  },

  {
    files: ["**/*.d.ts", "**/*.config.*", "*.config.*"],
    rules: {
      "import/no-default-export": "off",
      "no-var": "off",
    },
  }
);

// eslint-disable-next-line import/no-default-export
export default theGuild;
