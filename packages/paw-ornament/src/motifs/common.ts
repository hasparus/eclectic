import type { Drawing } from "../core/field";
import type { Vec } from "../core/math";
import type { Rng } from "../core/rng";
import type { PreparedEllipse, Sdf } from "../core/sdf";
import type { Layout, PadShape } from "../layout";
import type { Params, TextMask } from "../params";

export interface MotifContext {
  rng: Rng;
  pad: PadShape;
  layout: Layout;
  params: Params;
  textMask?: TextMask | undefined;
}

export interface MotifOutput {
  /** Material added inside the pad (clipped to the pad, so it joins the rim). */
  material?: Drawing;
  /** Openings cut after the material is in place. */
  cuts?: Drawing;
  /** Where cuts may go; defaults to the pad shrunk by one bridge width. */
  cutClip?: Sdf;
  /** Keep the pad as material instead of cutting it out. */
  solid?: boolean;
}

export type Motif = (ctx: MotifContext) => MotifOutput;

/**
 * A flourish with a set total turn. Curvature grows as t^power, so the stroke
 * sweeps out and then rolls into a tight curl, like a pen flourish.
 */
export function curl(x: number, y: number, theta: number, len: number, turns: number, dir: number, power = 2.4, steps = 56): Vec[] {
  const pts: Vec[] = [[x, y]];
  const ds = len / steps;
  const total = turns * Math.PI * 2;
  let a = theta;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    a += dir * ((total * (power + 1) * t ** power) / len) * ds;
    x += Math.cos(a) * ds;
    y += Math.sin(a) * ds;
    pts.push([x, y]);
  }
  return pts;
}

export function heading(pts: readonly Vec[], i: number): number {
  const a = pts[Math.max(0, i - 1)]!;
  const b = pts[Math.min(pts.length - 1, i + 1)]!;
  return Math.atan2(b[1] - a[1], b[0] - a[0]);
}

/** Walks from (x, y) along (ux, uy) until `sdf` exceeds `past`, to anchor a stroke beyond a rim. */
export function walkOut(sdf: Sdf, x: number, y: number, ux: number, uy: number, step: number, past: number): Vec {
  for (let s = 0; s < 800 && sdf(x, y) < past; s++) {
    x += ux * step;
    y += uy * step;
  }
  return [x, y];
}

/** Maps unit-disc coordinates into an ellipse (rotation included). */
export function ellipseMapper(e: PreparedEllipse, scale = 1): (u: number, v: number) => Vec {
  return (u, v) => {
    const x = u * e.rx * scale;
    const y = v * e.ry * scale;
    return [e.cx + x * e.cos - y * e.sin, e.cy + x * e.sin + y * e.cos];
  };
}

/** Shrinks a shape about `center` until every point is at least `margin` inside `sdf`. */
export function fitInside(points: Vec[], center: Vec, sdf: Sdf, margin: number): Vec[] {
  let pts = points;
  for (let i = 0; i < 80 && pts.some(([x, y]) => sdf(x, y) > -margin); i++) {
    pts = pts.map(([x, y]) => [center[0] + (x - center[0]) * 0.97, center[1] + (y - center[1]) * 0.97]);
  }
  return pts;
}

export function starPoints(cx: number, cy: number, r: number, inner: number, points: number, rot = -Math.PI / 2): Vec[] {
  const pts: Vec[] = [];
  for (let i = 0; i < points * 2; i++) {
    const a = rot + (i / (points * 2)) * Math.PI * 2;
    const rr = i % 2 ? r * inner : r;
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  return pts;
}

/** Classic heart curve, centred, about 2 units tall, point down. */
export function heartPoints(steps = 72): Vec[] {
  const pts: Vec[] = [];
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const x = 16 * Math.sin(t) ** 3;
    const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
    pts.push([x / 16, (y - 2.5) / 14.5]);
  }
  return pts;
}
