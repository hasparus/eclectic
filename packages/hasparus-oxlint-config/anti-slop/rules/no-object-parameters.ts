import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

import {
  functionParameterBindingName,
  functionParameterTypeAnnotation,
} from "../shared/function-parameters.ts";
import {
  resolvedTypeMatches,
  type TypeEnvironment,
  withTypeBindings,
} from "../shared/type-alias-resolution.ts";

type FunctionLike =
  | ESTree.ArrowFunctionExpression
  | ESTree.Function
  | ESTree.TSCallSignatureDeclaration
  | ESTree.TSConstructorType
  | ESTree.TSConstructSignatureDeclaration
  | ESTree.TSFunctionType
  | ESTree.TSMethodSignature;

const resolvesToObject = (type: ESTree.TSType, environment: TypeEnvironment): boolean =>
  resolvedTypeMatches(type, environment, (resolved, matches) => {
    if (resolved.type === "TSObjectKeyword") {
      return true;
    }
    if (resolved.type === "TSParenthesizedType") {
      return matches(resolved.typeAnnotation);
    }
    return resolved.type === "TSUnionType" && resolved.types.some(matches);
  });

/** Ban the broad object type on function inputs, including local aliases to object. */
export const noObjectParametersRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow object function parameters; inputs must use an owner-provided type and be parsed at their boundary.",
    },
    messages: {
      objectParameter:
        "Parameter `{{parameter}}` uses the broad `object` type. Accept a named owner type; parse external input at its boundary before calling this function.",
    },
  },
  createOnce(context) {
    const checkParameter = (parameter: ESTree.ParamPattern, environment: TypeEnvironment) => {
      const annotation = functionParameterTypeAnnotation(parameter);
      if (!annotation) {
        return;
      }
      const type = annotation.typeAnnotation;
      if (resolvesToObject(type, environment)) {
        context.report({
          data: { parameter: functionParameterBindingName(parameter, context.sourceCode) },
          messageId: "objectParameter",
          node: type,
        });
      }
    };

    return withTypeBindings(context, (defer) => {
      const checkParameters = (node: FunctionLike) => {
        for (const parameter of node.params) {
          if (functionParameterTypeAnnotation(parameter)) {
            defer(checkParameter, parameter);
          }
        }
      };
      return {
        ArrowFunctionExpression: checkParameters,
        FunctionDeclaration: checkParameters,
        FunctionExpression: checkParameters,
        TSCallSignatureDeclaration: checkParameters,
        TSConstructorType: checkParameters,
        TSConstructSignatureDeclaration: checkParameters,
        TSDeclareFunction: checkParameters,
        TSEmptyBodyFunctionExpression: checkParameters,
        TSFunctionType: checkParameters,
        TSMethodSignature: checkParameters,
      };
    });
  },
});
