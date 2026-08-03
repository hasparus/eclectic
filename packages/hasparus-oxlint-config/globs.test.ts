import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/**
 * The overrides in this config are globs, and a glob that is one star too wide
 * silences a rule in every consumer repo without telling anyone. `**‍/app/**`
 * and `**‍/pages/**` both looked right and both matched ordinary directories.
 *
 * So these run the real binary over real paths and read the real rule ids back.
 */

/**
 * The config has to sit at the root of the tree being linted: oxlint anchors a
 * relative override glob to the directory its config file is in, which for a
 * consumer is their repo root.
 */
const config = (await import("./oxlint.config.js")).default;

/** Sources chosen so the rule under test is the only one that can fire. */
const DEFAULT_EXPORT = "export default function Thing() {\n  return 1;\n}\n";
const INNER_TEXT = "export const read = (el) => el.innerText;\n";

/**
 * The JS plugins would have to resolve from the fixture tree, and none of them
 * owns a rule under test. Their rules go with them — oxlint refuses a config
 * naming a plugin it has not loaded. Overrides and globs are untouched.
 */
function withoutJsPlugins({ jsPlugins = [], rules = {}, overrides = [], ...rest }: any) {
  const owned = jsPlugins.map((name: string) => name.replace("eslint-plugin-", "") + "/");
  const keep = (by: object) =>
    Object.fromEntries(
      Object.entries(by).filter(([id]) => !owned.some((prefix: string) => id.startsWith(prefix))),
    );

  return {
    ...rest,
    rules: keep(rules),
    overrides: overrides.map((o: any) => ({ ...o, rules: keep(o.rules ?? {}) })),
  };
}

/** Rule ids oxlint reports for the given file, laid out at that exact path. */
function lint(files: { [path: string]: string }) {
  const root = mkdtempSync(join(tmpdir(), "oxlint-globs-"));

  for (const path in files) {
    mkdirSync(join(root, dirname(path)), { recursive: true });
    writeFileSync(join(root, path), files[path]!);
  }

  writeFileSync(join(root, ".oxlintrc.json"), JSON.stringify(withoutJsPlugins(config)));

  const { stdout } = Bun.spawnSync({
    cmd: ["bunx", "oxlint", "-c", ".oxlintrc.json", "--format", "json", "."],
    cwd: root,
  });

  const report = JSON.parse(stdout.toString()) as {
    diagnostics: { code: string; filename: string }[];
  };

  const byFile: { [path: string]: string[] } = {};
  for (const path in files) byFile[path] = [];
  for (const { code, filename } of report.diagnostics) {
    // oxlint reports `plugin(rule)`; say it the way the config spells it.
    byFile[filename.replace(/^\.\//, "")]?.push(code.replace(/^(.+)\((.+)\)$/, "$1/$2"));
  }

  return byFile;
}

test("import/no-default-export is off for Next's file conventions and on elsewhere", () => {
  const found = lint({
    "app/page.tsx": DEFAULT_EXPORT,
    "app/blog/[slug]/page.tsx": DEFAULT_EXPORT,
    "app/forbidden.tsx": DEFAULT_EXPORT,
    "app/opengraph-image2.tsx": DEFAULT_EXPORT,
    "src/app/layout.tsx": DEFAULT_EXPORT,
    "apps/web/app/page.tsx": DEFAULT_EXPORT,
    "pages/index.tsx": DEFAULT_EXPORT,
    "src/pages/about.tsx": DEFAULT_EXPORT,

    // Route handlers export GET/POST by name, so the rule still applies.
    "app/api/users/route.ts": DEFAULT_EXPORT,
    // A directory called `app` that is not a Next route root.
    "lib/app/error.ts": DEFAULT_EXPORT,
    // The React convention of grouping page components — not Next's `pages`.
    "src/components/pages/HomePage.tsx": DEFAULT_EXPORT,
    "src/utils/thing.ts": DEFAULT_EXPORT,
  });

  const off = (path: string) => expect(found[path]).not.toContain("import/no-default-export");
  const on = (path: string) => expect(found[path]).toContain("import/no-default-export");

  off("app/page.tsx");
  off("app/blog/[slug]/page.tsx");
  off("app/forbidden.tsx");
  off("app/opengraph-image2.tsx");
  off("src/app/layout.tsx");
  off("apps/web/app/page.tsx");
  off("pages/index.tsx");
  off("src/pages/about.tsx");

  on("app/api/users/route.ts");
  on("lib/app/error.ts");
  on("src/components/pages/HomePage.tsx");
  on("src/utils/thing.ts");
});

test("unicorn/prefer-dom-node-text-content is off for Playwright specs only", () => {
  const found = lint({
    "e2e/cart.spec.ts": INNER_TEXT,
    "apps/web/e2e/cart.spec.ts": INNER_TEXT,
    "playwright/cart.test.ts": INNER_TEXT,

    // Real DOM code that happens to live beside the specs.
    "e2e/helpers/dom.ts": INNER_TEXT,
    "src/components/Thing.ts": INNER_TEXT,
  });

  const rule = "unicorn/prefer-dom-node-text-content";

  expect(found["e2e/cart.spec.ts"]).not.toContain(rule);
  expect(found["apps/web/e2e/cart.spec.ts"]).not.toContain(rule);
  expect(found["playwright/cart.test.ts"]).not.toContain(rule);

  expect(found["e2e/helpers/dom.ts"]).toContain(rule);
  expect(found["src/components/Thing.ts"]).toContain(rule);
});
