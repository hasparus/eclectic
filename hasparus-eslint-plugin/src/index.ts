import { ESLint } from "eslint";
import * as inlinedEnv from "./rules/inlined-env";

const plugin: ESLint.Plugin = {
  rules: {
    "inlined-env": inlinedEnv,
  },
  configs: {
    all: {
      rules: {
        // TODO: Discuss if we should enable it only in TSX files or TS files too?
        // Maybe per package?
        "@hasparus/inlined-env": "warn",
      },
    },
  },
};

export = plugin;
