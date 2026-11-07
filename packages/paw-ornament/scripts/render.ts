// Renders sample ornaments to SVG plus a PNG contact sheet, for visual review.
//   bun scripts/render.ts <outDir> [preset=all] [key=value ...]
// Needs Playwright for the PNG sheet; the SVGs are written regardless.
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { generate, toSVG } from "../src/index";

const [outArg = "out", ...rest] = process.argv.slice(2);
const out = resolve(outArg);
mkdirSync(out, { recursive: true });
const kv = Object.fromEntries(rest.map((a) => a.split("=") as [string, string]));
const parse = (v: string): unknown => (v === "true" ? true : v === "false" ? false : Number.isNaN(Number(v)) ? v : Number(v));
const overrides = Object.fromEntries(Object.entries(kv).filter(([k]) => k !== "preset" && k !== "seeds").map(([k, v]) => [k, parse(v)]));

const t = (...m: string[]) => m.map((motif) => ({ motif, variant: 0 }));
const PRESETS: Record<string, Record<string, unknown>[]> = {
  classic: [{ seed: "lapka" }, { seed: "finn", paw: "cat" }],
  toes: [
    { seed: "a", toes: t("flower", "tree", "heart", "star"), main: "snowflake" },
    { seed: "b", paw: "cat", toes: t("paw", "moon", "vines", "flower"), main: "mountains" },
    { seed: "c", toes: t("heart", "snowflake", "snowflake", "heart"), main: "heart" },
    { seed: "d", paw: "cat", toes: t("tree", "star", "moon", "solid"), main: "forest" },
  ],
};
PRESETS.all = [...PRESETS.classic!, ...PRESETS.toes!];
const list = kv.seeds ? kv.seeds.split(",").map((seed) => ({ seed })) : PRESETS[kv.preset ?? "all"]!;

const files: string[] = [];
for (const [i, v] of list.entries()) {
  const r = generate({ ...v, ...overrides }, { checkThin: true });
  const name = `${String(i).padStart(2, "0")}-${r.params.paw}-${r.params.seed}.svg`;
  writeFileSync(join(out, name), toSVG(r));
  files.push(name);
  const s = r.stats;
  console.log(name, `${s.ms}ms`, `${s.widthMm.toFixed(1)}x${s.heightMm.toFixed(1)}mm`, `open=${s.openings} bridges=${s.bridgesAdded} removed=${s.piecesRemoved} specks=${s.specksFilled} thin=${s.thinSpots}`);
}

const cols = 2;
writeFileSync(
  join(out, "sheet.html"),
  `<!doctype html><body style="margin:0;display:grid;grid-template-columns:repeat(${cols},600px);gap:10px">${files
    .map((f) => `<img src="${f}" style="width:600px;height:600px;object-fit:contain;background:#e9ecef">`)
    .join("")}</body>`,
);
try {
  const { chromium } = createRequire(import.meta.url)("playwright");
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: cols * 610, height: Math.ceil(files.length / cols) * 610 } });
  await page.goto(`file://${join(out, "sheet.html")}`);
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(out, "sheet.png") });
  await browser.close();
  console.log("sheet:", join(out, "sheet.png"));
} catch (e) {
  console.log("no PNG sheet (Playwright unavailable):", (e as Error).message.split("\n")[0]);
}
