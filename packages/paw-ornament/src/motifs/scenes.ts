import { distanceTransform } from "../core/edt";
import { Drawing } from "../core/field";
import { lerp, type Vec } from "../core/math";
import { sdCircle } from "../core/sdf";
import type { MainMotif, TextMask } from "../params";
import { ellipseMapper, fitInside, heartPoints, walkOut, type Motif } from "./common";
import { cornerBranch, drifts, groundBand, treeLine, windGusts } from "./nature";
import { snowflake } from "./toes";

/** The original scene: forest skyline, wind in the sky, drifts below. */
const forest: Motif = ({ rng, pad, layout, params }) => {
  const d = new Drawing();
  const box = pad.box;
  const H = box.y1 - box.y0;
  const W = box.x1 - box.x0;
  const lw = layout.line;
  const s = params.scene;
  const gy = box.y0 + H * rng.range(0.66, 0.71);
  const gT = lw * 2.4;
  const ground = groundBand(d, box, gy, gT, lw * 4, rng);
  const hmax = (gy - box.y0) * rng.range(0.62, 0.72);
  windGusts(d, box, pad.sdf, box.y0 + H * 0.14, gy - hmax * 0.95, s.wind, lw, rng);
  if (s.branches) cornerBranch(d, box, pad.sdf, lw, rng);
  treeLine(d, box.x0 + W * 0.1, box.x1 - W * 0.1, ground, gT, hmax, Math.round(lerp(5, 17, s.trees)), lw, rng);
  drifts(d, box, gy + gT + lw * 2.5, s.waves, lw, rng);
  return { material: d };
};

/** Line-drawn mountain ridges with snow caps, a moon on the rim, pines at their feet. */
const mountains: Motif = ({ rng, pad, layout, params }) => {
  const d = new Drawing();
  const box = pad.box;
  const H = box.y1 - box.y0;
  const W = box.x1 - box.x0;
  const lw = layout.line;
  const r = lw / 2;
  const ext = lw * 4;
  const s = params.scene;
  const gy = box.y0 + H * rng.range(0.7, 0.74);
  const gT = lw * 2.4;
  const ground = groundBand(d, box, gy, gT, ext, rng);

  for (let layer = 0; layer < 2; layer++) {
    const peaks = rng.int(2, 3) + layer;
    const top = lerp(box.y0 + H * 0.22, box.y0 + H * 0.4, layer);
    const pts: Vec[] = [[box.x0 - ext, gy - H * lerp(0.12, 0.04, layer)]];
    for (let i = 0; i < peaks; i++) {
      const t = (i + rng.range(0.35, 0.65)) / peaks;
      const px = lerp(box.x0, box.x1, t);
      const py = lerp(top, gy - H * 0.12, rng.range(0, 0.35));
      const valley = lerp(py, gy, rng.range(0.45, 0.65));
      pts.push([px - (W / peaks) * rng.range(0.22, 0.32), lerp(valley, py, 0.45)]);
      pts.push([px, py]);
      pts.push([px + (W / peaks) * rng.range(0.22, 0.32), lerp(valley, py, 0.4)]);
      // snow cap: a zigzag across the peak, joined to both flanks
      const depth = (valley - py) * rng.range(0.22, 0.3);
      const half = depth * rng.range(0.9, 1.2);
      const zig: Vec[] = [];
      const z = 4;
      for (let k = 0; k <= z; k++) {
        const fx = lerp(-half, half, k / z);
        zig.push([px + fx, py + depth + (k % 2 ? -depth * 0.35 : 0) + Math.abs(fx) * 0.1]);
      }
      d.stroke(zig, r * 0.95);
      d.line([px, py], zig[Math.floor(z / 2)]!, r);
    }
    pts.push([box.x1 + ext, gy - H * lerp(0.1, 0.05, layer)]);
    d.stroke(pts, r * (layer === 0 ? 1.15 : 1.35));
  }

  // moon sitting on the upper rim
  const side = rng.sign();
  const a = side > 0 ? rng.range(-1.2, -0.7) : rng.range(-2.45, -1.95);
  const cx0 = (box.x0 + box.x1) / 2;
  const cy0 = (box.y0 + box.y1) / 2;
  const [rx, ry] = walkOut(pad.sdf, cx0, cy0, Math.cos(a), Math.sin(a), lw * 0.5, 0);
  const R = H * rng.range(0.1, 0.13);
  const mx = rx - Math.cos(a) * R * 0.55;
  const my = ry - Math.sin(a) * R * 0.55;
  const bite = a + Math.PI + side * 0.6;
  d.fn(mx - R, my - R, mx + R, my + R, (x, y) =>
    Math.max(sdCircle(x, y, mx, my, R), -sdCircle(x, y, mx + Math.cos(bite) * R * 0.5, my + Math.sin(bite) * R * 0.5, R * 0.82)),
  );

  windGusts(d, box, pad.sdf, box.y0 + H * 0.12, box.y0 + H * 0.3, Math.min(s.wind, 1), lw, rng);
  treeLine(d, box.x0 + W * 0.12, box.x1 - W * 0.12, ground, gT, (gy - box.y0) * 0.3, Math.round(lerp(0, 9, s.trees)), lw, rng);
  drifts(d, box, gy + gT + lw * 2.5, Math.min(s.waves, 3), lw, rng);
  return { material: d };
};

// signed distance (in mask pixels) for a rasterised text mask, cached by key
const textCache = new Map<string, Float32Array>();
function textSdf(mask: TextMask): Float32Array {
  const hit = textCache.get(mask.key);
  if (hit) return hit;
  const { width: w, height: h, data } = mask;
  const inside = Array.from({ length: w * h }, (_, i) => (data[i] ?? 0) >= 128);
  const toInk = distanceTransform(inside, w, h);
  const toPaper = distanceTransform(
    inside.map((v) => !v),
    w,
    h,
  );
  const sdf = new Float32Array(w * h);
  for (let i = 0; i < sdf.length; i++) sdf[i] = inside[i] ? -(toPaper[i]! - 0.5) : toInk[i]! - 0.5;
  if (textCache.size > 8) textCache.clear();
  textCache.set(mask.key, sdf);
  return sdf;
}

/** The pet's name standing on a snowy bar, drifts below, wind above. */
const name: Motif = ({ rng, pad, layout, params, textMask }) => {
  const d = new Drawing();
  const box = pad.box;
  const H = box.y1 - box.y0;
  const W = box.x1 - box.x0;
  const lw = layout.line;
  const s = params.scene;
  const gy = box.y0 + H * rng.range(0.64, 0.68);
  const gT = lw * 2.6;
  const ground = groundBand(d, box, gy, gT, lw * 4, rng);
  drifts(d, box, gy + gT + lw * 2.5, Math.min(s.waves, 3), lw, rng);
  // a pine or two at each end of the bar
  const pines = Math.round(lerp(0, 2, s.trees));
  if (pines) {
    treeLine(d, box.x0 + W * 0.1, box.x0 + W * 0.2, ground, gT, H * 0.3, pines, lw, rng);
    treeLine(d, box.x1 - W * 0.2, box.x1 - W * 0.1, ground, gT, H * 0.3, pines, lw, rng);
  }
  if (textMask && textMask.width > 1 && textMask.height > 1) {
    const sdf = textSdf(textMask);
    const { width: w, height: h, baseline } = textMask;
    const room = pines ? 0.56 : 0.78;
    const scale = Math.min((H * 0.42) / h, (W * room) / w);
    const cx = (box.x0 + box.x1) / 2;
    const baseY = ground(cx) + gT * 0.55;
    const X0 = cx - (w * scale) / 2;
    const Y0 = baseY - baseline * scale;
    const grow = lw * 0.12;
    windGusts(d, box, pad.sdf, box.y0 + H * 0.1, Math.max(box.y0 + H * 0.12, Y0 - lw * 2), Math.min(s.wind, 2), lw, rng);
    d.fn(X0, Y0, X0 + w * scale, Y0 + h * scale, (x, y) => {
      const mx = (x - X0) / scale;
      const my = (y - Y0) / scale;
      if (mx < 0 || my < 0 || mx > w - 1 || my > h - 1) return 1e9;
      const i = Math.floor(mx);
      const j = Math.floor(my);
      const fx = mx - i;
      const fy = my - j;
      const i1 = Math.min(i + 1, w - 1);
      const j1 = Math.min(j + 1, h - 1);
      const v =
        sdf[j * w + i]! * (1 - fx) * (1 - fy) + sdf[j * w + i1]! * fx * (1 - fy) + sdf[j1 * w + i]! * (1 - fx) * fy + sdf[j1 * w + i1]! * fx * fy;
      return v * scale - grow;
    });
  } else {
    windGusts(d, box, pad.sdf, box.y0 + H * 0.14, gy - H * 0.2, s.wind, lw, rng);
  }
  return { material: d };
};

/** One big snowflake filling the main pad. */
const bigSnowflake: Motif = ({ rng, pad, layout }) => ({
  material: snowflake(rng, ellipseMapper({ ...pad.ellipse, rx: pad.ellipse.rx * 0.95, ry: pad.ellipse.ry * 0.95 }), layout.line * 1.25, 0.35),
});

const heart: Motif = ({ rng, pad, layout }) => {
  const e = pad.ellipse;
  const tilt = rng.range(-0.12, 0.12);
  const scale = Math.min(e.rx, e.ry) * 0.9;
  const cy = e.cy + (pad.box.y1 - pad.box.y0) * 0.04;
  const pts: Vec[] = heartPoints().map(([u, v]) => [
    e.cx + (u * Math.cos(tilt) - v * Math.sin(tilt)) * scale * 1.1,
    cy + (u * Math.sin(tilt) + v * Math.cos(tilt)) * scale,
  ]);
  const fitted = fitInside(pts, [e.cx, cy], pad.sdf, layout.ring * 1.3);
  const cuts = new Drawing().poly(fitted);
  return { solid: true, cuts };
};

export const MAIN_LIBRARY: Record<MainMotif, Motif> = {
  forest,
  mountains,
  name,
  snowflake: bigSnowflake,
  heart,
  open: () => ({}),
  solid: () => ({ solid: true }),
};
