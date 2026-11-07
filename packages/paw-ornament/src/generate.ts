import { connectIslands, fillSpecks, findThinSpots, type ThinSpot } from "./core/cleanup";
import { Drawing, Field } from "./core/field";
import { clamp, type Box, type Vec } from "./core/math";
import { Rng } from "./core/rng";
import type { Sdf } from "./core/sdf";
import { simplifyLoop, traceContours } from "./core/trace";
import { buildLayout, SIZE, type Layout } from "./layout";
import { curl, type MotifOutput } from "./motifs/common";
import { MAIN_LIBRARY } from "./motifs/scenes";
import { TOE_LIBRARY } from "./motifs/toes";
import { MAIN_PAD, normalizeParams, type Params, type TextMask } from "./params";

export interface GenerateOptions {
  /** Render only this world-space window (no island cleanup); used for previews of one pad. */
  window?: Box;
  /** Look for material thinner than `minFeatureMm`. */
  checkThin?: boolean;
  /** Rasterised name text for the "name" scene. */
  textMask?: TextMask;
}

export interface PadInfo {
  index: number;
  kind: "toe" | "main";
  outline: Vec[];
  box: Box;
}

export interface Stats {
  widthMm: number;
  heightMm: number;
  /** Total length of all cut paths. */
  cutLengthMm: number;
  paths: number;
  /** Enclosed openings (everything cut out, except the outside). */
  openings: number;
  bridgesAdded: number;
  piecesRemoved: number;
  specksFilled: number;
  thinSpots: number;
  ms: number;
}

export interface Result {
  params: Params;
  loops: Vec[][];
  unitsPerMm: number;
  bbox: { x: number; y: number; w: number; h: number };
  pads: PadInfo[];
  thinSpots: ThinSpot[];
  stats: Stats;
}

/** A cut line just inside a pad's edge, interrupted by `bridges` evenly spaced tabs. */
function groove(sdf: Sdf, outline: Vec[], box: Box, bridges: number, layout: Layout): Drawing {
  const w = Math.max(layout.line, layout.u * 0.5);
  const tab = Math.max(layout.ring, layout.line) * 0.9;
  const start = Math.floor(outline.length / (bridges * 2));
  const tabs = Array.from({ length: bridges }, (_, k) => outline[(start + Math.floor((k * outline.length) / bridges)) % outline.length]!);
  const m = w * 2;
  return new Drawing().fn(box.x0 - m, box.y0 - m, box.x1 + m, box.y1 + m, (x, y) => {
    let near = Infinity;
    for (const [tx, ty] of tabs) near = Math.min(near, Math.hypot(x - tx, y - ty));
    return Math.max(Math.abs(sdf(x, y) + w / 2) - w / 2, tab - near);
  });
}

function motifFor(layout: Layout, p: Params, index: number, textMask?: TextMask): MotifOutput {
  const pad = layout.pads[index]!;
  if (index === MAIN_PAD) {
    const cfg = p.main;
    const rng = new Rng(`${p.seed}|main|${cfg.motif}|${cfg.variant}`);
    return MAIN_LIBRARY[cfg.motif]({ rng, pad, layout, params: p, textMask });
  }
  const cfg = p.toes[index]!;
  const rng = new Rng(`${p.seed}|toe${index}|${cfg.motif}|${cfg.variant}`);
  return TOE_LIBRARY[cfg.motif]({ rng, pad, layout, params: p });
}

export function generate(input: unknown, opts: GenerateOptions = {}): Result {
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  const p = normalizeParams(input);
  const layout = buildLayout(p);
  const { u, border, ring, line, pads, hole } = layout;
  const outputs = pads.map((_, i) => motifFor(layout, p, i, opts.textMask));
  const open = outputs.map((o) => !o.solid);

  const win = opts.window;
  const field = win ? Field.over(win.x0, win.y0, win.x1, win.y1, p.resolution) : Field.over(0, 0, SIZE, SIZE, p.resolution);
  const sdfs = pads.map((pd) => pd.sdf);
  const holeD: Sdf = hole ? (x, y) => Math.sqrt((x - hole.x) ** 2 + (y - hole.y) ** 2) - hole.r : () => Infinity;

  // silhouette minus open pads and the hanging hole
  field.map((x, y) => {
    let cut = holeD(x, y);
    for (let i = 0; i < sdfs.length; i++) if (open[i]) cut = Math.min(cut, sdfs[i]!(x, y));
    return Math.max(layout.outer(x, y), -cut);
  });

  // teardrop piercings in the material between pads
  if (p.web) {
    const mb = Math.max(ring, line * 1.2);
    const zone: Sdf = (x, y) => Math.max(layout.outer(x, y) + mb, mb - layout.padsSdf(x, y), mb - holeD(x, y));
    const rng = new Rng(`${p.seed}|web`);
    const seeds: { x: number; y: number; room: number }[] = [];
    for (let tries = 0; tries < 2500 && seeds.length < 24; tries++) {
      const x = rng.range(100, 900);
      const y = rng.range(100, 900);
      const room = -zone(x, y);
      if (!(room > line * 2.2)) continue;
      if (seeds.some((s) => Math.hypot(s.x - x, s.y - y) < (s.room + room) * 1.6)) continue;
      seeds.push({ x, y, room });
    }
    const d = new Drawing();
    for (const s of seeds) {
      const size = Math.min(s.room, line * 6);
      const a = rng.range(0, Math.PI * 2);
      const sx = s.x - Math.cos(a) * size * 0.45;
      const sy = s.y - Math.sin(a) * size * 0.45;
      d.stroke(curl(sx, sy, a, size * 1.7, 0.45, rng.sign(), 2, 30), size * 0.5, line * 0.4);
    }
    const cuts = field.like();
    d.stampInto(cuts, zone);
    const { data } = field;
    for (let i = 0; i < data.length; i++) if (cuts.data[i]! < 0) data[i] = Math.max(data[i]!, -cuts.data[i]!);
  }

  // motifs: material first, then the openings cut into it
  const clipExt = Math.min(ring, border) * 0.5;
  const material = field.like();
  outputs.forEach((o, i) => {
    if (o.material && !o.solid) o.material.stampInto(material, (x, y) => sdfs[i]!(x, y) - clipExt);
  });
  const cuts = field.like();
  outputs.forEach((o, i) => {
    if (o.cuts) o.cuts.stampInto(cuts, o.cutClip ?? ((x, y) => sdfs[i]!(x, y) + ring));
    // solid pads keep their shape readable with a groove held by a few bridges
    if (o.solid) groove(pads[i]!.sdf, pads[i]!.outline, pads[i]!.box, i === MAIN_PAD ? 4 : 3, layout).stampInto(cuts);
  });
  {
    const { data } = field;
    for (let i = 0; i < data.length; i++) {
      let v = Math.min(data[i]!, material.data[i]!);
      if (cuts.data[i]! < 0) v = Math.max(v, -cuts.data[i]!);
      data[i] = v;
    }
    if (hole) field.map((x, y, v) => Math.max(v, -holeD(x, y)));
  }

  // make it cuttable: one piece, no specks
  const cellArea = field.cs * field.cs;
  const islands = win
    ? { bridged: 0, removed: 0, slivers: 0 }
    : connectIslands(field, Math.max(4, (0.3 * u * u) / cellArea), Math.max(ring * 3, line * 8), Math.max(line * 0.5, ring * 0.35));
  const specks = fillSpecks(field, (p.minHoleMm2 * u * u) / cellArea);
  const thinSpots = opts.checkThin && !win ? findThinSpots(field, p.minFeatureMm * u, (p.minFeatureMm * u) ** 2 * 1.2) : [];
  if (p.kerfMm > 0) {
    const grow = (p.kerfMm / 2) * u;
    const { data } = field;
    for (let i = 0; i < data.length; i++) data[i] = data[i]! - grow;
  }

  // a window cuts through material at its edges: frame it with cut so every contour closes
  if (win) {
    const { nx, ny, data, cs } = field;
    for (let i = 0; i < nx; i++) data[i] = data[(ny - 1) * nx + i] = cs;
    for (let j = 0; j < ny; j++) data[j * nx] = data[j * nx + nx - 1] = cs;
  }
  const loops = traceContours(field).map((l) => simplifyLoop(l, field.cs * 0.3));
  let bx0 = Infinity;
  let by0 = Infinity;
  let bx1 = -Infinity;
  let by1 = -Infinity;
  let cut = 0;
  for (const l of loops) {
    for (let i = 0; i < l.length; i++) {
      const [x, y] = l[i]!;
      bx0 = Math.min(bx0, x);
      by0 = Math.min(by0, y);
      bx1 = Math.max(bx1, x);
      by1 = Math.max(by1, y);
      const [nx, ny] = l[(i + 1) % l.length]!;
      cut += Math.hypot(nx - x, ny - y);
    }
  }
  if (!loops.length) bx0 = by0 = bx1 = by1 = 0;
  const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();

  return {
    params: p,
    loops,
    unitsPerMm: u,
    bbox: { x: bx0, y: by0, w: bx1 - bx0, h: by1 - by0 },
    pads: pads.map((pd) => ({ index: pd.index, kind: pd.kind, outline: pd.outline, box: pd.box })),
    thinSpots,
    stats: {
      widthMm: (bx1 - bx0) / u,
      heightMm: (by1 - by0) / u,
      cutLengthMm: cut / u,
      paths: loops.length,
      openings: specks.openings,
      bridgesAdded: islands.bridged,
      piecesRemoved: islands.removed,
      specksFilled: specks.filled,
      thinSpots: thinSpots.length,
      ms: Math.round(t1 - t0),
    },
  };
}

/** Clamp helper re-exported for callers sizing windows around pads. */
export const padWindow = (box: Box, margin: number): Box => ({
  x0: clamp(box.x0 - margin, 0, SIZE),
  y0: clamp(box.y0 - margin, 0, SIZE),
  x1: clamp(box.x1 + margin, 0, SIZE),
  y1: clamp(box.y1 + margin, 0, SIZE),
});
