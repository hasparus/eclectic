import { defineConfig } from "oxlint";

import withSorting from "./with-sorting.ts";

/**
 * How this package lints itself: the shipped preset with sorting, minus
 * landmines' `no-comments`. The configs here explain each rule and override
 * in prose, which is the one thing that rule bans. Not shipped; consumers get
 * `no-comments` on.
 */
export default defineConfig({
  ...withSorting,
  rules: { ...withSorting.rules, "landmines-style/no-comments": "off" },
});
