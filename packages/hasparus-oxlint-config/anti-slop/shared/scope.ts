import type { ESTree, Scope, SourceCode, Variable } from "@oxlint/plugins";

/** Any node spelled as an identifier. */
export type IdentifierNode = Extract<ESTree.Node, { type: "Identifier" }>;

/** Resolve an identifier to its binding by walking lexical scopes upward. */
export function resolveVariable(
  sourceCode: SourceCode,
  identifier: IdentifierNode,
): Variable | null {
  let scope: Scope | null = sourceCode.getScope(identifier);
  while (scope !== null) {
    const variable = scope.set.get(identifier.name);
    if (variable !== undefined) {
      return variable;
    }
    scope = scope.upper;
  }
  return null;
}
