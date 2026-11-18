import { expect, test } from "bun:test";

import { config, lint, SENTINEL, SENTINEL_RULE, UNUSED_DIRECTIVE } from "./fixture.js";
import base from "./oxlint.config.js";
import withSorting from "./with-sorting.js";

/**
 * oxlint drops a rule whose plugin is not in `plugins` without a word, which
 * is how forty-odd `jsx-a11y` rules sat in this config for months and never
 * ran. A built-in prefix the config names has to be a plugin it turns on.
 */
const BUILT_IN = new Set([
  "import",
  "jsx-a11y",
  "oxc",
  "promise",
  "react",
  "typescript",
  "unicorn",
  "vitest",
]);

test("every built-in plugin a rule names is in `plugins`", () => {
  const ids = [base, config]
    .flatMap(({ overrides = [], rules = {} }) => [rules, ...overrides.map((o) => o.rules ?? {})])
    .flatMap((rules) => Object.keys(rules));
  const prefixes = new Set(ids.filter((id) => id.includes("/")).map((id) => id.split("/")[0]));
  const plugins = new Set(base.plugins);

  for (const prefix of prefixes) {
    if (prefix !== undefined && BUILT_IN.has(prefix)) expect(plugins).toContain(prefix);
  }
});

test("jsx-a11y, oxc and react compiler rules report", () => {
  const found = lint([
    ["src/a.tsx", `${SENTINEL}export const A = () => <img src="x" />;\n`],
    ["src/b.ts", `${SENTINEL}export function f(x: number) {\n  if (x) new Error("x");\n}\n`],
    [
      "src/c.tsx",
      `${SENTINEL}import { useEffect, useState } from "react";
export function C() {
  const [n, setN] = useState(0);
  useEffect(() => {
    setN(1);
  }, []);
  return <br>{n}</br>;
}
`,
    ],
  ]);

  expect(found["src/a.tsx"], "src/a.tsx was never linted").toContain(SENTINEL_RULE);
  expect(found["src/a.tsx"]).toContain("jsx-a11y/alt-text");
  expect(found["src/b.ts"]).toContain("oxc/missing-throw");
  expect(found["src/c.tsx"]).toContain("react/set-state-in-effect");
  expect(found["src/c.tsx"]).toContain("react/void-dom-elements-no-children");
});

test("a disable comment that silences nothing is reported", () => {
  const found = lint([
    ["src/a.ts", `${SENTINEL}// eslint-disable-next-line no-console\nexport const x = 1;\n`],
  ]);

  expect(found["src/a.ts"], "src/a.ts was never linted").toContain(SENTINEL_RULE);
  expect(found["src/a.ts"]).toContain(UNUSED_DIRECTIVE);
});

/**
 * `no-only-tests` is a JS plugin named by package, which the fixture cannot
 * resolve from its temp dir, so only the built-in half runs here. This
 * package linting itself is what loads the plugin.
 */
test("an unawaited expect.poll in a test file is an error", () => {
  const found = lint([
    [
      "src/a.test.ts",
      `${SENTINEL}declare function it(name: string, fn: () => void): void;
declare const expect: { poll(fn: () => number): { toBe(n: number): Promise<void> } };
it("x", () => {
  expect.poll(() => 1).toBe(1);
});
`,
    ],
  ]);

  expect(found["src/a.test.ts"], "src/a.test.ts was never linted").toContain(SENTINEL_RULE);
  expect(found["src/a.test.ts"]).toContain("vitest/require-awaited-expect-poll");
});

/** The split is the whole of 0.5.0's breaking change, so pin both halves of it. */
test("sorting lives in /with-sorting, and nowhere in the base", () => {
  const sortingIn = (rules: Readonly<Record<string, unknown>> = {}) =>
    Object.keys(rules).filter((id) => id.startsWith("perfectionist/"));

  expect(sortingIn(config.rules)).toEqual([]);
  expect(config.jsPlugins).not.toContain("eslint-plugin-perfectionist");

  expect(sortingIn(withSorting.rules).length).toBeGreaterThan(0);
  expect(withSorting.jsPlugins).toContain("eslint-plugin-perfectionist");
  // Everything else the base turns on comes along unchanged.
  expect({ ...withSorting.rules }).toMatchObject({ ...config.rules });
});
