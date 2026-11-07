import { boxOf, clamp, smin, type Box, type Vec } from "./core/math";
import { ellipsePoints, prepEllipse, rayOutline, sdEllipse, sdPolygon, type Ellipse, type PreparedEllipse, type Sdf } from "./core/sdf";
import type { Params, Paw } from "./params";

/** World canvas is SIZE x SIZE units; the paw sits inside it. */
export const SIZE = 1000;

const PAWS: Record<Paw, { toes: Ellipse[]; main: Ellipse[]; k: number }> = {
  dog: {
    toes: [
      { cx: 206, cy: 490, rx: 92, ry: 126, rot: -0.5 },
      { cx: 386, cy: 316, rx: 106, ry: 150, rot: -0.13 },
      { cx: 614, cy: 316, rx: 106, ry: 150, rot: 0.13 },
      { cx: 794, cy: 490, rx: 92, ry: 126, rot: 0.5 },
    ],
    main: [
      { cx: 500, cy: 648, rx: 214, ry: 152, rot: 0 },
      { cx: 396, cy: 766, rx: 114, ry: 114, rot: 0 },
      { cx: 604, cy: 766, rx: 114, ry: 114, rot: 0 },
    ],
    k: 96,
  },
  cat: {
    toes: [
      { cx: 250, cy: 500, rx: 86, ry: 96, rot: -0.62 },
      { cx: 403, cy: 358, rx: 94, ry: 106, rot: -0.2 },
      { cx: 597, cy: 358, rx: 94, ry: 106, rot: 0.2 },
      { cx: 750, cy: 500, rx: 86, ry: 96, rot: 0.62 },
    ],
    main: [
      { cx: 500, cy: 650, rx: 168, ry: 118, rot: 0 },
      { cx: 362, cy: 768, rx: 96, ry: 96, rot: 0 },
      { cx: 500, cy: 792, rx: 100, ry: 100, rot: 0 },
      { cx: 638, cy: 768, rx: 96, ry: 96, rot: 0 },
    ],
    k: 64,
  },
};

export interface PadShape {
  index: number;
  kind: "toe" | "main";
  sdf: Sdf;
  /** Toes: the ellipse itself. Main pad: an ellipse that encloses it. */
  ellipse: PreparedEllipse;
  box: Box;
  outline: Vec[];
}

export interface Layout {
  /** World units per millimetre. */
  u: number;
  border: number;
  ring: number;
  line: number;
  pads: PadShape[];
  /** Union of all pads. */
  padsSdf: Sdf;
  hole: { x: number; y: number; r: number } | null;
  /** The ornament's silhouette (material where negative), hanging tab included. */
  outer: Sdf;
}

/** Horizontal extent of the material where `sdf` < 0, found by bisection on a few rows. */
function measureWidth(sdf: Sdf, y0: number, y1: number): number {
  let left = Infinity;
  let right = -Infinity;
  for (let k = 0; k <= 80; k++) {
    const y = y0 + ((y1 - y0) * k) / 80;
    const edge = (from: number, to: number) => {
      if (sdf(to, y) >= 0) return null;
      let a = from;
      let b = to;
      for (let i = 0; i < 40; i++) {
        const m = (a + b) / 2;
        if (sdf(m, y) < 0) b = m;
        else a = m;
      }
      return b;
    };
    const l = edge(-SIZE, SIZE / 2);
    const r = edge(SIZE * 1.5, SIZE / 2);
    if (l !== null) left = Math.min(left, l);
    if (r !== null) right = Math.max(right, r);
  }
  return right - left;
}

export function buildLayout(p: Params): Layout {
  const spec = PAWS[p.paw];
  let minX = Infinity;
  let maxX = -Infinity;
  for (const t of spec.toes)
    for (const [x] of ellipsePoints(t)) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
    }
  const borderMm = clamp(p.borderMm, 1, p.widthMm / 8);
  // the rim is an approximate offset, so settle the scale on the measured width
  let u = (maxX - minX) / (p.widthMm - 2 * borderMm);
  let layout = layoutAt(p, spec, u, borderMm);
  for (let i = 0; i < 4; i++) {
    const mm = measureWidth(layout.outer, 0, SIZE) / u;
    if (Math.abs(mm - p.widthMm) < 0.02) break;
    u *= mm / p.widthMm;
    layout = layoutAt(p, spec, u, borderMm);
  }
  return layout;
}

function layoutAt(p: Params, spec: (typeof PAWS)[Paw], u: number, borderMm: number): Layout {
  const border = borderMm * u;
  const ring = p.ringMm * u;
  const line = p.lineMm * u;

  const mainParts = spec.main.map(prepEllipse);
  const k = spec.k;
  const mainSdf: Sdf = (x, y) => {
    let d = sdEllipse(x, y, mainParts[0]!);
    for (let i = 1; i < mainParts.length; i++) d = smin(d, sdEllipse(x, y, mainParts[i]!), k);
    return d;
  };

  // shrink toes until each pad keeps at least one bridge width from its neighbours
  const toes = spec.toes.map(prepEllipse);
  const minDistance = (e: PreparedEllipse, sdf: Sdf) => Math.min(...ellipsePoints(e).map(([x, y]) => sdf(x, y)));
  for (let iter = 0; iter < 60; iter++) {
    let changed = false;
    toes.forEach((t, i) => {
      const others: Sdf[] = [mainSdf, ...toes.filter((_, j) => j !== i).map((o): Sdf => (x, y) => sdEllipse(x, y, o))];
      if (Math.min(...others.map((f) => minDistance(t, f))) < ring) {
        t.rx *= 0.985;
        t.ry *= 0.985;
        changed = true;
      }
    });
    if (!changed) break;
  }

  const pads: PadShape[] = toes.map((e, index) => {
    const outline = ellipsePoints(e, 96);
    return { index, kind: "toe", sdf: (x, y) => sdEllipse(x, y, e), ellipse: e, box: boxOf(outline), outline };
  });
  const mainCenter: Vec = [mainParts[0]!.cx, mainParts[0]!.cy + 40];
  const mainOutline = rayOutline(mainSdf, mainCenter[0], mainCenter[1], 128, 500);
  const mainBox = boxOf(mainOutline);
  pads.push({
    index: 4,
    kind: "main",
    sdf: mainSdf,
    ellipse: prepEllipse({
      cx: (mainBox.x0 + mainBox.x1) / 2,
      cy: (mainBox.y0 + mainBox.y1) / 2,
      rx: ((mainBox.x1 - mainBox.x0) / 2) * 1.12,
      ry: ((mainBox.y1 - mainBox.y0) / 2) * 1.12,
      rot: 0,
    }),
    box: mainBox,
    outline: mainOutline,
  });

  const padsSdf: Sdf = (x, y) => {
    let d = mainSdf(x, y);
    for (const t of toes) d = Math.min(d, sdEllipse(x, y, t));
    return d;
  };

  // hanging hole: as low as it can sit between the inner toes
  let hole: Layout["hole"] = null;
  if (p.hole) {
    const r = (p.holeMm / 2) * u;
    const x = SIZE / 2;
    let y = Math.min(toes[1]!.cy, toes[2]!.cy);
    while (y > -border && padsSdf(x, y) < r + ring) y -= 1;
    hole = { x, y, r };
  }

  const hull = toes.flatMap((t) => [t.cx, t.cy]);
  hull.push(mainParts[0]!.cx + 120, mainParts[0]!.cy + 40, mainParts[0]!.cx - 120, mainParts[0]!.cy + 40);
  const blend = 70 + border * 0.6;
  const outer: Sdf = (x, y) => {
    let d = smin(padsSdf(x, y), sdPolygon(x, y, hull), blend) - border;
    if (hole) d = smin(d, Math.sqrt((x - hole.x) ** 2 + (y - hole.y) ** 2) - (hole.r + border), 40);
    return d;
  };

  return { u, border, ring, line, pads, padsSdf, hole, outer };
}
