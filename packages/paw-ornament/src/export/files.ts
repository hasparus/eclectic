import type { Vec } from "../core/math";
import type { Result } from "../generate";

export type ExportMode = "fill" | "cut";

/** SVG path data for loops, translated by (-ox, -oy) and scaled by `k`. */
export function pathData(loops: readonly Vec[][], ox = 0, oy = 0, k = 1, digits = 1): string {
  const f = (v: number) => {
    const s = v.toFixed(digits);
    return s === "-0" || /^-0\.0+$/.test(s) ? "0" : s;
  };
  let d = "";
  for (const l of loops) {
    if (!l.length) continue;
    d += `M${f((l[0]![0] - ox) * k)} ${f((l[0]![1] - oy) * k)}`;
    for (let i = 1; i < l.length; i++) d += `L${f((l[i]![0] - ox) * k)} ${f((l[i]![1] - oy) * k)}`;
    d += "Z";
  }
  return d;
}

const escapeXml = (s: string) => s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function describe(r: Result): string {
  const p = r.params;
  const toes = p.toes.map((t) => t.motif).join(", ");
  return `Paw ornament (${p.paw}), seed ${p.seed}; toes: ${toes}; main pad: ${p.main.motif}`;
}

/**
 * True-size SVG in millimetres. "fill" is a single even-odd black path (a
 * stencil); "cut" is the same outline as 0.1 mm red hairlines, the usual cut
 * layer in laser software.
 */
export function toSVG(r: Result, { mode = "fill" as ExportMode, marginMm = 2 } = {}): string {
  const { bbox, unitsPerMm: u } = r;
  const m = marginMm * u;
  const ox = bbox.x - m;
  const oy = bbox.y - m;
  // user units are millimetres, so every CAM tool reads the size the same way
  const wmm = (bbox.w + 2 * m) / u;
  const hmm = (bbox.h + 2 * m) / u;
  const d = pathData(r.loops, ox, oy, 1 / u, 3);
  const shape =
    mode === "cut"
      ? `<path d="${d}" fill="none" stroke="#ff0000" stroke-width="0.1" stroke-linejoin="round"/>`
      : `<path d="${d}" fill="#000000" fill-rule="evenodd"/>`;
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${wmm.toFixed(3)}mm" height="${hmm.toFixed(3)}mm" viewBox="0 0 ${wmm.toFixed(3)} ${hmm.toFixed(3)}">\n` +
    `<title>${escapeXml(describe(r))}</title>\n${shape}\n</svg>\n`
  );
}

/** Vector PDF at 1:1 scale (print at 100 %), same two modes as the SVG. */
export function toPDF(r: Result, { mode = "fill" as ExportMode, marginMm = 5 } = {}): Uint8Array {
  const { bbox, unitsPerMm: u } = r;
  const pt = 72 / 25.4; // points per mm
  const m = marginMm * u;
  const W = ((bbox.w + 2 * m) / u) * pt;
  const H = ((bbox.h + 2 * m) / u) * pt;
  const k = pt / u;
  const ox = bbox.x - m;
  const oy = bbox.y - m;
  const f = (v: number) => v.toFixed(2);
  let content = mode === "cut" ? "1 0 0 RG 0.283 w 1 J 1 j\n" : "0 0 0 rg\n";
  for (const l of r.loops) {
    if (!l.length) continue;
    content += `${f((l[0]![0] - ox) * k)} ${f(H - (l[0]![1] - oy) * k)} m\n`;
    for (let i = 1; i < l.length; i++) content += `${f((l[i]![0] - ox) * k)} ${f(H - (l[i]![1] - oy) * k)} l\n`;
    content += "h\n";
  }
  content += mode === "cut" ? "S\n" : "f*\n";
  const title = describe(r).replace(/[()\\]/g, "").replace(/[^\x20-\x7e]/g, "?");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f(W)} ${f(H)}] /Contents 4 0 R /Resources << >> >>`,
    `<< /Length ${content.length} >>\nstream\n${content}endstream`,
    `<< /Title (${title}) /Producer (paw-ornament) >>`,
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}
