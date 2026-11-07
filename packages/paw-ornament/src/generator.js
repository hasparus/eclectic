// Paw ornament generator.
//
// The whole ornament is described as a signed distance field: negative values
// are material (plywood, acrylic, card), positive values are cut away. Every
// motif is a small set of primitives (tapered strokes, polygons, outlines)
// stamped into the field, clipped to the pad it belongs to. The field is then
// cleaned for cutting (loose islands dropped, specks of cut filled) and traced
// with marching squares into closed, non-intersecting loops, so the SVG can go
// straight to a laser cutter or a plotter.

export const DEFAULTS = Object.freeze({
  seed: "lapka",
  paw: "dog", // dog | cat
  toes: "snowflake", // snowflake | filigree | empty
  scene: "forest", // forest | empty
  widthMm: 90,
  borderMm: 3.6,
  ringMm: 1.8,
  lineMm: 0.75,
  holeMm: 5,
  hole: true,
  web: true,
  trees: 0.6,
  wind: 2,
  branches: true,
  waves: 3,
  minHoleMm2: 0.6,
  resolution: 1000,
});

// ---------------------------------------------------------------- random

function hashString(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

class Rng {
  constructor(seed) {
    this.a = hashString(String(seed));
  }
  next() {
    let a = (this.a = (this.a + 0x6d2b79f5) | 0);
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a, b) {
    return a + (b - a) * this.next();
  }
  int(a, b) {
    return Math.floor(this.range(a, b + 1));
  }
  chance(p) {
    return this.next() < p;
  }
  pick(arr) {
    return arr[Math.floor(this.next() * arr.length)];
  }
  sign() {
    return this.next() < 0.5 ? -1 : 1;
  }
}

// ---------------------------------------------------------------- sdf math

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;

function smin(a, b, k) {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

function prepEllipse(e) {
  const rot = e.rot || 0;
  return { ...e, cos: Math.cos(rot), sin: Math.sin(rot) };
}

// Cheap ellipse distance (exact on the boundary, good near it).
function sdEllipse(px, py, e) {
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

// Signed distance to a simple polygon given as flat [x0, y0, x1, y1, ...].
function sdPolygon(px, py, v) {
  const n = v.length >> 1;
  let d = (px - v[0]) ** 2 + (py - v[1]) ** 2;
  let s = 1;
  for (let i = 0, j = n - 1; i < n; j = i, i++) {
    const xi = v[2 * i];
    const yi = v[2 * i + 1];
    const ex = v[2 * j] - xi;
    const ey = v[2 * j + 1] - yi;
    const wx = px - xi;
    const wy = py - yi;
    const h = clamp((wx * ex + wy * ey) / (ex * ex + ey * ey), 0, 1);
    const bx = wx - ex * h;
    const by = wy - ey * h;
    d = Math.min(d, bx * bx + by * by);
    const c1 = py >= yi;
    const c2 = py < v[2 * j + 1];
    const c3 = ex * wy > ey * wx;
    if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s;
  }
  return s * Math.sqrt(d);
}

// Segment with linearly varying radius (good approximation of a round cone).
function sdTaper(px, py, ax, ay, bx, by, ra, rb) {
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

// ---------------------------------------------------------------- field

class Field {
  constructor(n, size) {
    this.n = n;
    this.size = size;
    this.cs = size / (n - 1);
    this.data = new Float32Array(n * n).fill(1e9);
  }
  // Stamp min(field, max(sdf, clip)) over the bbox of a primitive.
  stamp(x0, y0, x1, y1, sdf, clip) {
    const { n, cs, data } = this;
    const pad = cs * 2;
    const i0 = clamp(Math.floor((x0 - pad) / cs), 0, n - 1);
    const i1 = clamp(Math.ceil((x1 + pad) / cs), 0, n - 1);
    const j0 = clamp(Math.floor((y0 - pad) / cs), 0, n - 1);
    const j1 = clamp(Math.ceil((y1 + pad) / cs), 0, n - 1);
    for (let j = j0; j <= j1; j++) {
      const y = j * cs;
      let idx = j * n + i0;
      for (let i = i0; i <= i1; i++, idx++) {
        const x = i * cs;
        let d = sdf(x, y);
        if (d >= data[idx]) continue;
        if (clip) d = Math.max(d, clip(x, y));
        if (d < data[idx]) data[idx] = d;
      }
    }
  }
  sample(x, y) {
    const { n, cs, data } = this;
    const i = clamp(Math.round(x / cs), 0, n - 1);
    const j = clamp(Math.round(y / cs), 0, n - 1);
    return data[j * n + i];
  }
}

// A drawing is a list of primitives in world units; it is stamped into a
// field with an optional clip function shared by the whole drawing.
class Drawing {
  constructor() {
    this.items = [];
  }
  stroke(pts, r0, r1 = r0) {
    // pts: [[x,y],...], radius tapers from r0 to r1 along the polyline.
    if (pts.length < 2) return;
    let total = 0;
    const acc = [0];
    for (let i = 1; i < pts.length; i++) {
      total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      acc.push(total);
    }
    for (let i = 1; i < pts.length; i++) {
      const ra = lerp(r0, r1, total ? acc[i - 1] / total : 0);
      const rb = lerp(r0, r1, total ? acc[i] / total : 0);
      this.items.push({ t: "seg", a: pts[i - 1], b: pts[i], ra, rb });
    }
  }
  line(a, b, r) {
    this.items.push({ t: "seg", a, b, ra: r, rb: r });
  }
  poly(pts) {
    this.items.push({ t: "poly", v: pts.flat() });
  }
  outline(pts, r) {
    this.items.push({ t: "outline", v: pts.flat(), r });
  }
  circle(c, r) {
    this.items.push({ t: "seg", a: c, b: c, ra: r, rb: r });
  }
  stampInto(field, clip) {
    for (const it of this.items) {
      if (it.t === "seg") {
        const { a, b, ra, rb } = it;
        const r = Math.max(ra, rb);
        field.stamp(
          Math.min(a[0], b[0]) - r,
          Math.min(a[1], b[1]) - r,
          Math.max(a[0], b[0]) + r,
          Math.max(a[1], b[1]) + r,
          (x, y) => sdTaper(x, y, a[0], a[1], b[0], b[1], ra, rb),
          clip,
        );
      } else {
        const v = it.v;
        let x0 = Infinity;
        let y0 = Infinity;
        let x1 = -Infinity;
        let y1 = -Infinity;
        for (let i = 0; i < v.length; i += 2) {
          x0 = Math.min(x0, v[i]);
          x1 = Math.max(x1, v[i]);
          y0 = Math.min(y0, v[i + 1]);
          y1 = Math.max(y1, v[i + 1]);
        }
        const r = it.t === "outline" ? it.r : 0;
        const f =
          it.t === "outline"
            ? (x, y) => Math.abs(sdPolygon(x, y, v)) - r
            : (x, y) => sdPolygon(x, y, v);
        field.stamp(x0 - r, y0 - r, x1 + r, y1 + r, f, clip);
      }
    }
  }
}

// ---------------------------------------------------------------- layout

function layoutPaw(kind) {
  if (kind === "cat") {
    return {
      toes: [
        { cx: 250, cy: 500, rx: 86, ry: 96, rot: -0.62 },
        { cx: 403, cy: 358, rx: 94, ry: 106, rot: -0.2 },
        { cx: 597, cy: 358, rx: 94, ry: 106, rot: 0.2 },
        { cx: 750, cy: 500, rx: 86, ry: 96, rot: 0.62 },
      ],
      main: {
        parts: [
          { cx: 500, cy: 650, rx: 168, ry: 118 },
          { cx: 362, cy: 768, rx: 96, ry: 96 },
          { cx: 500, cy: 792, rx: 100, ry: 100 },
          { cx: 638, cy: 768, rx: 96, ry: 96 },
        ],
        k: 64,
      },
    };
  }
  return {
    toes: [
      { cx: 206, cy: 490, rx: 92, ry: 126, rot: -0.5 },
      { cx: 386, cy: 316, rx: 106, ry: 150, rot: -0.13 },
      { cx: 614, cy: 316, rx: 106, ry: 150, rot: 0.13 },
      { cx: 794, cy: 490, rx: 92, ry: 126, rot: 0.5 },
    ],
    main: {
      parts: [
        { cx: 500, cy: 648, rx: 214, ry: 152 },
        { cx: 396, cy: 766, rx: 114, ry: 114 },
        { cx: 604, cy: 766, rx: 114, ry: 114 },
      ],
      k: 96,
    },
  };
}

function ellipseBoundary(e, steps = 72) {
  const pts = [];
  const c = Math.cos(e.rot || 0);
  const s = Math.sin(e.rot || 0);
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const x = Math.cos(a) * e.rx;
    const y = Math.sin(a) * e.ry;
    pts.push([e.cx + x * c - y * s, e.cy + x * s + y * c]);
  }
  return pts;
}

function minDistance(e, sdf) {
  let m = Infinity;
  for (const [x, y] of ellipseBoundary(e)) m = Math.min(m, sdf(x, y));
  return m;
}

// ---------------------------------------------------------------- motifs

// A flourish with a set total turn. Curvature grows as t^power, so the stroke
// sweeps out and then rolls into a tight curl, like a pen flourish.
function curl(x, y, theta, len, turns, dir, power = 2.4, steps = 56, bend = 0) {
  const pts = [[x, y]];
  const ds = len / steps;
  const T = turns * Math.PI * 2;
  let a = theta;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    a += dir * (bend + (T * (power + 1) * Math.pow(t, power)) / len) * ds;
    x += Math.cos(a) * ds;
    y += Math.sin(a) * ds;
    pts.push([x, y]);
  }
  return pts;
}

const heading = (pts, i) => {
  const a = pts[Math.max(0, i - 1)];
  const b = pts[Math.min(pts.length - 1, i + 1)];
  return Math.atan2(b[1] - a[1], b[0] - a[0]);
};

// A 6-fold snowflake in unit space (arm length 1), mapped into a pad.
function snowflake(rng, map, lw, overshoot) {
  const d = new Drawing();
  const r = lw / 2;
  const centerStyle = rng.pick(["hex", "hex", "star", "ring", "solid"]);
  const rc = rng.range(0.13, 0.22);
  const nb = rng.int(2, 4);
  const ang = rng.range(0.72, 1.0);
  const lmax = rng.range(0.3, 0.42);
  const branches = [];
  for (let i = 0; i < nb; i++) {
    const t = lerp(rc + 0.16, 0.8, nb === 1 ? 0.5 : i / (nb - 1)) + rng.range(-0.02, 0.02);
    let len = lmax * (1 - 0.62 * t) * rng.range(0.85, 1.1);
    // keep frond tips off the rim so the flake reads as a flake
    while (Math.hypot(t + Math.cos(ang) * len, Math.sin(ang) * len) > 0.9) len *= 0.95;
    branches.push({ t, len, twig: i < nb - 1 && len > 0.2 && rng.chance(0.4) });
  }
  const kite = rng.chance(0.5)
    ? { t0: rng.range(rc + 0.05, 0.4), span: rng.range(0.18, 0.3), w: rng.range(0.06, 0.1) }
    : null;
  const tip = rng.pick(["plain", "fork", "diamond"]);
  const rotate = (u, v, a) => [u * Math.cos(a) - v * Math.sin(a), u * Math.sin(a) + v * Math.cos(a)];

  for (let k = 0; k < 6; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / 3;
    const P = (u, v) => map(...rotate(u, v, a));
    d.stroke([P(0, 0), P(0.6, 0), P(1 + overshoot, 0)], r * 1.3, r * 1.0);
    for (const b of branches) {
      for (const s of [-1, 1]) {
        const ex = b.t + Math.cos(ang) * b.len;
        const ey = s * Math.sin(ang) * b.len;
        d.stroke([P(b.t, 0), P(ex, ey)], r * 1.05, r * 0.9);
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
  const ring = [];
  const sides = centerStyle === "ring" ? 18 : 6;
  for (let i = 0; i < sides; i++) {
    const a = -Math.PI / 2 + (i / sides) * Math.PI * 2;
    ring.push(map(Math.cos(a) * rc, Math.sin(a) * rc));
  }
  if (centerStyle === "solid") d.poly(ring);
  else if (centerStyle === "star") {
    const star = [];
    for (let i = 0; i < 12; i++) {
      const a = -Math.PI / 2 + (i / 12) * Math.PI * 2;
      const rr = i % 2 ? rc * 0.5 : rc * 1.15;
      star.push(map(Math.cos(a) * rr, Math.sin(a) * rr));
    }
    d.poly(star);
  } else d.outline(ring, r);
  return d;
}

function padMapper(e, scale) {
  const c = Math.cos(e.rot || 0);
  const s = Math.sin(e.rot || 0);
  return (u, v) => {
    const x = u * e.rx * scale;
    const y = v * e.ry * scale;
    return [e.cx + x * c - y * s, e.cy + x * s + y * c];
  };
}

// Vines growing from the pad's rim, each rolling into a curl, with side curls.
function toeFiligree(rng, e, lw) {
  const d = new Drawing();
  const map = padMapper(e, 1);
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
    const sides = 2;
    for (let k = 0; k < sides; k++) {
      const idx = Math.floor(vine.length * (k === 0 ? rng.range(0.18, 0.3) : rng.range(0.4, 0.55)));
      const [px, py] = vine[idx];
      const h = heading(vine, idx) + dir * 0.9;
      d.stroke(curl(px, py, h, rmin * rng.range(0.42, 0.62), rng.range(0.8, 1.05), dir, 2.2), lw * 0.62, lw * 0.5);
    }
  }
  return d;
}

function pineTree(d, bx, by, h, w, lw, rng) {
  const tiers = clamp(Math.round(h / (lw * 6.5)), 3, 8);
  const y0 = by - h;
  const canopy = h * 0.86;
  const step = canopy / tiers;
  for (let k = 0; k < tiers; k++) {
    const yt = y0 + k * step * 0.82;
    const yb = y0 + (k + 1) * step + step * 0.12;
    const hw = (w / 2) * (0.28 + 0.72 * ((k + 1) / tiers)) * rng.range(0.92, 1.08);
    const droop = step * rng.range(0.18, 0.3);
    d.poly([
      [bx, yt],
      [bx + hw * 0.5, yb - step * 0.42],
      [bx + hw, yb + droop * 0.4],
      [bx + hw * 0.42, yb - step * 0.08],
      [bx, yb + step * 0.02],
      [bx - hw * 0.42, yb - step * 0.08],
      [bx - hw, yb + droop * 0.4],
      [bx - hw * 0.5, yb - step * 0.42],
    ]);
  }
  d.line([bx, y0 + canopy * 0.4], [bx, by + lw * 3], Math.max(lw * 0.55, w * 0.035));
}

function bareBranch(d, x, y, a, len, r, depth, rng, minR) {
  const steps = 12;
  const bend = (rng.range(-0.7, 0.7) * Math.PI * 0.25) / len;
  const pts = [[x, y]];
  for (let i = 1; i <= steps; i++) {
    a += bend * (len / steps) + rng.range(-0.06, 0.06);
    x += Math.cos(a) * (len / steps);
    y += Math.sin(a) * (len / steps);
    pts.push([x, y]);
  }
  const rEnd = Math.max(minR, r * 0.6);
  d.stroke(pts, r, rEnd);
  if (depth <= 0) {
    // twig tips roll into small curls, which ties the branch to the swirls
    if (rng.chance(0.35)) d.stroke(curl(x, y, a, len * 0.8, 0.8, rng.sign(), 2.2, 28), minR, minR);
    return;
  }
  const kids = rng.int(1, 2);
  for (let i = 0; i < kids; i++) {
    const at = rng.range(0.3, 0.85);
    const idx = Math.round(at * steps);
    const [px, py] = pts[idx];
    const ka = heading(pts, idx) + rng.sign() * rng.range(0.45, 0.9);
    bareBranch(d, px, py, ka, len * rng.range(0.42, 0.6), Math.max(minR, lerp(r, rEnd, at) * 0.8), depth - 1, rng, minR);
  }
  bareBranch(d, x, y, a + rng.range(-0.3, 0.3), len * 0.55, rEnd, depth - 1, rng, minR);
}

// Walk from (x, y) along (ux, uy) until just past the pad rim, to anchor a stroke.
function anchorOnRim(padSdf, x, y, ux, uy, step, past) {
  for (let s = 0; s < 600 && padSdf(x, y) < past; s++) {
    x += ux * step;
    y += uy * step;
  }
  return [x, y];
}

function forestScene(rng, box, padSdf, P, lw) {
  const d = new Drawing();
  const { x0, x1, y0, y1 } = box;
  const W = x1 - x0;
  const H = y1 - y0;
  const r = lw / 2;
  const ext = lw * 4;

  // ground line
  const gy = y0 + H * rng.range(0.66, 0.71);
  const f1 = rng.range(1.5, 2.6) / W;
  const ph1 = rng.range(0, 6.28);
  const amp = H * 0.025;
  const ground = (x) => gy + amp * Math.sin(x * f1 * Math.PI * 2 + ph1);
  const gT = lw * 2.4;
  const top = [];
  const bot = [];
  for (let i = 0; i <= 40; i++) {
    const x = lerp(x0 - ext, x1 + ext, i / 40);
    top.push([x, ground(x)]);
    bot.unshift([x, ground(x) + gT]);
  }
  d.poly([...top, ...bot]);

  // wind: gusts entering from the rim and rolling into curls, drawn first so
  // trees sit in front of them visually (it is all one material anyway)
  const hmax = (gy - y0) * rng.range(0.62, 0.72);
  const sky0 = y0 + H * 0.14;
  const sky1 = gy - hmax * 0.95;
  let left = rng.chance(0.5);
  for (let i = 0; i < P.wind; i++) {
    const sy = lerp(sky0, sky1, P.wind === 1 ? rng.range(0.2, 0.6) : (i + rng.range(0.1, 0.6)) / P.wind);
    const ux = left ? -1 : 1;
    const [sx] = anchorOnRim(padSdf, left ? x0 + W * 0.2 : x1 - W * 0.2, sy, ux, 0, lw * 0.5, lw * 1.5);
    const head = (left ? 0 : Math.PI) + rng.range(-0.15, 0.15);
    // mostly curl down into the open sky, sometimes up
    const dir = (left ? 1 : -1) * (rng.chance(0.8) ? 1 : -1);
    const L = W * rng.range(0.5, 0.7);
    const turns = rng.range(1.15, 1.6);
    d.stroke(curl(sx, sy, head, L, turns, dir, 3.4, 90), r * 2.3, r * 1.05);
    // a companion line running alongside, as in a gust of wind
    const off = lw * 3.2 * -dir;
    const [cx] = anchorOnRim(padSdf, left ? x0 + W * 0.2 : x1 - W * 0.2, sy + off, ux, 0, lw * 0.5, lw * 1.5);
    d.stroke(curl(cx, sy + off, head, L * rng.range(0.5, 0.66), turns * 0.8, dir, 3.2, 60), r * 1.5, r * 0.95);
    left = !left;
  }

  // a bare branch reaching in from an upper corner
  if (P.branches) {
    const fromLeft = rng.chance(0.5);
    const ang = fromLeft ? rng.range(-2.7, -2.35) : rng.range(-0.8, -0.45);
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const ux = Math.cos(ang);
    const uy = Math.sin(ang);
    const [sx, sy] = anchorOnRim(padSdf, cx, cy, ux, uy, lw * 0.5, lw * 2);
    // grow roughly level into the sky, above the treetops
    const a = (fromLeft ? 0 : Math.PI) + (fromLeft ? 1 : -1) * rng.range(0.05, 0.3);
    bareBranch(d, sx, sy, a, W * rng.range(0.24, 0.3), r * 2.2, 2, rng, r * 0.95);
  }

  // forest skyline
  const n = Math.round(lerp(5, 17, P.trees));
  const peak = rng.range(0.35, 0.65);
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const bx = lerp(x0 + W * 0.1, x1 - W * 0.1, t) + rng.range(-0.3, 0.3) * (W / n) * 0.6;
    const prof = Math.exp(-(((t - peak) / 0.42) ** 2));
    const h = hmax * (0.36 + 0.64 * prof) * rng.range(0.78, 1.04);
    const w = h * rng.range(0.34, 0.44);
    pineTree(d, bx, ground(bx) + gT * 0.5, h, w, lw, rng);
  }

  // snow drifts below the ground: wavy bands, some rolling into a curl
  const bandsTop = gy + gT + lw * 2.5;
  const bandsSpan = y1 - bandsTop;
  for (let i = 0; i < P.waves; i++) {
    const yb = bandsTop + bandsSpan * ((i + 0.55) / (P.waves + 0.35));
    const f = rng.range(1.2, 2.2) / W;
    const ph = rng.range(0, 6.28);
    const a = H * rng.range(0.018, 0.035);
    const wave = (x) => yb + a * Math.sin(x * f * Math.PI * 2 + ph);
    const partial = rng.chance(0.7);
    const fromLeft = rng.chance(0.5);
    const endT = partial ? rng.range(0.5, 0.78) : 1;
    const pts = [];
    for (let k = 0; k <= 40; k++) {
      const t = (k / 40) * endT;
      const x = fromLeft ? lerp(x0 - ext, x1 + ext, t) : lerp(x1 + ext, x0 - ext, t);
      pts.push([x, wave(x)]);
    }
    d.stroke(pts, r * 1.5, r * 1.2);
    if (partial) {
      const [ex, ey] = pts[pts.length - 1];
      const dir = (fromLeft ? -1 : 1) * (rng.chance(0.7) ? 1 : -1);
      d.stroke(curl(ex, ey, heading(pts, pts.length - 1), H * rng.range(0.2, 0.28), rng.range(1.0, 1.3), dir, 2.4), r * 1.2, r * 0.95);
    }
  }
  return d;
}

// ---------------------------------------------------------------- tracing

const CORNERS = [
  [0, 0, 8],
  [1, 0, 4],
  [1, 1, 2],
  [0, 1, 1],
];
const EDGE_MID = { T: [0.5, 0], R: [1, 0.5], B: [0.5, 1], L: [0, 0.5] };
const CASES = {
  1: [["L", "B"]],
  2: [["B", "R"]],
  3: [["L", "R"]],
  4: [["T", "R"]],
  5: [
    ["T", "R"],
    ["L", "B"],
  ],
  6: [["T", "B"]],
  7: [["T", "L"]],
  8: [["L", "T"]],
  9: [["T", "B"]],
  10: [
    ["L", "T"],
    ["B", "R"],
  ],
  11: [["T", "R"]],
  12: [["L", "R"]],
  13: [["B", "R"]],
  14: [["L", "B"]],
};

// Orient every segment so material is on the same side; then loops chain.
const TABLE = (() => {
  const table = [];
  for (let c = 0; c < 16; c++) {
    const segs = (CASES[c] || []).map(([ea, eb]) => {
      const a = EDGE_MID[ea];
      const b = EDGE_MID[eb];
      const mx = (a[0] + b[0]) / 2;
      const my = (a[1] + b[1]) / 2;
      let best = null;
      let bd = Infinity;
      for (const [x, y, bit] of CORNERS) {
        if (!(c & bit)) continue;
        const dd = (x - mx) ** 2 + (y - my) ** 2;
        if (dd < bd) {
          bd = dd;
          best = [x, y];
        }
      }
      const cross = (b[0] - a[0]) * (best[1] - a[1]) - (b[1] - a[1]) * (best[0] - a[0]);
      return cross > 0 ? [ea, eb] : [eb, ea];
    });
    table.push(segs);
  }
  return table;
})();

function traceContours(field) {
  const { n, cs, data } = field;
  const next = new Int32Array(n * n * 2).fill(-1);
  const edgeId = (e, i, j) => {
    switch (e) {
      case "T":
        return 2 * (j * n + i);
      case "B":
        return 2 * ((j + 1) * n + i);
      case "L":
        return 2 * (j * n + i) + 1;
      default:
        return 2 * (j * n + i + 1) + 1;
    }
  };
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const tl = data[j * n + i] < 0;
      const tr = data[j * n + i + 1] < 0;
      const br = data[(j + 1) * n + i + 1] < 0;
      const bl = data[(j + 1) * n + i] < 0;
      const c = (tl ? 8 : 0) | (tr ? 4 : 0) | (br ? 2 : 0) | (bl ? 1 : 0);
      if (c === 0 || c === 15) continue;
      for (const [ea, eb] of TABLE[c]) next[edgeId(ea, i, j)] = edgeId(eb, i, j);
    }
  }
  const pos = (id) => {
    const p = id >> 1;
    const i = p % n;
    const j = (p / n) | 0;
    const v0 = data[p];
    if (id & 1) {
      const v1 = data[p + n];
      const t = v0 / (v0 - v1);
      return [i * cs, (j + t) * cs];
    }
    const v1 = data[p + 1];
    const t = v0 / (v0 - v1);
    return [(i + t) * cs, j * cs];
  };
  const loops = [];
  for (let s = 0; s < next.length; s++) {
    if (next[s] < 0) continue;
    const loop = [];
    let e = s;
    while (e >= 0 && next[e] >= 0) {
      loop.push(pos(e));
      const nx = next[e];
      next[e] = -1;
      e = nx;
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

function simplifyClosed(pts, eps) {
  if (pts.length < 8) return pts;
  // split at the farthest pair-ish point to run RDP on two open chains
  let far = 0;
  let fd = 0;
  for (let i = 1; i < pts.length; i++) {
    const dd = (pts[i][0] - pts[0][0]) ** 2 + (pts[i][1] - pts[0][1]) ** 2;
    if (dd > fd) {
      fd = dd;
      far = i;
    }
  }
  const a = rdp(pts.slice(0, far + 1), eps);
  const b = rdp([...pts.slice(far), pts[0]], eps);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

function rdp(pts, eps) {
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    const [ax, ay] = pts[s];
    const [bx, by] = pts[e];
    const dx = bx - ax;
    const dy = by - ay;
    const l = Math.hypot(dx, dy) || 1;
    let md = 0;
    let mi = -1;
    for (let i = s + 1; i < e; i++) {
      const dd = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / l;
      if (dd > md) {
        md = dd;
        mi = i;
      }
    }
    if (md > eps && mi > 0) {
      keep[mi] = 1;
      stack.push([s, mi], [mi, e]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

// ---------------------------------------------------------------- cleanup

// 4-connected component labelling of cells matching `inside`.
function components(field, inside) {
  const { n, data } = field;
  const label = new Int32Array(n * n).fill(-1);
  const comps = [];
  const stack = new Int32Array(n * n);
  for (let s = 0; s < n * n; s++) {
    if (label[s] >= 0 || !inside(data[s])) continue;
    const id = comps.length;
    let size = 0;
    let border = false;
    let sp = 0;
    stack[sp++] = s;
    label[s] = id;
    while (sp) {
      const p = stack[--sp];
      size++;
      const i = p % n;
      const j = (p / n) | 0;
      if (i === 0 || j === 0 || i === n - 1 || j === n - 1) border = true;
      if (i > 0 && label[p - 1] < 0 && inside(data[p - 1])) (label[p - 1] = id), (stack[sp++] = p - 1);
      if (i < n - 1 && label[p + 1] < 0 && inside(data[p + 1])) (label[p + 1] = id), (stack[sp++] = p + 1);
      if (j > 0 && label[p - n] < 0 && inside(data[p - n])) (label[p - n] = id), (stack[sp++] = p - n);
      if (j < n - 1 && label[p + n] < 0 && inside(data[p + n])) (label[p + n] = id), (stack[sp++] = p + n);
    }
    comps.push({ size, border });
  }
  return { label, comps };
}

function cleanForCutting(field, minHoleCells) {
  const { data, cs } = field;
  // 1. keep only the largest piece of material
  const mat = components(field, (v) => v < 0);
  let biggest = 0;
  mat.comps.forEach((c, i) => {
    if (c.size > mat.comps[biggest].size) biggest = i;
  });
  // single-cell slivers (tree tips, arm ends) are not worth reporting
  const islands = mat.comps.filter((c, i) => i !== biggest && c.size > Math.max(4, minHoleCells)).length;
  const strays = mat.comps.length - 1;
  if (strays) {
    for (let p = 0; p < data.length; p++) {
      if (mat.label[p] >= 0 && mat.label[p] !== biggest) data[p] = cs * 0.5;
    }
  }
  // 2. fill specks of cut too small to cut cleanly
  const holes = components(field, (v) => v >= 0);
  let specks = 0;
  const fill = holes.comps.map((c) => !c.border && c.size < minHoleCells);
  fill.forEach((f) => f && specks++);
  if (specks) {
    for (let p = 0; p < data.length; p++) {
      if (holes.label[p] >= 0 && fill[holes.label[p]]) data[p] = -cs * 0.5;
    }
  }
  const holeCount = holes.comps.filter((c, i) => !c.border && !fill[i]).length;
  return { islands, specks, holeCount };
}

// ---------------------------------------------------------------- main

export function generate(options = {}) {
  const P = { ...DEFAULTS, ...options };
  P.trees = clamp(+P.trees, 0, 1);
  P.wind = clamp(Math.round(+P.wind), 0, 4);
  P.waves = clamp(Math.round(+P.waves), 0, 5);
  const S = 1000;
  const N = clamp(Math.round(P.resolution), 120, 1600);
  const rng = (label) => new Rng(`${P.seed}|${label}`);

  const L = layoutPaw(P.paw);
  // world units per millimetre, from the requested finished width
  let minX = Infinity;
  let maxX = -Infinity;
  for (const t of L.toes) for (const [x] of ellipseBoundary(t)) (minX = Math.min(minX, x)), (maxX = Math.max(maxX, x));
  const borderMm = clamp(+P.borderMm, 1, P.widthMm / 8);
  const u = (maxX - minX) / (P.widthMm - 2 * borderMm);
  const B = borderMm * u;
  const G = clamp(+P.ringMm, 0.6, 6) * u;
  const lw = clamp(+P.lineMm, 0.3, 3) * u;
  const rh = (clamp(+P.holeMm, 2, 12) / 2) * u;

  const mainParts = L.main.parts.map(prepEllipse);
  const mainSdf = (x, y) => {
    let d = sdEllipse(x, y, mainParts[0]);
    for (let i = 1; i < mainParts.length; i++) d = smin(d, sdEllipse(x, y, mainParts[i]), L.main.k);
    return d;
  };

  // shrink toes until every pad is at least one ring width from its neighbours
  const toes = L.toes.map(prepEllipse);
  for (let iter = 0; iter < 40; iter++) {
    let changed = false;
    toes.forEach((t, i) => {
      const others = [mainSdf, ...toes.filter((_, j) => j !== i).map((o) => (x, y) => sdEllipse(x, y, o))];
      const md = Math.min(...others.map((f) => minDistance(t, f)));
      if (md < G) {
        t.rx *= 0.985;
        t.ry *= 0.985;
        changed = true;
      }
    });
    if (!changed) break;
  }
  const toeSdf = toes.map((t) => (x, y) => sdEllipse(x, y, t));
  const pads = (x, y) => {
    let d = mainSdf(x, y);
    for (const t of toes) d = Math.min(d, sdEllipse(x, y, t));
    return d;
  };

  // hanging hole: as low as possible between the inner toes
  const hx = 500;
  let hy = Math.min(toes[1].cy, toes[2].cy);
  while (hy > rh + B + 10 && pads(hx, hy) < rh + G) hy -= 1;
  const holeSdf = (x, y) => Math.sqrt((x - hx) ** 2 + (y - hy) ** 2) - rh;

  const hull = [toes[0], toes[1], toes[2], toes[3]].flatMap((t) => [t.cx, t.cy]);
  hull.push(mainParts[0].cx + 120, mainParts[0].cy + 40, mainParts[0].cx - 120, mainParts[0].cy + 40);
  const kBlend = 70 + B * 0.6;
  const outer = (x, y) => {
    let d = smin(pads(x, y), sdPolygon(x, y, hull), kBlend);
    d -= B;
    if (P.hole) d = smin(d, Math.sqrt((x - hx) ** 2 + (y - hy) ** 2) - (rh + B), 40);
    return d;
  };

  // ---------------------------------------------------------- base field
  const field = new Field(N, S);
  const zone = new Float32Array(N * N); // where web cut-outs may go
  {
    const { data, cs } = field;
    const mb = Math.max(G, lw * 1.2);
    for (let j = 0; j < N; j++) {
      const y = j * cs;
      for (let i = 0; i < N; i++) {
        const x = i * cs;
        const o = outer(x, y);
        let cut = pads(x, y);
        if (P.hole) cut = Math.min(cut, holeSdf(x, y));
        data[j * N + i] = Math.max(o, -cut);
        zone[j * N + i] = Math.max(o + mb, mb - cut);
      }
    }
  }

  // ---------------------------------------------------------- web filigree
  if (P.web) {
    const r = rng("web");
    const cuts = new Field(N, S);
    const seeds = [];
    const cs = field.cs;
    const minRoom = lw * 2.2;
    for (let tries = 0; tries < 2500 && seeds.length < 24; tries++) {
      const x = r.range(100, 900);
      const y = r.range(100, 900);
      const i = Math.round(x / cs);
      const j = Math.round(y / cs);
      const room = -zone[j * N + i];
      if (!(room > minRoom)) continue;
      if (seeds.some((s) => Math.hypot(s.x - x, s.y - y) < (s.room + room) * 1.6)) continue;
      seeds.push({ x, y, room });
    }
    const d = new Drawing();
    for (const s of seeds) {
      // a teardrop piercing with a short curled tail
      const size = Math.min(s.room, lw * 6);
      const a = r.range(0, Math.PI * 2);
      const sx = s.x - Math.cos(a) * size * 0.45;
      const sy = s.y - Math.sin(a) * size * 0.45;
      d.stroke(curl(sx, sy, a, size * 1.7, 0.45, r.sign(), 2, 30), size * 0.5, lw * 0.4);
    }
    const zoneAt = (x, y) => {
      const i = clamp(Math.round(x / cs), 0, N - 1);
      const j = clamp(Math.round(y / cs), 0, N - 1);
      return zone[j * N + i];
    };
    d.stampInto(cuts, zoneAt);
    const { data } = field;
    for (let p = 0; p < data.length; p++) if (cuts.data[p] < 0) data[p] = Math.max(data[p], -cuts.data[p]);
  }

  // ---------------------------------------------------------- pad motifs
  const feat = new Field(N, S);
  const clipExt = Math.min(G, B) * 0.5;
  if (P.toes !== "empty") {
    toes.forEach((t, i) => {
      const r = rng(`toe${i}`);
      const sdf = toeSdf[i];
      const clip = (x, y) => sdf(x, y) - clipExt;
      if (P.toes === "snowflake") {
        const over = (clipExt * 2) / Math.min(t.rx, t.ry);
        snowflake(r, padMapper(t, 1), lw, over).stampInto(feat, clip);
      } else {
        toeFiligree(r, t, lw).stampInto(feat, clip);
      }
    });
  }
  if (P.scene === "forest") {
    let y0 = Infinity;
    let y1 = -Infinity;
    let x0 = Infinity;
    let x1 = -Infinity;
    for (const pt of mainParts)
      for (const [x, y] of ellipseBoundary(pt)) {
        if (mainSdf(x, y) > 1) continue;
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
    const clip = (x, y) => mainSdf(x, y) - clipExt;
    forestScene(rng("forest"), { x0, x1, y0, y1 }, mainSdf, P, lw).stampInto(feat, clip);
  }
  {
    const { data } = field;
    for (let p = 0; p < data.length; p++) {
      if (feat.data[p] < data[p]) data[p] = feat.data[p];
    }
    if (P.hole) {
      const cs = field.cs;
      for (let j = 0; j < N; j++)
        for (let i = 0; i < N; i++) {
          const h = holeSdf(i * cs, j * cs);
          if (h < cs * 3) data[j * N + i] = Math.max(data[j * N + i], -h);
        }
    }
  }

  // ---------------------------------------------------------- cleanup + trace
  const minHoleCells = (clamp(+P.minHoleMm2, 0, 20) * u * u) / (field.cs * field.cs);
  const report = cleanForCutting(field, minHoleCells);
  const loops = traceContours(field).map((l) => simplifyClosed(l, field.cs * 0.3));

  let bx0 = Infinity;
  let by0 = Infinity;
  let bx1 = -Infinity;
  let by1 = -Infinity;
  let cutLength = 0;
  for (const l of loops) {
    for (let i = 0; i < l.length; i++) {
      const [x, y] = l[i];
      bx0 = Math.min(bx0, x);
      by0 = Math.min(by0, y);
      bx1 = Math.max(bx1, x);
      by1 = Math.max(by1, y);
      const [nx, ny] = l[(i + 1) % l.length];
      cutLength += Math.hypot(nx - x, ny - y);
    }
  }

  return {
    params: P,
    loops,
    field,
    unitsPerMm: u,
    bbox: { x: bx0, y: by0, w: bx1 - bx0, h: by1 - by0 },
    stats: {
      widthMm: (bx1 - bx0) / u,
      heightMm: (by1 - by0) / u,
      cutLengthMm: cutLength / u,
      paths: loops.length,
      openings: report.holeCount,
      islandsRemoved: report.islands,
      specksFilled: report.specks,
    },
  };
}

export function pathData(loops, ox = 0, oy = 0) {
  let d = "";
  for (const l of loops) {
    d += `M${(l[0][0] - ox).toFixed(1)} ${(l[0][1] - oy).toFixed(1)}`;
    for (let i = 1; i < l.length; i++) d += `L${(l[i][0] - ox).toFixed(1)} ${(l[i][1] - oy).toFixed(1)}`;
    d += "Z";
  }
  return d;
}

// mode: "fill" (black stencil) or "cut" (hairline cut paths for a laser)
export function toSVG(result, { mode = "fill", margin = 2, color } = {}) {
  const { bbox, unitsPerMm: u, loops, params } = result;
  const m = margin * u;
  const w = bbox.w + 2 * m;
  const h = bbox.h + 2 * m;
  const d = pathData(loops, bbox.x - m, bbox.y - m);
  const wmm = (w / u).toFixed(2);
  const hmm = (h / u).toFixed(2);
  const shape =
    mode === "cut"
      ? `<path d="${d}" fill="none" stroke="${color || "#ff0000"}" stroke-width="${(0.1 * u).toFixed(2)}" stroke-linejoin="round"/>`
      : `<path d="${d}" fill="${color || "#000"}" fill-rule="evenodd"/>`;
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${wmm}mm" height="${hmm}mm" viewBox="0 0 ${w.toFixed(1)} ${h.toFixed(1)}">\n` +
    `<title>Paw ornament, ${params.paw}, seed ${escapeXml(String(params.seed))}</title>\n` +
    `${shape}\n</svg>\n`
  );
}

function escapeXml(s) {
  return s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
