import { describe, expect, test } from "bun:test";
import { DEFAULTS, normalizeParams } from "../src/index";

describe("normalizeParams", () => {
  test("fills in defaults", () => {
    expect(normalizeParams({})).toEqual(DEFAULTS);
    expect(normalizeParams(undefined)).toEqual(DEFAULTS);
  });

  test("survives garbage", () => {
    for (const junk of [null, 42, "x", [], { toes: 7, main: {}, widthMm: "wide", scene: null, name: 5 }]) {
      expect(() => normalizeParams(junk)).not.toThrow();
    }
    expect(normalizeParams({ widthMm: "wide" }).widthMm).toBe(DEFAULTS.widthMm);
  });

  test("clamps numbers into range", () => {
    const p = normalizeParams({ widthMm: 9999, lineMm: -1, scene: { wind: 2.6, trees: 3 } });
    expect(p.widthMm).toBe(200);
    expect(p.lineMm).toBe(0.35);
    expect(p.scene.wind).toBe(3);
    expect(p.scene.trees).toBe(1);
  });

  test("migrates version 1 settings", () => {
    const p = normalizeParams({ seed: "old", toes: "filigree", scene: "empty", trees: 0.2, wind: 1, waves: 0, branches: false });
    expect(p.toes.map((t) => t.motif)).toEqual(["vines", "vines", "vines", "vines"]);
    expect(p.main).toEqual({ motif: "open", variant: 0 });
    expect(p.scene).toEqual({ trees: 0.2, wind: 1, waves: 0, branches: false });
  });

  test("accepts per-pad settings and ignores unknown motifs", () => {
    const p = normalizeParams({ toes: ["heart", { motif: "star", variant: 3 }, { motif: "dragon" }], main: "name" });
    expect(p.toes.map((t) => t.motif)).toEqual(["heart", "star", "snowflake", "snowflake"]);
    expect(p.toes[1]!.variant).toBe(3);
    expect(p.main.motif).toBe("name");
  });

  test("limits the name length", () => {
    expect(normalizeParams({ name: { text: "x".repeat(100) } }).name.text).toHaveLength(24);
  });
});
