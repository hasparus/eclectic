import { clamp, type Vec } from "./math";
import { sdPolygon, sdTaper, type Sdf } from "./sdf";

/**
 * A sampled signed distance field on a regular grid. Sample (i, j) sits at
 * world position (ox + i * cs, oy + j * cs). Negative = material.
 */
export class Field {
  readonly data: Float32Array;
  constructor(
    readonly nx: number,
    readonly ny: number,
    readonly cs: number,
    readonly ox = 0,
    readonly oy = 0,
    fill = 1e9,
  ) {
    this.data = new Float32Array(nx * ny).fill(fill);
  }

  /** Grid over a world-space window, `n` samples across its longer side. */
  static over(x0: number, y0: number, x1: number, y1: number, n: number): Field {
    const cs = Math.max(x1 - x0, y1 - y0) / (n - 1);
    return new Field(Math.ceil((x1 - x0) / cs) + 1, Math.ceil((y1 - y0) / cs) + 1, cs, x0, y0);
  }

  like(fill = 1e9): Field {
    return new Field(this.nx, this.ny, this.cs, this.ox, this.oy, fill);
  }

  /** Writes min(field, max(sdf, clip)) over the world-space box (padded by two cells). */
  stamp(x0: number, y0: number, x1: number, y1: number, sdf: Sdf, clip?: Sdf): void {
    const { nx, ny, cs, ox, oy, data } = this;
    const pad = cs * 2;
    const i0 = clamp(Math.floor((x0 - pad - ox) / cs), 0, nx - 1);
    const i1 = clamp(Math.ceil((x1 + pad - ox) / cs), 0, nx - 1);
    const j0 = clamp(Math.floor((y0 - pad - oy) / cs), 0, ny - 1);
    const j1 = clamp(Math.ceil((y1 + pad - oy) / cs), 0, ny - 1);
    if (x1 + pad < ox || y1 + pad < oy || x0 - pad > ox + (nx - 1) * cs || y0 - pad > oy + (ny - 1) * cs) return;
    for (let j = j0; j <= j1; j++) {
      const y = oy + j * cs;
      let idx = j * nx + i0;
      for (let i = i0; i <= i1; i++, idx++) {
        const x = ox + i * cs;
        let d = sdf(x, y);
        if (d >= data[idx]!) continue;
        if (clip) d = Math.max(d, clip(x, y));
        if (d < data[idx]!) data[idx] = d;
      }
    }
  }

  /** Evaluates `f(x, y, current)` for every sample and stores the result. */
  map(f: (x: number, y: number, v: number) => number): void {
    const { nx, ny, cs, ox, oy, data } = this;
    for (let j = 0; j < ny; j++) {
      const y = oy + j * cs;
      for (let i = 0, idx = j * nx; i < nx; i++, idx++) data[idx] = f(ox + i * cs, y, data[idx]!);
    }
  }

  /** Nearest-sample lookup; outside the grid returns +Infinity. */
  at(x: number, y: number): number {
    const i = Math.round((x - this.ox) / this.cs);
    const j = Math.round((y - this.oy) / this.cs);
    if (i < 0 || j < 0 || i >= this.nx || j >= this.ny) return Infinity;
    return this.data[j * this.nx + i]!;
  }

  readonly lookup: Sdf = (x, y) => this.at(x, y);
}

type Item =
  | { t: "seg"; a: Vec; b: Vec; ra: number; rb: number }
  | { t: "poly"; v: number[]; round: number }
  | { t: "outline"; v: number[]; r: number }
  | { t: "fn"; x0: number; y0: number; x1: number; y1: number; f: Sdf };

/**
 * A list of primitives in world units. Stamped into a field as a union,
 * with an optional clip shared by the whole drawing.
 */
export class Drawing {
  readonly items: Item[] = [];

  /** Polyline whose radius tapers from r0 to r1 along its length. */
  stroke(pts: readonly Vec[], r0: number, r1 = r0): this {
    if (pts.length < 2) return this;
    const acc = [0];
    let total = 0;
    for (let i = 1; i < pts.length; i++) {
      total += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]);
      acc.push(total);
    }
    for (let i = 1; i < pts.length; i++) {
      const ra = r0 + (r1 - r0) * (total ? acc[i - 1]! / total : 0);
      const rb = r0 + (r1 - r0) * (total ? acc[i]! / total : 0);
      this.items.push({ t: "seg", a: pts[i - 1]!, b: pts[i]!, ra, rb });
    }
    return this;
  }
  line(a: Vec, b: Vec, r: number): this {
    this.items.push({ t: "seg", a, b, ra: r, rb: r });
    return this;
  }
  circle(c: Vec, r: number): this {
    this.items.push({ t: "seg", a: c, b: c, ra: r, rb: r });
    return this;
  }
  /** Filled polygon, optionally grown by `round` (rounds its corners). */
  poly(pts: readonly Vec[], round = 0): this {
    this.items.push({ t: "poly", v: pts.flat(), round });
    return this;
  }
  /** Closed polygon outline of half-width r. */
  outline(pts: readonly Vec[], r: number): this {
    this.items.push({ t: "outline", v: pts.flat(), r });
    return this;
  }
  /** Any SDF, evaluated only inside the given box. */
  fn(x0: number, y0: number, x1: number, y1: number, f: Sdf): this {
    this.items.push({ t: "fn", x0, y0, x1, y1, f });
    return this;
  }
  add(other: Drawing): this {
    this.items.push(...other.items);
    return this;
  }
  get empty(): boolean {
    return this.items.length === 0;
  }

  stampInto(field: Field, clip?: Sdf): void {
    for (const it of this.items) {
      if (it.t === "seg") {
        const { a, b, ra, rb } = it;
        const r = Math.max(ra, rb);
        const [ax, ay] = a;
        const [bx, by] = b;
        field.stamp(
          Math.min(ax, bx) - r,
          Math.min(ay, by) - r,
          Math.max(ax, bx) + r,
          Math.max(ay, by) + r,
          (x, y) => sdTaper(x, y, ax, ay, bx, by, ra, rb),
          clip,
        );
      } else if (it.t === "fn") {
        field.stamp(it.x0, it.y0, it.x1, it.y1, it.f, clip);
      } else {
        const v = it.v;
        let x0 = Infinity;
        let y0 = Infinity;
        let x1 = -Infinity;
        let y1 = -Infinity;
        for (let i = 0; i < v.length; i += 2) {
          x0 = Math.min(x0, v[i]!);
          x1 = Math.max(x1, v[i]!);
          y0 = Math.min(y0, v[i + 1]!);
          y1 = Math.max(y1, v[i + 1]!);
        }
        if (it.t === "outline") {
          const r = it.r;
          field.stamp(x0 - r, y0 - r, x1 + r, y1 + r, (x, y) => Math.abs(sdPolygon(x, y, v)) - r, clip);
        } else {
          const r = it.round;
          field.stamp(x0 - r, y0 - r, x1 + r, y1 + r, (x, y) => sdPolygon(x, y, v) - r, clip);
        }
      }
    }
  }
}
