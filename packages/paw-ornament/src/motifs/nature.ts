import { Drawing } from "../core/field";
import { clamp, lerp, type Box, type Vec } from "../core/math";
import type { Rng } from "../core/rng";
import type { Sdf } from "../core/sdf";
import { curl, heading, walkOut } from "./common";

/** A pine of stacked, drooping tiers. Returns the tier polygons too. */
export function pineTree(d: Drawing, bx: number, by: number, h: number, w: number, lw: number, rng: Rng): Vec[][] {
  const tiers = clamp(Math.round(h / (lw * 6.5)), 3, 8);
  const y0 = by - h;
  const canopy = h * 0.86;
  const step = canopy / tiers;
  const polys: Vec[][] = [];
  for (let k = 0; k < tiers; k++) {
    const yt = y0 + k * step * 0.82;
    const yb = y0 + (k + 1) * step + step * 0.12;
    const hw = (w / 2) * (0.28 + 0.72 * ((k + 1) / tiers)) * rng.range(0.92, 1.08);
    const droop = step * rng.range(0.18, 0.3);
    const poly: Vec[] = [
      [bx, yt],
      [bx + hw * 0.5, yb - step * 0.42],
      [bx + hw, yb + droop * 0.4],
      [bx + hw * 0.42, yb - step * 0.08],
      [bx, yb + step * 0.02],
      [bx - hw * 0.42, yb - step * 0.08],
      [bx - hw, yb + droop * 0.4],
      [bx - hw * 0.5, yb - step * 0.42],
    ];
    polys.push(poly);
    d.poly(poly);
  }
  d.line([bx, y0 + canopy * 0.4], [bx, by + lw * 3], Math.max(lw * 0.55, w * 0.035));
  return polys;
}

export function bareBranch(d: Drawing, x: number, y: number, a: number, len: number, r: number, depth: number, rng: Rng, minR: number): void {
  const steps = 12;
  const bend = (rng.range(-0.7, 0.7) * Math.PI * 0.25) / len;
  const pts: Vec[] = [[x, y]];
  for (let i = 1; i <= steps; i++) {
    a += bend * (len / steps) + rng.range(-0.06, 0.06);
    x += Math.cos(a) * (len / steps);
    y += Math.sin(a) * (len / steps);
    pts.push([x, y]);
  }
  const rEnd = Math.max(minR, r * 0.6);
  d.stroke(pts, r, rEnd);
  if (depth <= 0) {
    if (rng.chance(0.35)) d.stroke(curl(x, y, a, len * 0.8, 0.8, rng.sign(), 2.2, 28), minR, minR);
    return;
  }
  const kids = rng.int(1, 2);
  for (let i = 0; i < kids; i++) {
    const at = rng.range(0.3, 0.85);
    const idx = Math.round(at * steps);
    const [px, py] = pts[idx]!;
    const ka = heading(pts, idx) + rng.sign() * rng.range(0.45, 0.9);
    bareBranch(d, px, py, ka, len * rng.range(0.42, 0.6), Math.max(minR, lerp(r, rEnd, at) * 0.8), depth - 1, rng, minR);
  }
  bareBranch(d, x, y, a + rng.range(-0.3, 0.3), len * 0.55, rEnd, depth - 1, rng, minR);
}

export type Wave = (x: number) => number;

/** A wavy solid band spanning the box (and past its sides, so it meets the rim). */
export function groundBand(d: Drawing, box: Box, gy: number, thickness: number, ext: number, rng: Rng): Wave {
  const W = box.x1 - box.x0;
  const f = rng.range(1.5, 2.6) / W;
  const ph = rng.range(0, 6.28);
  const amp = (box.y1 - box.y0) * 0.025;
  const ground: Wave = (x) => gy + amp * Math.sin(x * f * Math.PI * 2 + ph);
  const top: Vec[] = [];
  const bot: Vec[] = [];
  for (let i = 0; i <= 40; i++) {
    const x = lerp(box.x0 - ext, box.x1 + ext, i / 40);
    top.push([x, ground(x)]);
    bot.unshift([x, ground(x) + thickness]);
  }
  d.poly([...top, ...bot]);
  return ground;
}

/** Snow drifts: wavy bands from rim to rim, some rolling into a curl. */
export function drifts(d: Drawing, box: Box, top: number, count: number, lw: number, rng: Rng): void {
  const { x0, x1, y1 } = box;
  const W = x1 - x0;
  const H = box.y1 - box.y0;
  const r = lw / 2;
  const ext = lw * 4;
  const span = y1 - top;
  for (let i = 0; i < count; i++) {
    const yb = top + span * ((i + 0.55) / (count + 0.35));
    const f = rng.range(1.2, 2.2) / W;
    const ph = rng.range(0, 6.28);
    const a = H * rng.range(0.018, 0.035);
    const wave = (x: number) => yb + a * Math.sin(x * f * Math.PI * 2 + ph);
    const partial = rng.chance(0.7);
    const fromLeft = rng.chance(0.5);
    const endT = partial ? rng.range(0.5, 0.78) : 1;
    const pts: Vec[] = [];
    for (let k = 0; k <= 40; k++) {
      const t = (k / 40) * endT;
      const x = fromLeft ? lerp(x0 - ext, x1 + ext, t) : lerp(x1 + ext, x0 - ext, t);
      pts.push([x, wave(x)]);
    }
    d.stroke(pts, r * 1.5, r * 1.2);
    if (partial) {
      const [ex, ey] = pts[pts.length - 1]!;
      const dir = (fromLeft ? -1 : 1) * (rng.chance(0.7) ? 1 : -1);
      d.stroke(curl(ex, ey, heading(pts, pts.length - 1), H * rng.range(0.2, 0.28), rng.range(1.0, 1.3), dir, 2.4), r * 1.2, r * 0.95);
    }
  }
}

/** Wind gusts entering from the rim and curling into the sky, each with a companion line. */
export function windGusts(d: Drawing, box: Box, padSdf: Sdf, sky0: number, sky1: number, count: number, lw: number, rng: Rng): void {
  const { x0, x1 } = box;
  const W = x1 - x0;
  const r = lw / 2;
  let left = rng.chance(0.5);
  for (let i = 0; i < count; i++) {
    const sy = lerp(sky0, sky1, count === 1 ? rng.range(0.2, 0.6) : (i + rng.range(0.1, 0.6)) / count);
    const ux = left ? -1 : 1;
    const startX = left ? x0 + W * 0.2 : x1 - W * 0.2;
    const [sx] = walkOut(padSdf, startX, sy, ux, 0, lw * 0.5, lw * 1.5);
    const head = (left ? 0 : Math.PI) + rng.range(-0.15, 0.15);
    // mostly curl down into the open sky, sometimes up
    const dir = (left ? 1 : -1) * (rng.chance(0.8) ? 1 : -1);
    const L = W * rng.range(0.5, 0.7);
    const turns = rng.range(1.15, 1.6);
    d.stroke(curl(sx, sy, head, L, turns, dir, 3.4, 90), r * 2.3, r * 1.05);
    const off = lw * 3.2 * -dir;
    const [cx] = walkOut(padSdf, startX, sy + off, ux, 0, lw * 0.5, lw * 1.5);
    d.stroke(curl(cx, sy + off, head, L * rng.range(0.5, 0.66), turns * 0.8, dir, 3.2, 60), r * 1.5, r * 0.95);
    left = !left;
  }
}

/** A bare branch reaching in from an upper corner of the pad. */
export function cornerBranch(d: Drawing, box: Box, padSdf: Sdf, lw: number, rng: Rng): void {
  const W = box.x1 - box.x0;
  const fromLeft = rng.chance(0.5);
  const ang = fromLeft ? rng.range(-2.7, -2.35) : rng.range(-0.8, -0.45);
  const cx = (box.x0 + box.x1) / 2;
  const cy = (box.y0 + box.y1) / 2;
  const [sx, sy] = walkOut(padSdf, cx, cy, Math.cos(ang), Math.sin(ang), lw * 0.5, lw * 2);
  const a = (fromLeft ? 0 : Math.PI) + (fromLeft ? 1 : -1) * rng.range(0.05, 0.3);
  bareBranch(d, sx, sy, a, W * rng.range(0.24, 0.3), lw * 1.1, 2, rng, lw * 0.475);
}

/** A row of pines whose heights follow a soft ridge. */
export function treeLine(d: Drawing, x0: number, x1: number, ground: Wave, gT: number, hmax: number, n: number, lw: number, rng: Rng): void {
  const W = x1 - x0;
  const peak = rng.range(0.35, 0.65);
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const bx = lerp(x0, x1, t) + rng.range(-0.3, 0.3) * (W / Math.max(n, 1)) * 0.6;
    const prof = Math.exp(-(((t - peak) / 0.42) ** 2));
    const h = hmax * (0.36 + 0.64 * prof) * rng.range(0.78, 1.04);
    pineTree(d, bx, ground(bx) + gT * 0.5, h, h * rng.range(0.34, 0.44), lw, rng);
  }
}

