import { clamp, type Vec } from "./math";

/** Signed distance functions. Negative inside. All in world units. */
export type Sdf = (x: number, y: number) => number;

export interface Ellipse {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  rot: number;
}

export interface PreparedEllipse extends Ellipse {
  cos: number;
  sin: number;
}

export const prepEllipse = (e: Ellipse): PreparedEllipse => ({ ...e, cos: Math.cos(e.rot), sin: Math.sin(e.rot) });

/** Cheap ellipse distance: exact on the boundary and good near it. */
export function sdEllipse(px: number, py: number, e: PreparedEllipse): number {
  const dx = px - e.cx;
  const dy = py - e.cy;
  const x = dx * e.cos + dy * e.sin;
  const y = -dx * e.sin + dy * e.cos;
  const ax = x / e.rx;
  const ay = y / e.ry;
  const bx = ax / e.rx;
  const by = ay / e.ry;
  const k0 = Math.sqrt(ax * ax + ay * ay);
  const k1 = Math.sqrt(bx * bx + by * by);
  if (k1 === 0) return -Math.min(e.rx, e.ry);
  return (k0 * (k0 - 1)) / k1;
}

export const sdCircle = (px: number, py: number, cx: number, cy: number, r: number): number =>
  Math.sqrt((px - cx) ** 2 + (py - cy) ** 2) - r;

/** Signed distance to a simple polygon given as a flat [x0, y0, x1, y1, ...] array. */
export function sdPolygon(px: number, py: number, v: ArrayLike<number>): number {
  const n = v.length >> 1;
  let d = (px - v[0]!) ** 2 + (py - v[1]!) ** 2;
  let s = 1;
  for (let i = 0, j = n - 1; i < n; j = i, i++) {
    const xi = v[2 * i]!;
    const yi = v[2 * i + 1]!;
    const yj = v[2 * j + 1]!;
    const ex = v[2 * j]! - xi;
    const ey = yj - yi;
    const wx = px - xi;
    const wy = py - yi;
    const h = clamp((wx * ex + wy * ey) / (ex * ex + ey * ey), 0, 1);
    const bx = wx - ex * h;
    const by = wy - ey * h;
    const dd = bx * bx + by * by;
    if (dd < d) d = dd;
    const c1 = py >= yi;
    const c2 = py < yj;
    const c3 = ex * wy > ey * wx;
    if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s;
  }
  return s * Math.sqrt(d);
}

/** Segment whose radius varies linearly from `ra` to `rb` (approximate round cone). */
export function sdTaper(px: number, py: number, ax: number, ay: number, bx: number, by: number, ra: number, rb: number): number {
  const ex = bx - ax;
  const ey = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const l2 = ex * ex + ey * ey;
  const h = l2 > 0 ? clamp((wx * ex + wy * ey) / l2, 0, 1) : 0;
  const qx = wx - ex * h;
  const qy = wy - ey * h;
  return Math.sqrt(qx * qx + qy * qy) - (ra + (rb - ra) * h);
}

export function ellipsePoints(e: Ellipse, steps = 72): Vec[] {
  const pts: Vec[] = [];
  const c = Math.cos(e.rot);
  const s = Math.sin(e.rot);
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const x = Math.cos(a) * e.rx;
    const y = Math.sin(a) * e.ry;
    pts.push([e.cx + x * c - y * s, e.cy + x * s + y * c]);
  }
  return pts;
}

/** Outline of an arbitrary star-shaped region around (cx, cy), found by bisection along rays. */
export function rayOutline(sdf: Sdf, cx: number, cy: number, steps = 96, maxR = 800): Vec[] {
  const pts: Vec[] = [];
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    let lo = 0;
    let hi = maxR;
    for (let k = 0; k < 30; k++) {
      const mid = (lo + hi) / 2;
      if (sdf(cx + ux * mid, cy + uy * mid) < 0) lo = mid;
      else hi = mid;
    }
    pts.push([cx + ux * lo, cy + uy * lo]);
  }
  return pts;
}
