import { expect, test } from "bun:test";
import type { DummyRule } from "oxlint";

import { config, lint, SENTINEL, SENTINEL_RULE, UNUSED_DIRECTIVE } from "./lint.test-utils.js";
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
    .flatMap(({ overrides, rules }) => [rules, ...overrides.map((o) => o.rules ?? {})])
    .flatMap((rules) => Object.keys(rules));
  const prefixes = new Set(ids.flatMap((id) => (id.includes("/") ? [id.split("/")[0]] : [])));
  const plugins = new Set<string>(base.plugins);

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
      `${SENTINEL}it("x", () => {
  expect.poll(() => 1).toBe(1);
});
`,
    ],
  ]);

  expect(found["src/a.test.ts"], "src/a.test.ts was never linted").toContain(SENTINEL_RULE);
  expect(found["src/a.test.ts"]).toContain("vitest/require-awaited-expect-poll");
});

const sortingIn = (rules: Readonly<Record<string, DummyRule>>) =>
  Object.keys(rules).filter((id) => id.startsWith("perfectionist/"));

/** The split is the whole of 0.5.0's breaking change, so pin both halves of it. */
test("sorting lives in /with-sorting, and nowhere in the base", () => {
  expect(sortingIn(config.rules)).toEqual([]);
  expect(config.jsPlugins).not.toContain("eslint-plugin-perfectionist");

  expect(sortingIn(withSorting.rules).length).toBeGreaterThan(0);
  expect(withSorting.jsPlugins).toContain("eslint-plugin-perfectionist");
  // Everything else the base turns on comes along unchanged.
  expect({ ...withSorting.rules }).toMatchObject({ ...config.rules });
});

/**
 * landmines is a dependency named by resolved `file:` URL, so unlike the
 * plugins named by package it loads from the fixture's temp dir too.
 */
test("landmines rules report, and Playwright keeps its .spec.ts names", () => {
  const found = lint([
    [
      "src/a.test.ts",
      `${SENTINEL}import { test, vi } from "vitest";
vi.mock("./b");
test("x", async () => {
  await new Promise((resolve) => setTimeout(resolve, 100));
}, { retry: 3 });
`,
    ],
    ["src/b.ts", `${SENTINEL}export function b(): number {\n  return 1;\n}\n`],
    ["src/c.spec.ts", SENTINEL],
    ["e2e/home.spec.ts", SENTINEL],
  ]);

  expect(found["src/a.test.ts"], "src/a.test.ts was never linted").toContain(SENTINEL_RULE);
  expect(found["src/a.test.ts"]).toContain("landmines-testing/no-test-doubles");
  expect(found["src/a.test.ts"]).toContain("landmines-testing/no-fixed-sleep");
  expect(found["src/a.test.ts"]).toContain("landmines-testing/no-flake-masking");
  expect(found["src/a.test.ts"]).not.toContain("anti-slop/no-module-mocking");
  expect(found["src/b.ts"]).toContain("landmines-types/no-explicit-return-types");
  expect(found["src/c.spec.ts"]).toContain("landmines-structure/test-file-names");
  expect(found["e2e/home.spec.ts"], "e2e/home.spec.ts was never linted").toContain(SENTINEL_RULE);
  expect(found["e2e/home.spec.ts"]).not.toContain("landmines-structure/test-file-names");
});

test("landmines' no-comments stays off", () => {
  const found = lint([["src/a.ts", `${SENTINEL}// A sentence of prose.\nexport const a = 1;\n`]]);

  expect(found["src/a.ts"], "src/a.ts was never linted").toContain(SENTINEL_RULE);
  expect(found["src/a.ts"]).not.toContain("landmines-style/no-comments");
});
