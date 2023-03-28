import { ESLint } from "eslint";
import * as inlinedEnv from "./rules/inlined-env";

const plugin: ESLint.Plugin = {
  rules: {
    "inlined-env": inlinedEnv,
  },
  configs: {
    all: {
      rules: {
        "@hasparus/inlined-env": "warn",
      },
    },
  },
};

export = plugin;
