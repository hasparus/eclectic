import type { ESTree } from "@oxlint/plugins";

/** The `sourceCode.visitorKeys` table: child keys per node type. */
export type VisitorKeys = Readonly<Record<string, readonly string[]>>;

/** A node whose children can be read by visitor key. */
type IndexedNode = ESTree.Node & Readonly<Record<string, unknown>>;

function isNode(value: unknown): value is IndexedNode {
  return (
    typeof value === "object" && value !== null && "type" in value && typeof value.type === "string"
  );
}

function hasInferTypeParameter(node: IndexedNode, name: string, visitorKeys: VisitorKeys): boolean {
  if (node.type === "TSInferType" && node.typeParameter.name.name === name) {
    return true;
  }
  for (const key of visitorKeys[node.type] ?? []) {
    const value = node[key];
    if (isNode(value) && hasInferTypeParameter(value, name, visitorKeys)) {
      return true;
    }
    if (Array.isArray(value)) {
      const children: readonly unknown[] = value;
      if (children.some((child) => isNode(child) && hasInferTypeParameter(child, name, visitorKeys))) {
        return true;
      }
    }
  }
  return false;
}

/** Check the type parameters introduced at this step of a lexical scope walk. */
export function bindsTypeParameter(
  node: ESTree.Node,
  child: ESTree.Node | null,
  name: string,
  visitorKeys: VisitorKeys,
): boolean {
  return (
    ("typeParameters" in node &&
      node.typeParameters?.params.some((parameter) => parameter.name.name === name) === true) ||
    (node.type === "TSMappedType" &&
      (child === node.nameType || child === node.typeAnnotation) &&
      node.key.name === name) ||
    (node.type === "TSConditionalType" &&
      child === node.trueType &&
      isNode(node.extendsType) &&
      hasInferTypeParameter(node.extendsType, name, visitorKeys))
  );
}
