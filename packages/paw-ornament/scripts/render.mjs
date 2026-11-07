// Renders sample ornaments to SVG and a PNG contact sheet for visual review.
// Usage: node scripts/render.mjs <outDir> [seed=...] [paw=cat] ...
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { generate, toSVG } from "../src/generator.js";

const [outArg = "out", ...rest] = process.argv.slice(2);
const out = resolve(outArg);
mkdirSync(out, { recursive: true });
const overrides = Object.fromEntries(
  rest.map((kv) => {
    const [k, v] = kv.split("=");
    const n = Number(v);
    return [k, v === "true" ? true : v === "false" ? false : Number.isNaN(n) ? v : n];
  }),
);

const variants = overrides.seeds
  ? String(overrides.seeds).split(",").map((seed) => ({ seed }))
  : [{ seed: "lapka" }, { seed: "finn", paw: "cat" }, { seed: "zima", toes: "filigree" }, { seed: "pusta", toes: "empty", scene: "empty" }];

const files = [];
for (const v of variants) {
  const t = performance.now();
  const r = generate({ ...v, ...overrides, seeds: undefined });
  const ms = Math.round(performance.now() - t);
  const name = `${r.params.paw}-${r.params.seed}.svg`;
  writeFileSync(join(out, name), toSVG(r));
  files.push(name);
  console.log(name, `${ms}ms`, JSON.stringify(r.stats, (k, x) => (typeof x === "number" ? Math.round(x * 10) / 10 : x)));
}

const html = `<!doctype html><body style="margin:0;background:#fff;display:grid;grid-template-columns:repeat(2,600px);gap:10px">${files
  .map((f) => `<img src="${f}" style="width:600px;height:600px;object-fit:contain;background:#e9ecef">`)
  .join("")}</body>`;
writeFileSync(join(out, "sheet.html"), html);

const { createRequire } = await import("node:module");
const { chromium } = createRequire(import.meta.url)("playwright");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1210, height: Math.ceil(files.length / 2) * 610 } });
await page.goto(`file://${join(out, "sheet.html")}`);
await page.waitForTimeout(300);
await page.screenshot({ path: join(out, "sheet.png") });
await browser.close();
console.log("wrote", join(out, "sheet.png"));
