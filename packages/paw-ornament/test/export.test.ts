import { describe, expect, test } from "bun:test";
import { generate, toPDF, toSVG } from "../src/index";

const r = generate({ seed: "export", resolution: 360, widthMm: 80 });

describe("SVG", () => {
  test("is sized in millimetres with mm user units", () => {
    const svg = toSVG(r);
    const w = Number(/width="([\d.]+)mm"/.exec(svg)?.[1]);
    const vb = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
    expect(w).toBeCloseTo(r.stats.widthMm + 4, 1);
    expect(Number(vb?.[1])).toBeCloseTo(w, 2);
    expect(svg).toContain('fill-rule="evenodd"');
    expect(svg).not.toContain("NaN");
  });

  test("cut mode uses red hairlines", () => {
    const svg = toSVG(r, { mode: "cut" });
    expect(svg).toContain('stroke="#ff0000"');
    expect(svg).toContain('fill="none"');
  });

  test("escapes the seed in the title", () => {
    const svg = toSVG(generate({ seed: "<b>&", resolution: 200 }));
    expect(svg).toContain("&#60;b&#62;&#38;");
  });
});

describe("PDF", () => {
  const text = new TextDecoder().decode(toPDF(r));

  test("has a valid header, trailer and true-size page", () => {
    expect(text.startsWith("%PDF-1.4\n")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    const box = /MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(text)!;
    expect((Number(box[1]) / 72) * 25.4).toBeCloseTo(r.stats.widthMm + 10, 0);
  });

  test("xref offsets point at their objects", () => {
    const start = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(start, start + 4)).toBe("xref");
    const entries = [...text.slice(start).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    expect(entries).toHaveLength(5);
    entries.forEach((off, i) => expect(text.slice(off).startsWith(`${i + 1} 0 obj`)).toBe(true));
  });

  test("stream length matches", () => {
    const m = /<< \/Length (\d+) >>\nstream\n/.exec(text)!;
    const body = text.slice(m.index + m[0].length);
    expect(body.slice(Number(m[1]), Number(m[1]) + 9)).toBe("endstream");
  });
});

test("control characters never reach the SVG", () => {
  const svg = toSVG(generate({ seed: "ż\u0001<x>", resolution: 200 }));
  // eslint-disable-next-line no-control-regex
  expect(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(svg)).toBe(false);
});
