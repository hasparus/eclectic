import { describe, expect, test } from "bun:test";
import { connectIslands, fillSpecks } from "../src/core/cleanup";
import { distanceTransform } from "../src/core/edt";
import { Field } from "../src/core/field";
import { traceContours } from "../src/core/trace";

describe("distanceTransform", () => {
  test("matches brute force", () => {
    const nx = 23;
    const ny = 17;
    const seed = Array.from({ length: nx * ny }, (_, i) => i % 37 === 0 || i === 200);
    const got = distanceTransform(seed, nx, ny);
    for (let p = 0; p < nx * ny; p++) {
      let best = Infinity;
      for (let q = 0; q < nx * ny; q++) if (seed[q]) best = Math.min(best, Math.hypot((p % nx) - (q % nx), Math.floor(p / nx) - Math.floor(q / nx)));
      expect(got[p]!).toBeCloseTo(best, 5);
    }
  });

  test("is infinite with no sources", () => {
    expect(distanceTransform([false, false, false, false], 2, 2)[3]).toBe(Infinity);
  });
});

/** Field from an ASCII picture: '#' material. */
function picture(rows: string[]): Field {
  const f = new Field(rows[0]!.length + 2, rows.length + 2, 1);
  f.data.fill(1);
  rows.forEach((row, j) => [...row].forEach((c, i) => c === "#" && (f.data[(j + 1) * f.nx + i + 1] = -1)));
  return f;
}

describe("traceContours", () => {
  test("a ring gives an outer loop and a hole", () => {
    const loops = traceContours(picture(["#####", "#...#", "#...#", "#####"]));
    expect(loops).toHaveLength(2);
  });
});

describe("cleanup", () => {
  test("bridges a nearby island and drops a far one", () => {
    const f = picture([
      "##########..................",
      "##########..................",
      "##########..##...........##.",
      "##########..##...........##.",
      "##########..................",
    ]);
    const report = connectIslands(f, 1, 4, 0.6);
    expect(report.bridged).toBe(1);
    expect(report.removed).toBe(1);
  });

  test("fills specks smaller than the limit", () => {
    const f = picture(["#######", "#.#####", "###..##", "###..##", "#######"]);
    const { filled, openings } = fillSpecks(f, 2);
    expect(filled).toBe(1);
    expect(openings).toBe(1);
  });
});
