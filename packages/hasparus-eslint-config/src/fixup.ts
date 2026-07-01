import type { ESLint } from "eslint";

import { fixupPluginRules } from "@eslint/compat";

// eslint-plugin-{react,react-hooks,solid,n,promise} call context.* methods
// (getScope, getSourceCode, markVariableAsUsed, …) that ESLint 10 removed.
// fixupPluginRules shims them at runtime. Some of these plugins also type their
// rules against @typescript-eslint/utils' older RuleContext, which predates
// ESLint's flat `Plugin` type — hence the single assertion on the input here.
// The return is properly typed, so call sites stay clean.
export const shimLegacyPlugin = (plugin: unknown): ESLint.Plugin =>
  fixupPluginRules(plugin as Parameters<typeof fixupPluginRules>[0]);
