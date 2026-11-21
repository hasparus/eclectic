import type { Context, ESTree, Visitor } from "@oxlint/plugins";

import { bindsTypeParameter, type VisitorKeys } from "./lexical-type-parameters.ts";

/** A declaration that can bind a name in type space. */
export type TypeBinding =
  | ESTree.Class
  | ESTree.ImportDefaultSpecifier
  | ESTree.ImportNamespaceSpecifier
  | ESTree.ImportSpecifier
  | ESTree.TSEnumDeclaration
  | ESTree.TSInterfaceDeclaration
  | ESTree.TSTypeAliasDeclaration;

/**
 * Type-space declarations of one program, by name and then by the node that scopes them.
 * A `null` binding marks a merged or ambiguous declaration.
 */
export type TypeEnvironment = {
  readonly bindingsByName: Map<string, Map<ESTree.Node, TypeBinding | null>>;
  readonly visitorKeys: VisitorKeys;
};

/** A candidate check that runs once the program's type bindings are all known. */
export type DeferredCheck<N> = (node: N, environment: TypeEnvironment) => void;

/** Queue a candidate check until `Program:exit`. */
export type Defer = <N>(check: DeferredCheck<N>, node: N) => void;

type TypeSubstitution = {
  readonly substitutions: ReadonlyMap<string, TypeSubstitution>;
  readonly type: ESTree.TSType;
};

type TypeMatcher = (
  type: ESTree.TSType,
  matches: (child: ESTree.TSType) => boolean,
) => boolean;

const environmentsByProgram = new WeakMap<ESTree.Program, TypeEnvironment>();

function enclosingTypeScope(node: ESTree.Node): ESTree.Node {
  let current = node.parent;
  while (current !== null) {
    if (
      current.type === "Program" ||
      current.type === "BlockStatement" ||
      current.type === "TSModuleBlock" ||
      current.type === "StaticBlock" ||
      current.type === "SwitchStatement"
    ) {
      return current;
    }
    current = current.parent;
  }
  return node;
}

const bindingTypes: readonly string[] = [
  "ClassDeclaration",
  "ClassExpression",
  "ImportDefaultSpecifier",
  "ImportNamespaceSpecifier",
  "ImportSpecifier",
  "TSEnumDeclaration",
  "TSInterfaceDeclaration",
  "TSTypeAliasDeclaration",
];

function typeBinding(node: ESTree.Node): TypeBinding | null {
  switch (node.type) {
    case "ClassDeclaration":
    case "ClassExpression":
    case "ImportDefaultSpecifier":
    case "ImportNamespaceSpecifier":
    case "ImportSpecifier":
    case "TSEnumDeclaration":
    case "TSInterfaceDeclaration":
    case "TSTypeAliasDeclaration":
      return node;
    default:
      return null;
  }
}

function bindingName(node: TypeBinding): string | undefined {
  return "local" in node ? node.local.name : node.id?.name;
}

function recordBinding(node: ESTree.Node, environment: TypeEnvironment): void {
  const binding = typeBinding(node);
  const name = binding === null ? undefined : bindingName(binding);
  if (binding === null || name === undefined) {
    return;
  }
  let scopes = environment.bindingsByName.get(name);
  if (!scopes) {
    scopes = new Map();
    environment.bindingsByName.set(name, scopes);
  }
  const scope = enclosingTypeScope(binding);
  // Merged or ambiguous declarations cannot be classified from a single node.
  scopes.set(scope, scopes.has(scope) ? null : binding);
}

/**
 * Let Oxlint's traversal index declarations once for all enabled type rules.
 * Defer only candidate checks until the complete index includes forward declarations.
 */
export function withTypeBindings(
  context: Context,
  createVisitors: (defer: Defer) => Visitor,
): Visitor {
  const checks: ((environment: TypeEnvironment) => void)[] = [];
  const visitors = createVisitors((check, node) => {
    checks.push((environment) => check(node, environment));
  });
  let environment: TypeEnvironment | null = null;
  let collect = false;
  for (const kind of bindingTypes) {
    const visit = visitors[kind];
    visitors[kind] = (node: ESTree.Node) => {
      if (collect && environment !== null) {
        recordBinding(node, environment);
      }
      visit?.(node);
    };
  }
  const start = visitors.Program;
  visitors.Program = (program: ESTree.Program) => {
    checks.length = 0;
    const existing = environmentsByProgram.get(program);
    collect = existing === undefined;
    if (existing === undefined) {
      environment = {
        bindingsByName: new Map(),
        visitorKeys: context.sourceCode.visitorKeys,
      };
      environmentsByProgram.set(program, environment);
    } else {
      environment = existing;
    }
    start?.(program);
  };
  visitors["Program:exit"] = () => {
    if (environment !== null) {
      for (const check of checks) {
        check(environment);
      }
    }
    checks.length = 0;
    environment = null;
  };
  return visitors;
}

// undefined means unbound; null means a type parameter or multiple declarations.
export function visibleTypeBinding(
  name: string,
  use: ESTree.Node,
  environment: TypeEnvironment,
): TypeBinding | null | undefined {
  const scopes = environment.bindingsByName.get(name);
  let child: ESTree.Node | null = null;
  for (let node: ESTree.Node | null = use; node; node = node.parent) {
    if (scopes?.has(node)) {
      return scopes.get(node);
    }
    if (bindsTypeParameter(node, child, name, environment.visitorKeys)) {
      return null;
    }
    child = node;
  }
  return undefined;
}

export function visibleTypeAlias(
  name: string,
  use: ESTree.Node,
  environment: TypeEnvironment,
): ESTree.TSTypeAliasDeclaration | null {
  if (!environment.bindingsByName.has(name)) {
    return null;
  }
  const declaration = visibleTypeBinding(name, use, environment);
  return declaration?.type === "TSTypeAliasDeclaration" ? declaration : null;
}

function typeReferenceName(type: ESTree.TSTypeReference): string | null {
  return type.typeName.type === "Identifier" ? type.typeName.name : null;
}

function aliasSubstitutions(
  alias: ESTree.TSTypeAliasDeclaration,
  reference: ESTree.TSTypeReference,
  base: ReadonlyMap<string, TypeSubstitution>,
): ReadonlyMap<string, TypeSubstitution> | null {
  const parameters = alias.typeParameters?.params ?? [];
  const arguments_ = reference.typeArguments?.params ?? [];
  const next = new Map(base);
  for (const [index, parameter] of parameters.entries()) {
    const explicitArgument = arguments_[index];
    const argument = explicitArgument ?? parameter.default;
    if (argument === null || argument === undefined) {
      return null;
    }
    const argumentSubstitutions = explicitArgument === undefined ? next : base;
    next.set(parameter.name.name, {
      substitutions: new Map(argumentSubstitutions),
      type: argument,
    });
  }
  return next;
}

/** Match a type after resolving visible aliases and substituting their type parameters. */
export function resolvedTypeMatches(
  type: ESTree.TSType,
  environment: TypeEnvironment,
  matcher: TypeMatcher,
): boolean {
  const evaluate = (
    current: ESTree.TSType,
    substitutions: ReadonlyMap<string, TypeSubstitution>,
    resolvingAliases: ReadonlySet<ESTree.TSTypeAliasDeclaration>,
  ): boolean => {
    if (current.type === "TSTypeReference") {
      const name = typeReferenceName(current);
      if (name !== null) {
        const substitution = substitutions.get(name);
        if (substitution !== undefined && !current.typeArguments?.params.length) {
          return evaluate(substitution.type, substitution.substitutions, resolvingAliases);
        }
        const alias = visibleTypeAlias(name, current, environment);
        if (alias !== null && !resolvingAliases.has(alias)) {
          const nextSubstitutions = aliasSubstitutions(alias, current, substitutions);
          if (nextSubstitutions !== null) {
            const nextResolving = new Set(resolvingAliases);
            nextResolving.add(alias);
            return evaluate(alias.typeAnnotation, nextSubstitutions, nextResolving);
          }
        }
      }
    }
    return matcher(current, (child) => evaluate(child, substitutions, resolvingAliases));
  };

  return evaluate(type, new Map(), new Set());
}
