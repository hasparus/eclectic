import eslint from "@eslint/js";
import perfectionistPlugin from "eslint-plugin-perfectionist";
import eslintPluginUnicorn from "eslint-plugin-unicorn";
import tseslint, { type ConfigWithExtends } from "typescript-eslint";
import globals from "globals";
// @ts-expect-error -- no types
import guildConfig from "@theguild/eslint-config/base";
import importPlugin from "eslint-plugin-import";
// @ts-expect-error -- no types
import promisePlugin from "eslint-plugin-promise";
import nPlugin from "eslint-plugin-n";
import sonarjsPlugin from "eslint-plugin-sonarjs";

export const theGuild: ReturnType<typeof tseslint.config> = tseslint.config(
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

  {
    plugins: {
      import: importPlugin,
      promise: promisePlugin,
      n: nPlugin,
      // @ts-expect-error -- plugin type compatibility issue
      sonarjs: sonarjsPlugin,
    },
    rules: {
      ...guildConfig.rules,
      "no-console": "error",
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
      "@typescript-eslint/consistent-type-definitions": "off",

      // TypeScript checks this
      "import/extensions": "off",
    },
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      parserOptions: {
        projectService: true,
      },
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
      "perfectionist/sort-object-types": [
        "warn",
        {
          type: "natural",
          order: "asc",
          partitionByComment: true,
        },
      ],
      "perfectionist/sort-union-types": [
        "warn",
        {
          type: "natural",
          groups: ["unknown", "keyword", "nullish"],
          order: "asc",
        },
      ],
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
      "perfectionist/sort-objects": [
        "warn",
        {
          type: "natural",
          order: "asc",
          partitionByComment: true,
        },
      ],
    },
  },

  eslintPluginUnicorn.configs["recommended"],
  {
    rules: {
      "unicorn/import-style": "off",
      "unicorn/no-null": "off",
      "unicorn/prefer-query-selector": "off",
      "unicorn/prevent-abbreviations": "off",
      "unicorn/switch-case-braces": "off",
      "unicorn/prefer-node-protocol": "error",
    },
  },

  {
    files: ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"],
    rules: {
      "no-undef": "off",
      "@typescript-eslint/consistent-type-assertions": "error",
    },
  },
  {
    files: ["**/*.d.ts"],
    rules: {
      "no-var": "off",
      "import/no-default-export": "off",
    },
  },
  {
    files: [
      "jest.config.js",
      "webpack.config.js",
      "bob.config.js",
      "babel.config.js",
      "postcss.config.{js,cjs}",
      "rollup.config.js",
      "next-sitemap.config.js",
      "vite.config.ts",
      "tsup.config.ts",
      "prettier.config.js",
    ],
    rules: {
      "import/no-default-export": "off",
    },
  }
);
