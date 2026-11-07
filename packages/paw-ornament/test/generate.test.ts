import { describe, expect, test } from "bun:test";
import { generate, MAIN_MOTIFS, pathData, TOE_MOTIFS, type TextMask } from "../src/index";
import { allPoints, materialArea, pieces } from "./helpers";

const FAST = { resolution: 420 };

describe("generate", () => {
  test("is deterministic for the same parameters", () => {
    const a = generate({ seed: "finn", ...FAST });
    const b = generate({ seed: "finn", ...FAST });
    expect(pathData(a.loops)).toBe(pathData(b.loops));
  });

  test("different seeds give different designs", () => {
    expect(pathData(generate({ seed: "a", ...FAST }).loops)).not.toBe(pathData(generate({ seed: "b", ...FAST }).loops));
  });

  test("re-rolling one pad leaves the others alone", () => {
    const base = generate({ seed: "x", ...FAST });
    const rerolled = generate({ seed: "x", toes: [{ motif: "snowflake", variant: 1 }, "snowflake", "snowflake", "snowflake"], ...FAST });
    const inOuterLeft = (p: [number, number]) => p[0] < 330 && p[1] > 330 && p[1] < 650;
    const rest = (r: typeof base) => allPoints(r).filter((p) => !inOuterLeft(p) && p[0] > 400 && p[1] < 560);
    expect(rest(rerolled)).toEqual(rest(base));
    expect(pathData(rerolled.loops)).not.toBe(pathData(base.loops));
  });

  test("comes out at the requested width", () => {
    for (const widthMm of [60, 90, 140]) {
      const r = generate({ widthMm, ...FAST });
      expect(Math.abs(r.stats.widthMm - widthMm)).toBeLessThan(widthMm * 0.01);
    }
  });

  for (const paw of ["dog", "cat"] as const) {
    for (const motif of TOE_MOTIFS) {
      test(`${paw} paw with ${motif} toes is one piece`, () => {
        const r = generate({ paw, seed: `t-${motif}`, toes: motif, ...FAST });
        expect(pieces(r)).toBe(1);
        expect(r.stats.piecesRemoved).toBe(0);
      });
    }
    for (const motif of MAIN_MOTIFS) {
      test(`${paw} paw with ${motif} main pad is one piece`, () => {
        const r = generate({ paw, seed: `m-${motif}`, main: motif, ...FAST });
        expect(pieces(r)).toBe(1);
        expect(r.stats.piecesRemoved).toBe(0);
      });
    }
  }

  test("every loop is closed and finite", () => {
    const r = generate({ seed: "loops", toes: ["flower", "tree", "moon", "paw"], main: "mountains", ...FAST });
    for (const l of r.loops) {
      expect(l.length).toBeGreaterThanOrEqual(3);
      for (const [x, y] of l) expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
    }
  });

  test("kerf compensation grows the material", () => {
    const plain = materialArea(generate({ seed: "k", ...FAST }));
    const kerf = materialArea(generate({ seed: "k", kerfMm: 0.3, ...FAST }));
    expect(kerf).toBeGreaterThan(plain * 1.03);
  });

  test("solid pads are not cut out", () => {
    const open = materialArea(generate({ seed: "s", toes: "open", main: "open", ...FAST }));
    const solid = materialArea(generate({ seed: "s", toes: "solid", main: "solid", ...FAST }));
    expect(solid).toBeGreaterThan(open * 1.8);
  });

  test("the default design has no thin spots, a starved one does", () => {
    expect(generate({ seed: "lapka", resolution: 700 }, { checkThin: true }).thinSpots).toHaveLength(0);
    const starved = generate({ seed: "lapka", lineMm: 0.35, minFeatureMm: 1.2, resolution: 700 }, { checkThin: true });
    expect(starved.thinSpots.length).toBeGreaterThan(0);
  });

  test("a name with a loose dot gets bridged into one piece", () => {
    // an "i": a stem plus a separate dot well above it
    const width = 40;
    const height = 120;
    const data = new Uint8Array(width * height);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const stem = x > 12 && x < 28 && y > 40;
        const dot = (x - 20) ** 2 + (y - 18) ** 2 < 100;
        data[y * width + x] = stem || dot ? 255 : 0;
      }
    const mask: TextMask = { width, height, data, baseline: 112, key: "i-test" };
    const r = generate({ seed: "name", main: "name", ...FAST, resolution: 600 }, { textMask: mask });
    expect(pieces(r)).toBe(1);
    expect(r.stats.bridgesAdded).toBeGreaterThanOrEqual(1);
  });

  test("a window renders only that region", () => {
    const box = { x0: 100, y0: 330, x1: 320, y1: 650 };
    const r = generate({ seed: "w", resolution: 160 }, { window: box });
    expect(r.loops.length).toBeGreaterThan(0);
    for (const [x, y] of allPoints(r)) {
      expect(x).toBeGreaterThanOrEqual(box.x0 - 1);
      expect(x).toBeLessThanOrEqual(box.x1 + 2);
      expect(y).toBeGreaterThanOrEqual(box.y0 - 1);
      expect(y).toBeLessThanOrEqual(box.y1 + 2);
    }
  });

  test("reports pad outlines for all five pads", () => {
    const r = generate(FAST);
    expect(r.pads.map((p) => p.kind)).toEqual(["toe", "toe", "toe", "toe", "main"]);
    for (const p of r.pads) expect(p.outline.length).toBeGreaterThan(20);
  });
});

describe("edge cases found in review", () => {
  test("kerf never brings back loose pieces", () => {
    for (const seed of ["lapka", "finn", "zima"]) {
      for (const kerfMm of [0.1, 0.3, 0.5]) {
        const r = generate({ seed, kerfMm, resolution: 700 });
        expect(pieces(r)).toBe(1);
      }
    }
  });

  test("a small ornament with a thick rim stays whole and true to size", () => {
    for (const paw of ["dog", "cat"] as const) {
      const r = generate({ paw, widthMm: 50, borderMm: 7, resolution: 500 });
      expect(pieces(r)).toBe(1);
      expect(Math.abs(r.stats.widthMm - 50)).toBeLessThan(0.5);
    }
  });

  test("a big hanging hole keeps a bridge from the toes", () => {
    const r = generate({ widthMm: 50, holeMm: 10, borderMm: 4, resolution: 500 });
    expect(r.hole).not.toBeNull();
    const { x, y, r: hr } = r.hole!;
    const gap = Math.min(...r.pads.flatMap((p) => p.outline.map(([px, py]) => Math.hypot(px - x, py - y) - hr))) / r.unitsPerMm;
    expect(gap).toBeGreaterThan(1.8 - 0.1);
    expect(pieces(r)).toBe(1);
  });
});
