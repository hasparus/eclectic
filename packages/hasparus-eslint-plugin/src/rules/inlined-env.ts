import assert from "assert";
import type { Rule } from "eslint";

export const meta: Rule.RuleMetaData = {
  type: "problem",
  docs: {
    description:
      "Environment variables can be inlined in frontend builds, so destructuring won't work." +
      "\n" +
      "Use `process.env.VARIABLE_NAME` instead to make sure your code can be moved between frontend and backend.",
    category: "Possible Errors",
    recommended: true,
  },
  fixable: "code",
};

export const create = (context: Rule.RuleContext): Rule.RuleListener => {
  return {
    ['VariableDeclaration[kind!="type"][declarations.length=1] >' +
    ` VariableDeclarator:matches(${[
      '[id.type="ObjectPattern"]',
      '[init.type="MemberExpression"]',
      '[init.object.name="process"]',
      '[init.property.name="env"]',
    ].join("")})`]: (node: Rule.Node) => {
      assert(node.type === "VariableDeclarator");
      const { id, init } = node;

      assert(id.type === "ObjectPattern");
      assert(init && init.type === "MemberExpression");

      const { range } = node.parent;
      const { properties } = id;

      context.report({
        node,
        message:
          "Environment variables can be inlined in frontend builds, so destructuring won't work.",
        fix:
          range &&
          ((fixer) => {
            return fixer.replaceTextRange(
              range,
              properties
                .map((p) => {
                  assert(p.type === "Property");
                  assert(p.key.type === "Identifier");
                  return `const ${p.key.name} = process.env.${p.key.name};`;
                })
                .join("\n")
            );
          }),
      });
    },
  };
};
