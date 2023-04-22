import tsEslintParser from "@typescript-eslint/parser";

const pluginHasparus = await import("./dist/index.js").then((m) => m.default);

/**
 * @see https://eslint.org/blog/2022/08/new-config-system-part-2/
 * A flat ESLint config
 * @type {import('eslint').Linter.Config[]}
 */
export default [
  // pluginHasparus.configs.all,
  {
    files: ["**/*.ts", "**/*.spec.ts"],
    plugins: {
      "@hasparus": pluginHasparus,
    },
    rules: {
      "for-direction": "warn",
      "@hasparus/inlined-env": "warn",
    },
    languageOptions: {
      parser: tsEslintParser,
      parserOptions: {
        project: true,
      },
    },
  },
];
