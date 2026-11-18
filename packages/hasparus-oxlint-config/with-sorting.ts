import { defineConfig, type DummyRule } from "oxlint";

import base from "./oxlint.config.ts";

export { ignorePatterns, overrides } from "./oxlint.config.ts";

/** perfectionist default: natural, ascending. */
const natural: DummyRule = ["warn", { order: "asc", type: "natural" }];

/**
 * The base, plus perfectionist's sorting rules. They were in the base until
 * 0.5.0; they are a preset of their own now, so a repo that does not want its
 * keys reordered can say so by importing the other one.
 *
 * Spread rather than `extends`, so the base's `overrides` and `ignorePatterns`
 * stay on the object. Consumers still spread both into their root config, the
 * same as with the base — `extends` drops them whichever config they come from.
 */
// eslint-disable-next-line import/no-default-export -- oxlint reads a config by default export.
export default defineConfig({
  ...base,
  jsPlugins: [...(base.jsPlugins ?? []), "eslint-plugin-perfectionist"],
  rules: {
    ...base.rules,
    "perfectionist/sort-array-includes": natural,
    "perfectionist/sort-decorators": natural,
    "perfectionist/sort-exports": natural,
    "perfectionist/sort-heritage-clauses": natural,
    "perfectionist/sort-interfaces": natural,
    "perfectionist/sort-intersection-types": natural,
    "perfectionist/sort-jsx-props": "warn",
    "perfectionist/sort-maps": natural,
    "perfectionist/sort-named-exports": natural,
    "perfectionist/sort-named-imports": natural,
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
    "perfectionist/sort-sets": natural,
    "perfectionist/sort-switch-case": natural,
    "perfectionist/sort-union-types": [
      "warn",
      {
        groups: ["unknown", "keyword", "nullish"],
        order: "asc",
        type: "natural",
      },
    ],
    "perfectionist/sort-variable-declarations": natural,
  },
});
