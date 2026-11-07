import { distanceTransform } from "./edt";
import type { Field } from "./field";
import { sdTaper } from "./sdf";

interface Component {
  size: number;
  border: boolean;
}

/** 4-connected component labelling of the samples where `inside(v)` holds. */
export function components(field: Field, inside: (v: number) => boolean): { label: Int32Array; comps: Component[] } {
  const { nx, ny, data } = field;
  const label = new Int32Array(nx * ny).fill(-1);
  const comps: Component[] = [];
  const stack = new Int32Array(nx * ny);
  for (let s = 0; s < nx * ny; s++) {
    if (label[s]! >= 0 || !inside(data[s]!)) continue;
    const id = comps.length;
    let size = 0;
    let border = false;
    let sp = 0;
    stack[sp++] = s;
    label[s] = id;
    while (sp) {
      const p = stack[--sp]!;
      size++;
      const i = p % nx;
      const j = (p / nx) | 0;
      if (i === 0 || j === 0 || i === nx - 1 || j === ny - 1) border = true;
      const visit = (q: number) => {
        if (label[q]! < 0 && inside(data[q]!)) {
          label[q] = id;
          stack[sp++] = q;
        }
      };
      if (i > 0) visit(p - 1);
      if (i < nx - 1) visit(p + 1);
      if (j > 0) visit(p - nx);
      if (j < ny - 1) visit(p + nx);
    }
    comps.push({ size, border });
  }
  return { label, comps };
}

const isMaterial = (v: number) => v < 0;
const isCut = (v: number) => v >= 0;

export interface IslandReport {
  /** Loose pieces joined to the ornament with a bridge. */
  bridged: number;
  /** Loose pieces too far away to bridge, or too small to matter, that were dropped. */
  removed: number;
  /** Removed single-sample slivers (anti-aliasing debris), not worth reporting. */
  slivers: number;
}

/**
 * Makes the material one piece. Loose islands bigger than `sliverCells` that
 * lie within `maxBridge` of the main piece get a bridge of radius `bridgeR`
 * along the shortest path; everything else loose is cut away.
 */
export function connectIslands(field: Field, sliverCells: number, maxBridge: number, bridgeR: number): IslandReport {
  const { nx, ny, cs, ox, oy, data } = field;
  const report: IslandReport = { bridged: 0, removed: 0, slivers: 0 };
  for (let round = 0; round < 4; round++) {
    const { label, comps } = components(field, isMaterial);
    if (comps.length <= 1) break;
    let main = 0;
    comps.forEach((c, i) => {
      if (c.size > comps[main]!.size) main = i;
    });

    // multi-source BFS from the main piece, remembering which cell reached each sample
    const steps = new Int32Array(nx * ny).fill(-1);
    const src = new Int32Array(nx * ny);
    const queue = new Int32Array(nx * ny);
    let qh = 0;
    let qt = 0;
    for (let p = 0; p < nx * ny; p++) {
      if (label[p] === main) {
        steps[p] = 0;
        src[p] = p;
        queue[qt++] = p;
      }
    }
    while (qh < qt) {
      const p = queue[qh++]!;
      const i = p % nx;
      const j = (p / nx) | 0;
      const go = (q: number) => {
        if (steps[q]! < 0) {
          steps[q] = steps[p]! + 1;
          src[q] = src[p]!;
          queue[qt++] = q;
        }
      };
      if (i > 0) go(p - 1);
      if (i < nx - 1) go(p + 1);
      if (j > 0) go(p - nx);
      if (j < ny - 1) go(p + nx);
    }

    const best = new Int32Array(comps.length).fill(-1);
    for (let p = 0; p < nx * ny; p++) {
      const l = label[p]!;
      if (l < 0 || l === main) continue;
      if (best[l]! < 0 || steps[p]! < steps[best[l]!]!) best[l] = p;
    }
    const drop = new Uint8Array(comps.length);
    const last = round === 3;
    comps.forEach((c, l) => {
      if (l === main) return;
      if (c.size <= sliverCells) {
        drop[l] = 1;
        report.slivers++;
        return;
      }
      const p = best[l]!;
      const q = src[p]!;
      const ax = ox + (p % nx) * cs;
      const ay = oy + ((p / nx) | 0) * cs;
      const bx = ox + (q % nx) * cs;
      const by = oy + ((q / nx) | 0) * cs;
      if (!last && Math.hypot(bx - ax, by - ay) <= maxBridge) {
        // reach a little into both pieces so the joint is solid
        const len = Math.hypot(bx - ax, by - ay) || 1;
        const ex = ((bx - ax) / len) * cs;
        const ey = ((by - ay) / len) * cs;
        const [sx, sy, tx, ty] = [ax - ex, ay - ey, bx + ex, by + ey];
        field.stamp(Math.min(sx, tx) - bridgeR, Math.min(sy, ty) - bridgeR, Math.max(sx, tx) + bridgeR, Math.max(sy, ty) + bridgeR, (x, y) =>
          sdTaper(x, y, sx, sy, tx, ty, bridgeR, bridgeR),
        );
        report.bridged++;
      } else {
        drop[l] = 1;
        report.removed++;
      }
    });
    for (let p = 0; p < nx * ny; p++) {
      const l = label[p]!;
      if (l >= 0 && drop[l]) data[p] = cs * 0.5;
    }
  }
  return report;
}

/** Fills enclosed openings smaller than `minCells`. Returns how many were filled and how many remain. */
export function fillSpecks(field: Field, minCells: number): { filled: number; openings: number } {
  const { data, cs } = field;
  const { label, comps } = components(field, isCut);
  const fill = comps.map((c) => !c.border && c.size < minCells);
  const filled = fill.filter(Boolean).length;
  if (filled) {
    for (let p = 0; p < data.length; p++) {
      const l = label[p]!;
      if (l >= 0 && fill[l]) data[p] = -cs * 0.5;
    }
  }
  return { filled, openings: comps.filter((c, i) => !c.border && !fill[i]).length };
}

export interface ThinSpot {
  x: number;
  y: number;
  r: number;
}

/**
 * Finds material narrower than `minWidth`: what a morphological opening with
 * a disc of that diameter would remove, ignoring specks around sharp corners
 * (smaller than `minArea`).
 */
export function findThinSpots(field: Field, minWidth: number, minArea: number): ThinSpot[] {
  const { nx, ny, cs, ox, oy, data } = field;
  const half = minWidth / 2 / cs;
  const toCut = distanceTransform(
    Array.from(data, (v) => v >= 0),
    nx,
    ny,
  );
  const core = new Uint8Array(nx * ny);
  for (let p = 0; p < core.length; p++) core[p] = data[p]! < 0 && toCut[p]! >= half ? 1 : 0;
  const toCore = distanceTransform(core, nx, ny);
  const thin = new Float32Array(nx * ny).fill(1);
  for (let p = 0; p < thin.length; p++) if (data[p]! < 0 && toCore[p]! > half + 1) thin[p] = -1;
  const view = { nx, ny, data: thin } as unknown as Field;
  const { label, comps } = components(view, (v) => v < 0);
  const sums = comps.map(() => ({ x: 0, y: 0, n: 0, x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity }));
  for (let p = 0; p < label.length; p++) {
    const l = label[p]!;
    if (l < 0) continue;
    const s = sums[l]!;
    const x = ox + (p % nx) * cs;
    const y = oy + ((p / nx) | 0) * cs;
    s.x += x;
    s.y += y;
    s.n++;
    s.x0 = Math.min(s.x0, x);
    s.x1 = Math.max(s.x1, x);
    s.y0 = Math.min(s.y0, y);
    s.y1 = Math.max(s.y1, y);
  }
  const minCells = minArea / (cs * cs);
  return sums
    .filter((s) => s.n >= minCells)
    .map((s) => ({ x: s.x / s.n, y: s.y / s.n, r: Math.max(s.x1 - s.x0, s.y1 - s.y0) / 2 + cs * 2 }));
}
