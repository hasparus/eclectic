import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Runs the shipped config over files laid out on disk and reads the rule ids
 * back. A glob one star too wide, or a rule that never reaches the linter,
 * silences itself in every consumer repo and says nothing; only the binary
 * knows.
 */

/** As a consumer assembles it: the base, with the shared overrides spread in. */
const imported = await import("./oxlint.config.js");
export const config = { ...imported.default, overrides: imported.overrides };

/**
 * Every fixture carries a `debugger`, which no override touches. Without it a
 * typo in an `off()` path passes: nothing reported reads the same as a rule
 * correctly disabled.
 */
export const SENTINEL = "debugger;\n";
export const SENTINEL_RULE = "eslint/no-debugger";

/** The pinned binary, not whatever `bunx` would fetch if resolution missed. */
export const OXLINT = join(
  dirname(Bun.fileURLToPath(import.meta.resolve("oxlint/package.json"))),
  "bin/oxlint",
);

/**
 * The config asks for type-aware linting, and oxlint hunts for tsgolint by
 * walking up from the working directory — which here is a temp dir with no
 * `node_modules` above it. Hand it the path instead, or the run dies before it
 * reports a thing.
 */
export const TSGOLINT = join(
  dirname(Bun.fileURLToPath(import.meta.resolve("oxlint-tsgolint/package.json"))),
  "bin/tsgolint.js",
);

/**
 * The JS plugins would have to resolve from the fixture tree and own no rule
 * under test. Their rules go with them, since oxlint refuses a config naming a
 * plugin it has not loaded. Globs and options are untouched.
 */
type Rules = Readonly<Record<string, unknown>>;
export type Config = {
  readonly jsPlugins?: readonly string[];
  readonly overrides?: readonly { readonly rules?: Rules }[];
  readonly rules?: Rules;
};

export function withoutJsPlugins({
  jsPlugins = [],
  overrides = [],
  rules = {},
  ...rest
}: Config) {
  const owned = jsPlugins.map((name) => name.replace("eslint-plugin-", "") + "/");
  const keep = (by: Rules) =>
    Object.fromEntries(
      Object.entries(by).filter(
        ([id]: readonly [string, unknown]) => !owned.some((p) => id.startsWith(p)),
      ),
    );

  return {
    ...rest,
    overrides: overrides.map((o) => ({ ...o, rules: keep(o.rules ?? {}) })),
    rules: keep(rules),
  };
}

/** `JSON.parse` returns `any`; name the shape once, at the boundary. */
const parseReport: (json: string) => { diagnostics: { code: string; filename: string }[] } =
  JSON.parse;

/**
 * Rule ids oxlint reports for each file, laid out at that exact path. Pairs
 * rather than an object, so each case keeps the comment explaining it.
 */
export function lint(
  files: readonly (readonly [path: string, source: string])[],
  from: Config = config,
) {
  const root = mkdtempSync(join(tmpdir(), "oxlint-fixture-"));

  for (const [path, source] of files) {
    mkdirSync(join(root, dirname(path)), { recursive: true });
    writeFileSync(join(root, path), source);
  }

  writeFileSync(join(root, ".oxlintrc.json"), JSON.stringify(withoutJsPlugins(from)));

  const { stdout } = Bun.spawnSync({
    cmd: [OXLINT, "-c", ".oxlintrc.json", "--format", "json", "."],
    cwd: root,
    env: { ...process.env, OXLINT_TSGOLINT_PATH: TSGOLINT },
  });

  const report = parseReport(stdout.toString());

  const byFile: Record<string, string[]> = {};
  for (const [path] of files) byFile[path] = [];
  for (const { code, filename } of report.diagnostics) {
    // oxlint reports `plugin(rule)`; say it the way the config spells it.
    byFile[filename.replace(/^\.\//, "")]?.push(code.replace(/^(.+)\((.+)\)$/, "$1/$2"));
  }

  return byFile;
}
