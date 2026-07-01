import { expect, test } from "bun:test";
import { ESLint } from "eslint";
import tseslint from "typescript-eslint";

import reactConfig from "./react.js";
import solidConfig from "./solid.js";

// The shimmed plugins (solid, react, react-hooks) call context.* methods
// ESLint 10 removed. These lint real code to prove fixupPluginRules actually
// makes them work at runtime — not just typecheck.

test("solid preset lints tsx without crashing and fires solid rules", async () => {
  const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: [
      { files: ["**/*.tsx"], languageOptions: { parser: tseslint.parser } },
      ...solidConfig,
    ],
  });
  const [result] = await eslint.lintText(
    "const C = (props) => { const { a } = props; return <p>{a}</p>; };",
    { filePath: "c.tsx" },
  );
  expect(result?.fatalErrorCount).toBe(0);
  // a solid rule firing proves the shimmed plugin runs (solid/reactivity uses
  // the removed context.getScope under the hood)
  expect(
    result?.messages.some((m) => m.ruleId?.startsWith("solid/")),
  ).toBe(true);
});

test("react preset lints tsx without crashing and fires react rules", async () => {
  const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: [
      { files: ["**/*.tsx"], languageOptions: { parser: tseslint.parser } },
      { files: ["**/*.tsx"], plugins: { react: (await import("eslint-plugin-react")).default } },
      ...reactConfig,
    ],
  });
  const [result] = await eslint.lintText("export const A = () => <div>3 > 2</div>;", {
    filePath: "a.tsx",
  });
  expect(result?.fatalErrorCount).toBe(0);
  expect(
    result?.messages.some((m) => m.ruleId === "react/no-unescaped-entities"),
  ).toBe(true);
});
