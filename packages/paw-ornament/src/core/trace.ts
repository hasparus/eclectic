import type { Field } from "./field";
import type { Vec } from "./math";

// Marching squares with every segment oriented so material is on the same
// side; each edge crossing then has exactly one successor and loops chain.
// Saddles keep material corners apart, which matches 4-connected labelling.

type Edge = "T" | "R" | "B" | "L";
const CORNERS: [number, number, number][] = [
  [0, 0, 8],
  [1, 0, 4],
  [1, 1, 2],
  [0, 1, 1],
];
const EDGE_MID: Record<Edge, Vec> = { T: [0.5, 0], R: [1, 0.5], B: [0.5, 1], L: [0, 0.5] };
const CASES: Record<number, [Edge, Edge][]> = {
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

const TABLE: [Edge, Edge][][] = Array.from({ length: 16 }, (_, c) =>
  (CASES[c] ?? []).map(([ea, eb]): [Edge, Edge] => {
    const a = EDGE_MID[ea];
    const b = EDGE_MID[eb];
    const mx = (a[0] + b[0]) / 2;
    const my = (a[1] + b[1]) / 2;
    let best: Vec = [0, 0];
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
  }),
);

/** Traces the zero level set into closed loops (world coordinates). */
export function traceContours(field: Field): Vec[][] {
  const { nx, ny, cs, ox, oy, data } = field;
  const next = new Int32Array(nx * ny * 2).fill(-1);
  const edgeId = (e: Edge, i: number, j: number): number => {
    switch (e) {
      case "T":
        return 2 * (j * nx + i);
      case "B":
        return 2 * ((j + 1) * nx + i);
      case "L":
        return 2 * (j * nx + i) + 1;
      default:
        return 2 * (j * nx + i + 1) + 1;
    }
  };
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const p = j * nx + i;
      const c =
        (data[p]! < 0 ? 8 : 0) | (data[p + 1]! < 0 ? 4 : 0) | (data[p + nx + 1]! < 0 ? 2 : 0) | (data[p + nx]! < 0 ? 1 : 0);
      if (c === 0 || c === 15) continue;
      for (const [ea, eb] of TABLE[c]!) next[edgeId(ea, i, j)] = edgeId(eb, i, j);
    }
  }
  const pos = (id: number): Vec => {
    const p = id >> 1;
    const i = p % nx;
    const j = (p / nx) | 0;
    const v0 = data[p]!;
    if (id & 1) {
      const t = v0 / (v0 - data[p + nx]!);
      return [ox + i * cs, oy + (j + t) * cs];
    }
    const t = v0 / (v0 - data[p + 1]!);
    return [ox + (i + t) * cs, oy + j * cs];
  };
  const loops: Vec[][] = [];
  for (let s = 0; s < next.length; s++) {
    if (next[s]! < 0) continue;
    const loop: Vec[] = [];
    let e = s;
    while (e >= 0 && next[e]! >= 0) {
      loop.push(pos(e));
      const nxt = next[e]!;
      next[e] = -1;
      e = nxt;
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

function rdp(pts: Vec[], eps: number): Vec[] {
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    const [ax, ay] = pts[s]!;
    const [bx, by] = pts[e]!;
    const dx = bx - ax;
    const dy = by - ay;
    const l = Math.hypot(dx, dy) || 1;
    let md = 0;
    let mi = -1;
    for (let i = s + 1; i < e; i++) {
      const dd = Math.abs((pts[i]![0] - ax) * dy - (pts[i]![1] - ay) * dx) / l;
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

/** Douglas-Peucker on a closed loop. */
export function simplifyLoop(pts: Vec[], eps: number): Vec[] {
  if (pts.length < 8) return pts;
  let far = 0;
  let fd = 0;
  for (let i = 1; i < pts.length; i++) {
    const dd = (pts[i]![0] - pts[0]![0]) ** 2 + (pts[i]![1] - pts[0]![1]) ** 2;
    if (dd > fd) {
      fd = dd;
      far = i;
    }
  }
  const a = rdp(pts.slice(0, far + 1), eps);
  const b = rdp([...pts.slice(far), pts[0]!], eps);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

/** Signed area (positive = clockwise in y-down screen space). */
export function loopArea(pts: readonly Vec[]): number {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i, i++) a += (pts[j]![0] - pts[i]![0]) * (pts[j]![1] + pts[i]![1]);
  return a / 2;
}
