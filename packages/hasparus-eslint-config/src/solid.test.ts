import { expect, test } from "bun:test";
import solid from "eslint-plugin-solid";

// Guards the @ts-expect-error in solid.ts: the plugin's *types* lag ESLint's
// flat Plugin type, but the runtime shape we rely on must hold.
test("eslint-plugin-solid exposes flat/typescript with a rules-bearing plugin", () => {
  const config = solid.configs["flat/typescript"];
  const plugin = config.plugins.solid as { rules?: Record<string, unknown> };
  expect(typeof plugin.rules?.["no-destructure"]).toBe("object");
  expect(config.rules?.["solid/no-destructure"]).toBeDefined();
});
