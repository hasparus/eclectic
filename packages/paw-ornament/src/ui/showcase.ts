// The "see it before you cut it" views: the ornament rendered as a real
// material (grain, laser-charred edges, bevel light, shadow) hanging on a
// ribbon, and a laser that cuts it out of a plywood sheet.

const SVGNS = "http://www.w3.org/2000/svg";

export type Material = "birch" | "walnut" | "gold" | "paper";
export const MATERIALS: readonly Material[] = ["birch", "walnut", "gold", "paper"];

/** Assumed cutting speed for 3 mm plywood on a hobby laser, for the time estimate. */
export const LASER_MM_PER_S = 20;

interface Look {
  /** Colour = base + slope * noise, per channel. */
  base: [number, number, number];
  slope: [number, number, number];
  grain: string;
  octaves: number;
  char: number;
  spec: number;
  shine: number;
}

const LOOKS: Record<Material, Look> = {
  birch: { base: [1.0, 0.86, 0.64], slope: [-0.34, -0.34, -0.3], grain: "0.0024 0.05", octaves: 3, char: 1, spec: 0.38, shine: 16 },
  walnut: { base: [0.6, 0.41, 0.28], slope: [-0.32, -0.24, -0.17], grain: "0.002 0.06", octaves: 4, char: 0.7, spec: 0.32, shine: 14 },
  gold: { base: [1.02, 0.83, 0.4], slope: [-0.28, -0.26, -0.18], grain: "0.0015 0.004", octaves: 2, char: 0, spec: 1.25, shine: 34 },
  paper: { base: [1.0, 0.99, 0.97], slope: [-0.06, -0.06, -0.06], grain: "0.06 0.06", octaves: 2, char: 0, spec: 0.12, shine: 8 },
};

export function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent?: Element): SVGElementTagNameMap[K] {
  const n = document.createElementNS(SVGNS, tag);
  for (const k in attrs) n.setAttribute(k, String(attrs[k]));
  parent?.appendChild(n);
  return n;
}

interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

const regionAttrs = (r: Region) => ({ x: r.x, y: r.y, width: r.w, height: r.h, filterUnits: "userSpaceOnUse", "color-interpolation-filters": "sRGB" });

function grain(f: SVGFilterElement, look: Look, result: string, seed: number): void {
  el("feTurbulence", { type: "fractalNoise", baseFrequency: look.grain, numOctaves: look.octaves, seed, result: `${result}-n` }, f);
  const [r, g, b] = look.base;
  const [sr, sg, sb] = look.slope;
  el("feColorMatrix", { in: `${result}-n`, type: "matrix", values: `${sr} 0 0 0 ${r}  ${sg} 0 0 0 ${g}  ${sb} 0 0 0 ${b}  0 0 0 0 1`, result }, f);
}

/** A filter that turns any black shape into a lit, charred, shadowed piece of `material`. */
export function materialFilter(defs: SVGDefsElement, id: string, material: Material, u: number, region: Region, shadow = true): void {
  const look = LOOKS[material];
  const f = el("filter", { id, ...regionAttrs(region) }, defs);
  grain(f, look, "tone", 7);
  el("feComposite", { in: "tone", in2: "SourceAlpha", operator: "in", result: "body" }, f);
  // laser char: darkest right at the cut edge, fading over half a millimetre
  el("feGaussianBlur", { in: "SourceAlpha", stdDeviation: 0.32 * u, result: "soft" }, f);
  el("feComposite", { in: "SourceAlpha", in2: "soft", operator: "arithmetic", k2: 1, k3: -1, result: "edge" }, f);
  el("feColorMatrix", { in: "edge", type: "matrix", values: `0 0 0 0 0.17  0 0 0 0 0.09  0 0 0 0 0.04  0 0 0 ${2.6 * look.char} 0`, result: "char" }, f);
  // bevel: light the blurred alpha as a height map
  el("feGaussianBlur", { in: "SourceAlpha", stdDeviation: 0.55 * u, result: "height" }, f);
  const spec = el("feSpecularLighting", { in: "height", surfaceScale: 3, specularConstant: look.spec, specularExponent: look.shine, "lighting-color": "#ffffff", result: "spec" }, f);
  el("feDistantLight", { azimuth: 235, elevation: 42 }, spec);
  el("feComposite", { in: "spec", in2: "SourceAlpha", operator: "in", result: "gloss" }, f);
  const lit = el("feMerge", { result: "piece" }, f);
  for (const n of ["body", "char", "gloss"]) el("feMergeNode", { in: n }, lit);
  if (!shadow) return;
  el("feGaussianBlur", { in: "SourceAlpha", stdDeviation: 1.1 * u, result: "blur" }, f);
  el("feOffset", { in: "blur", dx: 0.9 * u, dy: 1.8 * u, result: "drop" }, f);
  el("feColorMatrix", { in: "drop", type: "matrix", values: "0 0 0 0 0.05  0 0 0 0 0.04  0 0 0 0 0.03  0 0 0 0.42 0", result: "shade" }, f);
  const all = el("feMerge", {}, f);
  for (const n of ["shade", "piece"]) el("feMergeNode", { in: n }, all);
}

/** A soft glow for the laser head. */
export function glowFilter(defs: SVGDefsElement, id: string, u: number, region: Region): void {
  const f = el("filter", { id, ...regionAttrs(region) }, defs);
  el("feGaussianBlur", { in: "SourceGraphic", stdDeviation: 1.4 * u, result: "wide" }, f);
  el("feGaussianBlur", { in: "SourceGraphic", stdDeviation: 0.4 * u, result: "tight" }, f);
  const m = el("feMerge", {}, f);
  for (const n of ["wide", "tight", "SourceGraphic"]) el("feMergeNode", { in: n }, m);
}

/** A satin ribbon through the hanging hole, tied in a bow at (hx, top). */
export function ribbon(parent: Element, hx: number, hy: number, hr: number, top: number, u: number): void {
  const g = el("g", { class: "ribbon" }, parent);
  const w = Math.max(hr * 0.55, 0.9 * u);
  el("path", { d: `M${hx - w * 0.6} ${hy} L${hx - w * 0.3} ${top} M${hx + w * 0.6} ${hy} L${hx + w * 0.3} ${top}`, stroke: "#9f1d27", "stroke-width": w * 0.9, "stroke-linecap": "round", fill: "none" }, g);
  const s = 3.2 * u;
  const loop = (dir: number) =>
    `M${hx} ${top} C${hx + dir * s * 1.1} ${top - s * 1.1} ${hx + dir * s * 1.9} ${top - s * 0.2} ${hx + dir * s * 1.5} ${top + s * 0.25} C${hx + dir * s * 1.1} ${top + s * 0.55} ${hx + dir * s * 0.5} ${top + s * 0.2} ${hx} ${top}Z`;
  const tail = (dir: number) => `M${hx} ${top} L${hx + dir * s * 0.9} ${top + s * 1.5} L${hx + dir * s * 0.55} ${top + s * 1.35} L${hx + dir * s * 0.35} ${top + s * 1.6}Z`;
  for (const dir of [-1, 1]) {
    el("path", { d: tail(dir), fill: "#a51f2a" }, g);
    el("path", { d: loop(dir), fill: "#c42a35", stroke: "#8c1822", "stroke-width": 0.25 * u }, g);
  }
  el("circle", { cx: hx, cy: top, r: s * 0.32, fill: "#b2242f", stroke: "#8c1822", "stroke-width": 0.25 * u }, g);
}

/** Rocks `group` gently about `pivot` until stopped. */
export class Swing {
  private raf = 0;
  start(group: SVGGElement, pivot: [number, number]): void {
    this.stop();
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t0 = performance.now();
    const tick = (t: number) => {
      const s = (t - t0) / 1000;
      const a = 1.7 * Math.sin(s * 1.75) + 0.35 * Math.sin(s * 3.1 + 1);
      group.setAttribute("transform", `rotate(${a.toFixed(3)} ${pivot[0]} ${pivot[1]})`);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }
  stop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }
}

export interface LaserRun {
  stop(): void;
}

/**
 * Traces every cut loop with a glowing head, inner openings first and the
 * outline last, the way a laser job is ordered so the part stays put.
 */
export function runLaser(
  svg: SVGSVGElement,
  d: string,
  u: number,
  region: Region,
  onProgress: (fraction: number) => void,
  onDone: () => void,
): LaserRun {
  const defs = el("defs", {}, svg);
  materialFilter(defs, "laser-sheet", "birch", u, region, false);
  glowFilter(defs, "laser-glow", u, region);
  el("rect", { x: region.x, y: region.y, width: region.w, height: region.h, rx: 1.5 * u, fill: "#000", filter: "url(#laser-sheet)" }, svg);
  const layer = el("g", {}, svg);
  const parts = d
    .split("M")
    .filter(Boolean)
    .map((s) => {
      const p = el("path", { d: `M${s}`, fill: "none", stroke: "#2a1708", "stroke-width": 0.32 * u, "stroke-linejoin": "round" }, layer);
      const len = p.getTotalLength();
      const b = p.getBBox();
      p.setAttribute("stroke-dasharray", `${len} ${len}`);
      p.setAttribute("stroke-dashoffset", String(len));
      return { p, len, area: b.width * b.height, done: false };
    })
    .sort((a, b) => a.area - b.area);
  const total = parts.reduce((s, x) => s + x.len, 0) || 1;
  const halo = el("circle", { r: 2.6 * u, fill: "#ff5a2a", opacity: 0.45, filter: "url(#laser-glow)", cx: -1e4, cy: -1e4 }, svg);
  const head = el("circle", { r: 0.7 * u, fill: "#fff6e8", filter: "url(#laser-glow)", cx: -1e4, cy: -1e4 }, svg);
  const seconds = Math.min(14, Math.max(7, total / u / 320));
  let raf = 0;
  const t0 = performance.now();
  const tick = (t: number) => {
    const f = Math.min(1, (t - t0) / 1000 / seconds);
    let left = f * total;
    for (const part of parts) {
      if (part.done) {
        left -= part.len;
        continue;
      }
      const shown = Math.max(0, Math.min(part.len, left));
      part.p.setAttribute("stroke-dashoffset", String(part.len - shown));
      if (shown > 0 && shown < part.len) {
        const pt = part.p.getPointAtLength(shown);
        for (const c of [head, halo]) {
          c.setAttribute("cx", String(pt.x));
          c.setAttribute("cy", String(pt.y));
        }
      }
      if (shown >= part.len) part.done = true;
      left -= part.len;
      if (left <= 0) break;
    }
    halo.setAttribute("opacity", String(0.35 + 0.15 * Math.sin(t / 45)));
    onProgress(f);
    if (f < 1) raf = requestAnimationFrame(tick);
    else onDone();
  };
  raf = requestAnimationFrame(tick);
  return { stop: () => cancelAnimationFrame(raf) };
}

export const formatDuration = (seconds: number): string => {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
