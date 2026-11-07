import { Drawing } from "../core/field";
import { lerp, type Vec } from "../core/math";
import type { Rng } from "../core/rng";
import { sdCircle, sdPolygon } from "../core/sdf";
import type { ToeMotif } from "../params";
import { curl, ellipseMapper, fitInside, heading, heartPoints, starPoints, walkOut, type Motif, type MotifContext } from "./common";
import { pineTree } from "./nature";

/**
 * A 6-fold snowflake in unit space (arm length 1) pushed through `map`.
 * Arms run `overshoot` past the unit circle so they reach the rim.
 */
export function snowflake(rng: Rng, map: (u: number, v: number) => Vec, lw: number, overshoot: number): Drawing {
  const d = new Drawing();
  const r = lw / 2;
  const centerStyle = rng.pick(["hex", "hex", "star", "ring", "solid"] as const);
  const rc = rng.range(0.13, 0.22);
  const nb = rng.int(2, 4);
  const ang = rng.range(0.72, 1.0);
  const lmax = rng.range(0.3, 0.42);
  const branches: { t: number; len: number; twig: boolean }[] = [];
  for (let i = 0; i < nb; i++) {
    const t = lerp(rc + 0.16, 0.8, nb === 1 ? 0.5 : i / (nb - 1)) + rng.range(-0.02, 0.02);
    let len = lmax * (1 - 0.62 * t) * rng.range(0.85, 1.1);
    // keep frond tips off the rim so the flake reads as a flake
    while (Math.hypot(t + Math.cos(ang) * len, Math.sin(ang) * len) > 0.9) len *= 0.95;
    branches.push({ t, len, twig: i < nb - 1 && len > 0.2 && rng.chance(0.4) });
  }
  const kite = rng.chance(0.5) ? { t0: rng.range(rc + 0.05, 0.4), span: rng.range(0.18, 0.3), w: rng.range(0.06, 0.1) } : null;
  const tip = rng.pick(["plain", "fork", "diamond"] as const);
  const rotate = (u: number, v: number, a: number): Vec => [u * Math.cos(a) - v * Math.sin(a), u * Math.sin(a) + v * Math.cos(a)];

  for (let k = 0; k < 6; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / 3;
    const P = (u: number, v: number) => map(...rotate(u, v, a));
    d.stroke([P(0, 0), P(0.6, 0), P(1 + overshoot, 0)], r * 1.3, r * 1.0);
    for (const b of branches) {
      for (const s of [-1, 1]) {
        const ex = b.t + Math.cos(ang) * b.len;
        const ey = s * Math.sin(ang) * b.len;
        d.stroke([P(b.t, 0), P(ex, ey)], r * 1.05, r * 0.95);
        if (b.twig) {
          const mx = b.t + Math.cos(ang) * b.len * 0.5;
          const my = s * Math.sin(ang) * b.len * 0.5;
          const tl = b.len * 0.42;
          d.line(P(mx, my), P(mx + Math.cos(ang * 0.35) * tl, my + s * Math.sin(ang * 0.35) * tl), r);
        }
      }
    }
    if (kite) {
      const t1 = kite.t0 + kite.span;
      const tm = (kite.t0 + t1) / 2;
      d.outline([P(kite.t0, 0), P(tm, kite.w), P(t1, 0), P(tm, -kite.w)], r);
    }
    if (tip === "fork") {
      for (const s of [-1, 1]) d.line(P(0.86, 0), P(0.97, s * 0.08), r);
    } else if (tip === "diamond") {
      d.poly([P(0.78, 0), P(0.86, 0.05), P(0.94, 0), P(0.86, -0.05)]);
    }
  }
  const sides = centerStyle === "ring" ? 18 : 6;
  const ring: Vec[] = [];
  for (let i = 0; i < sides; i++) {
    const a = -Math.PI / 2 + (i / sides) * Math.PI * 2;
    ring.push(map(Math.cos(a) * rc, Math.sin(a) * rc));
  }
  if (centerStyle === "solid") d.poly(ring);
  else if (centerStyle === "star") d.poly(starPoints(0, 0, rc * 1.15, 0.45, 6).map(([u, v]) => map(u, v)));
  else d.outline(ring, r);
  return d;
}

const toeSnowflake: Motif = ({ rng, pad, layout }) => {
  const e = pad.ellipse;
  const over = layout.ring / Math.min(e.rx, e.ry);
  return { material: snowflake(rng, ellipseMapper(e), layout.line, over) };
};

/** Vines growing from the rim, each rolling into a curl, with side curls. */
const vines: Motif = ({ rng, pad, layout }) => {
  const d = new Drawing();
  const e = pad.ellipse;
  const lw = layout.line;
  const map = ellipseMapper(e);
  const rmin = Math.min(e.rx, e.ry);
  const n = rng.int(2, 3);
  const base = rng.range(0, Math.PI * 2);
  for (let i = 0; i < n; i++) {
    const a = base + (i / n) * Math.PI * 2 + rng.range(-0.25, 0.25);
    const [sx, sy] = map(Math.cos(a) * 1.08, Math.sin(a) * 1.08);
    const dir = rng.sign();
    const inward = Math.atan2(e.cy - sy, e.cx - sx) + dir * rng.range(0.4, 0.8);
    const vine = curl(sx, sy, inward, rmin * rng.range(1.5, 1.95), rng.range(1.05, 1.4), -dir, 2.2);
    d.stroke(vine, lw * 0.75, lw * 0.5);
    for (let k = 0; k < 2; k++) {
      const idx = Math.floor(vine.length * (k === 0 ? rng.range(0.18, 0.3) : rng.range(0.4, 0.55)));
      const [px, py] = vine[idx]!;
      const h = heading(vine, idx) + dir * 0.9;
      d.stroke(curl(px, py, h, rmin * rng.range(0.42, 0.62), rng.range(0.8, 1.05), dir, 2.2), lw * 0.62, lw * 0.5);
    }
  }
  return { material: d };
};

/** Outlined petals around a solid centre, held to the rim by three rays. */
const flower: Motif = ({ rng, pad, layout }) => {
  const d = new Drawing();
  const e = pad.ellipse;
  const lw = layout.line;
  const r = lw / 2;
  const map = ellipseMapper(e);
  const n = rng.int(5, 7);
  const rc = rng.range(0.17, 0.23);
  const reach = rng.range(0.74, 0.84);
  const width = rng.range(0.85, 1.0) * Math.sin(Math.PI / n) * reach * 0.62;
  const rot = rng.range(0, Math.PI * 2);
  const over = layout.ring / Math.min(e.rx, e.ry) + 0.04;
  const veins = rng.chance(0.6);
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * Math.PI * 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const P = (t: number, w: number) => map(ca * t - sa * w, sa * t + ca * w);
    const petal: Vec[] = [];
    const steps = 18;
    // rounded teardrop: narrow at the centre, full and round at the tip
    const profile = (t: number) => width * Math.sqrt(Math.max(0, Math.sin(Math.PI * t))) * (0.35 + 0.65 * t);
    for (let k = 0; k <= steps; k++) petal.push(P(lerp(rc * 0.85, reach, k / steps), profile(k / steps)));
    for (let k = steps - 1; k > 0; k--) petal.push(P(lerp(rc * 0.85, reach, k / steps), -profile(k / steps)));
    d.outline(petal, r);
    if (veins) d.line(P(rc, 0), P(lerp(rc, reach, 0.62), 0), r * 0.9);
  }
  // three rays between petals tie the flower to the rim
  for (let k = 0; k < 3; k++) {
    const b = rot + (Math.floor((k * n) / 3) / n) * Math.PI * 2 + Math.PI / n;
    d.line(map(Math.cos(b) * rc, Math.sin(b) * rc), map(Math.cos(b) * (1 + over), Math.sin(b) * (1 + over)), r);
  }
  const disc: Vec[] = [];
  for (let i = 0; i < 24; i++) disc.push(map(Math.cos((i / 24) * Math.PI * 2) * rc, Math.sin((i / 24) * Math.PI * 2) * rc));
  d.poly(disc);
  const cuts = new Drawing();
  const rr = rc * Math.min(e.rx, e.ry);
  if (rr > lw * 3.5) cuts.circle(map(0, 0), rr * 0.4);
  return { material: d, cuts, cutClip: (x, y) => sdCircle(x, y, ...map(0, 0), rr - lw) };
};

/** A Christmas tree on a snowy mound, a star on top, baubles cut into its tiers. */
const tree: Motif = ({ rng, pad, layout }) => {
  const d = new Drawing();
  const e = pad.ellipse;
  const lw = layout.line;
  const sdf = pad.sdf;
  const cx = e.cx;
  const [, bottom] = walkOut(sdf, cx, e.cy, 0, 1, lw * 0.25, 0);
  const [, top] = walkOut(sdf, cx, e.cy, 0, -1, lw * 0.25, 0);
  const H = bottom - top;
  const groundY = bottom - H * rng.range(0.16, 0.2);
  const ext = lw * 4;
  const halfW = Math.max(e.rx, e.ry) * 1.2;
  const mound: Vec[] = [];
  for (let i = 0; i <= 24; i++) {
    const x = lerp(cx - halfW - ext, cx + halfW + ext, i / 24);
    mound.push([x, groundY - H * 0.04 * Math.cos(((x - cx) / halfW) * Math.PI * 0.5)]);
  }
  mound.push([cx + halfW + ext, bottom + ext], [cx - halfW - ext, bottom + ext]);
  d.poly(mound);
  const starR = lw * rng.range(3, 3.8);
  const h = groundY - top - starR * 1.1 - layout.ring * 0.6;
  const w = Math.min(h * rng.range(0.7, 0.8), e.rx * 1.7);
  const tiers = pineTree(d, cx, groundY + lw, h, w, lw, rng);
  const apex = groundY + lw - h;
  d.poly(starPoints(cx, apex + starR * 0.15, starR, 0.45, 5));
  const cuts = new Drawing();
  const br = lw * rng.range(0.85, 1.05);
  for (const poly of tiers.slice(1)) {
    const flat = poly.flat();
    const ys = poly.map((p) => p[1]);
    const y = Math.min(...ys) + (Math.max(...ys) - Math.min(...ys)) * 0.6;
    const xs = poly.map((p) => p[0]);
    const span = (Math.max(...xs) - Math.min(...xs)) / 2;
    for (const s of [-1, 1]) {
      const x = cx + s * span * rng.range(0.25, 0.45);
      if (sdPolygon(x, y, flat) < -(br + lw * 0.9)) cuts.circle([x, y], br);
    }
  }
  return { material: d, cuts, cutClip: (x, y) => sdf(x, y) + lw };
};

/** Solid pad with one shape cut out of it. */
function cutShape(unit: Vec[], ctx: MotifContext, tilt: number, scale: number): Drawing {
  const e = ctx.pad.ellipse;
  const map = ellipseMapper(e, scale);
  const c = Math.cos(tilt);
  const s = Math.sin(tilt);
  const pts = unit.map(([u, v]) => map(u * c - v * s, u * s + v * c));
  return new Drawing().poly(fitInside(pts, [e.cx, e.cy], ctx.pad.sdf, ctx.layout.ring * 1.2));
}

const heart: Motif = (ctx) => ({
  solid: true,
  cuts: cutShape(heartPoints(), ctx, ctx.rng.range(-0.22, 0.22), ctx.rng.range(0.72, 0.82)),
});

const star: Motif = (ctx) => {
  const points = ctx.rng.pick([5, 5, 6, 8] as const);
  const inner = points === 8 ? 0.55 : points === 6 ? 0.5 : 0.42;
  return { solid: true, cuts: cutShape(starPoints(0, 0, 1, inner, points), ctx, ctx.rng.range(-0.15, 0.15), 0.8) };
};

/** A paw inside the paw. */
const paw: Motif = (ctx) => {
  const { rng, pad, layout } = ctx;
  const e = pad.ellipse;
  const d = new Drawing();
  const spread = rng.range(0.92, 1.05);
  const scale = 0.86;
  const shapes: Vec[][] = [];
  const blob = (cx: number, cy: number, rx: number, ry: number, rot: number) => {
    const pts: Vec[] = [];
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2;
      const x = Math.cos(a) * rx;
      const y = Math.sin(a) * ry;
      pts.push([cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)]);
    }
    shapes.push(pts);
  };
  blob(0, 0.3, 0.44, 0.33, 0);
  blob(-0.52 * spread, -0.1, 0.15, 0.2, -0.4);
  blob(-0.19 * spread, -0.43, 0.16, 0.21, -0.12);
  blob(0.19 * spread, -0.43, 0.16, 0.21, 0.12);
  blob(0.52 * spread, -0.1, 0.15, 0.2, 0.4);
  const map = ellipseMapper(e, scale);
  const all = shapes.map((s) => s.map(([u, v]) => map(u, v)));
  // fit all five as one group
  const flat = fitInside(all.flat(), [e.cx, e.cy], pad.sdf, layout.ring * 1.2);
  let k = 0;
  for (const s of all) {
    d.poly(flat.slice(k, k + s.length));
    k += s.length;
  }
  return { solid: true, cuts: d };
};

/** A crescent moon with a couple of twinkles. */
const moon: Motif = ({ rng, pad, layout }) => {
  const e = pad.ellipse;
  const lw = layout.line;
  const R = Math.min(e.rx, e.ry) - layout.ring * 1.4;
  const a = rng.range(-2.6, -0.5);
  const off = R * rng.range(0.34, 0.44);
  const R2 = R * rng.range(0.8, 0.88);
  const c2x = e.cx + Math.cos(a) * off;
  const c2y = e.cy + Math.sin(a) * off;
  const crescent = (x: number, y: number) => Math.max(sdCircle(x, y, e.cx, e.cy, R), -sdCircle(x, y, c2x, c2y, R2));
  const cuts = new Drawing().fn(e.cx - R, e.cy - R, e.cx + R, e.cy + R, crescent);
  // twinkles in the bite of the crescent, kept clear of it
  const sr = lw * rng.range(2.4, 3.2);
  const spots: Vec[] = [
    [c2x + Math.cos(a) * R2 * 0.25, c2y + Math.sin(a) * R2 * 0.25],
    [c2x + Math.cos(a + 1.2) * R2 * 0.45, c2y + Math.sin(a + 1.2) * R2 * 0.45],
    [c2x + Math.cos(a - 1.2) * R2 * 0.45, c2y + Math.sin(a - 1.2) * R2 * 0.45],
  ];
  for (const [x, y] of spots) {
    if (crescent(x, y) > sr + lw * 1.2 && pad.sdf(x, y) < -(sr + layout.ring * 1.2)) cuts.poly(starPoints(x, y, sr, 0.38, 4, rng.range(0, 1)));
  }
  return { solid: true, cuts };
};

export const TOE_LIBRARY: Record<ToeMotif, Motif> = {
  snowflake: toeSnowflake,
  vines,
  flower,
  tree,
  heart,
  star,
  paw,
  moon,
  open: () => ({}),
  solid: () => ({ solid: true }),
};
