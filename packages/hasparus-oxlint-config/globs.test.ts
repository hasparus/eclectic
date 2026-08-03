import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/**
 * A glob one star too wide silences a rule in every consumer repo and says
 * nothing. So these run the binary over real paths and read the rule ids back.
 */

/** As a consumer assembles it: the base, with the shared overrides spread in. */
const imported = await import("./oxlint.config.js");
const config = { ...imported.default, overrides: imported.overrides };

/**
 * Every fixture carries a `debugger`, which no override touches. Without it a
 * typo in an `off()` path passes: nothing reported reads the same as a rule
 * correctly disabled.
 */
const SENTINEL = "debugger;\n";
const SENTINEL_RULE = "eslint/no-debugger";

/** Sources chosen so the rule under test is the only other one that can fire. */
const DEFAULT_EXPORT = `${SENTINEL}export default function Thing() {\n  return 1;\n}\n`;
const INNER_TEXT = `${SENTINEL}export const read = (el) => el.innerText;\n`;

/** The pinned binary, not whatever `bunx` would fetch if resolution missed. */
const OXLINT = join(
  dirname(Bun.fileURLToPath(import.meta.resolve("oxlint/package.json"))),
  "bin/oxlint",
);

/**
 * The JS plugins would have to resolve from the fixture tree and own no rule
 * under test. Their rules go with them, since oxlint refuses a config naming a
 * plugin it has not loaded. Globs are untouched.
 */
type Rules = Record<string, unknown>;
type Config = {
  jsPlugins?: string[];
  overrides?: { rules?: Rules }[];
  rules?: Rules;
};

function withoutJsPlugins({ jsPlugins = [], overrides = [], rules = {}, ...rest }: Config) {
  const owned = jsPlugins.map((name) => name.replace("eslint-plugin-", "") + "/");
  const keep = (by: Rules) =>
    Object.fromEntries(Object.entries(by).filter(([id]) => !owned.some((p) => id.startsWith(p))));

  return {
    ...rest,
    overrides: overrides.map((o) => ({ ...o, rules: keep(o.rules ?? {}) })),
    rules: keep(rules),
  };
}

/**
 * Rule ids oxlint reports for each file, laid out at that exact path. Pairs
 * rather than an object, so each case keeps the comment explaining it.
 */
function lint(files: [path: string, source: string][]) {
  const root = mkdtempSync(join(tmpdir(), "oxlint-globs-"));

  for (const [path, source] of files) {
    mkdirSync(join(root, dirname(path)), { recursive: true });
    writeFileSync(join(root, path), source);
  }

  writeFileSync(join(root, ".oxlintrc.json"), JSON.stringify(withoutJsPlugins(config)));

  const { stdout } = Bun.spawnSync({
    cmd: [OXLINT, "-c", ".oxlintrc.json", "--format", "json", "."],
    cwd: root,
  });

  const report = JSON.parse(stdout.toString()) as {
    diagnostics: { code: string; filename: string }[];
  };

  const byFile: Record<string, string[]> = {};
  for (const [path] of files) byFile[path] = [];
  for (const { code, filename } of report.diagnostics) {
    // oxlint reports `plugin(rule)`; say it the way the config spells it.
    byFile[filename.replace(/^\.\//, "")]?.push(code.replace(/^(.+)\((.+)\)$/, "$1/$2"));
  }

  return byFile;
}

test("import/no-default-export is off for Next's file conventions and on elsewhere", () => {
  const found = lint([
    ["app/page.tsx", DEFAULT_EXPORT],
    ["app/blog/[slug]/page.tsx", DEFAULT_EXPORT],
    ["app/forbidden.tsx", DEFAULT_EXPORT],
    ["app/opengraph-image2.tsx", DEFAULT_EXPORT],
    ["src/app/layout.tsx", DEFAULT_EXPORT],
    ["apps/web/app/page.tsx", DEFAULT_EXPORT],

    // Route handlers export GET/POST by name, so the rule still applies.
    ["app/api/users/route.ts", DEFAULT_EXPORT],
    // Only the image routes take a numeric suffix; there is no `page1`.
    ["app/page1.tsx", DEFAULT_EXPORT],
    ["app/layout99.tsx", DEFAULT_EXPORT],
    // An `app` directory deeper than the anchors reach.
    ["src/lib/app/error.ts", DEFAULT_EXPORT],
    // The React convention of grouping page components — not Next's `pages`.
    ["src/components/pages/HomePage.tsx", DEFAULT_EXPORT],
    ["packages/ui/pages/Button.tsx", DEFAULT_EXPORT],
    // Pages Router is not claimed: no filename to narrow on.
    ["pages/index.tsx", DEFAULT_EXPORT],
    ["src/utils/thing.ts", DEFAULT_EXPORT],
  ]);

  const off = (path: string) => {
    expect(found[path], `${path} was never linted`).toContain(SENTINEL_RULE);
    expect(found[path]).not.toContain("import/no-default-export");
  };
  const on = (path: string) => expect(found[path]).toContain("import/no-default-export");

  off("app/page.tsx");
  off("app/blog/[slug]/page.tsx");
  off("app/forbidden.tsx");
  off("app/opengraph-image2.tsx");
  off("src/app/layout.tsx");
  off("apps/web/app/page.tsx");

  on("app/api/users/route.ts");
  on("app/page1.tsx");
  on("app/layout99.tsx");
  on("src/components/pages/HomePage.tsx");
  on("packages/ui/pages/Button.tsx");
  on("pages/index.tsx");
  on("src/utils/thing.ts");

  // Residual of the `**` prefix: the filename is the only thing narrowing it.
  off("src/lib/app/error.ts");
});

test("unicorn/prefer-dom-node-text-content is off for Playwright specs only", () => {
  const found = lint([
    ["e2e/cart.spec.ts", INNER_TEXT],
    ["apps/web/e2e/cart.spec.ts", INNER_TEXT],
    ["playwright/cart.test.ts", INNER_TEXT],
    ["src/e2e/checkout.spec.ts", INNER_TEXT],

    // Real DOM code that happens to live beside the specs.
    ["e2e/helpers/dom.ts", INNER_TEXT],
    ["src/components/Thing.ts", INNER_TEXT],
  ]);

  const rule = "unicorn/prefer-dom-node-text-content";

  const off = (path: string) => {
    expect(found[path], `${path} was never linted`).toContain(SENTINEL_RULE);
    expect(found[path]).not.toContain(rule);
  };

  off("e2e/cart.spec.ts");
  off("apps/web/e2e/cart.spec.ts");
  off("playwright/cart.test.ts");
  // Not anchored: an `e2e` directory at any depth counts.
  off("src/e2e/checkout.spec.ts");

  expect(found["e2e/helpers/dom.ts"]).toContain(rule);
  expect(found["src/components/Thing.ts"]).toContain(rule);
});
