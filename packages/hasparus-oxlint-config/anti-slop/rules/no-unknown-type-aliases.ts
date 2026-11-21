import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

import {
  resolvedTypeMatches,
  type TypeEnvironment,
  withTypeBindings,
} from "../shared/type-alias-resolution.ts";

const resolvesToUnknown = (type: ESTree.TSType, environment: TypeEnvironment): boolean =>
  resolvedTypeMatches(type, environment, (resolved, matches) => {
    if (resolved.type === "TSUnknownKeyword") {
      return true;
    }
    if (resolved.type === "TSParenthesizedType") {
      return matches(resolved.typeAnnotation);
    }
    return resolved.type === "TSUnionType" && resolved.types.some(matches);
  });

/** Ban named aliases that merely conceal TypeScript's unknown top type. */
export const noUnknownTypeAliasesRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow type aliases whose resolved type is unknown; unknown must remain visible at an allowed boundary.",
    },
    messages: {
      unknownAlias:
        "Type alias `{{alias}}` hides `unknown`. Keep `unknown` explicit at the parsing boundary or on an allowed `cause` field; otherwise use the parsed owner type.",
    },
  },
  createOnce(context) {
    const checkAlias = (node: ESTree.TSTypeAliasDeclaration, environment: TypeEnvironment) => {
      if (!resolvesToUnknown(node.typeAnnotation, environment)) {
        return;
      }
      context.report({
        data: { alias: node.id.name },
        messageId: "unknownAlias",
        node: node.id,
      });
    };
    return withTypeBindings(context, (defer) => ({
      TSTypeAliasDeclaration(node: ESTree.TSTypeAliasDeclaration) {
        defer(checkAlias, node);
      },
    }));
  },
});
