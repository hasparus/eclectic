/**
 * Exact Euclidean distance transform (Felzenszwalb & Huttenlocher).
 * `seed[i]` true marks source cells. Returns, for every cell, the distance
 * in cells to the nearest source cell (Infinity when there are none).
 */
export function distanceTransform(seed: ArrayLike<boolean | number>, nx: number, ny: number): Float32Array {
  const INF = 1e20;
  const f = new Float64Array(nx * ny);
  for (let i = 0; i < f.length; i++) f[i] = seed[i] ? 0 : INF;
  const n = Math.max(nx, ny);
  const line = new Float64Array(n);
  const out = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);

  const pass = (len: number) => {
    let k = 0;
    v[0] = 0;
    z[0] = -INF;
    z[1] = INF;
    for (let q = 1; q < len; q++) {
      let s = (line[q]! + q * q - (line[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
      while (s <= z[k]!) {
        k--;
        s = (line[q]! + q * q - (line[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < len; q++) {
      while (z[k + 1]! < q) k++;
      out[q] = (q - v[k]!) ** 2 + line[v[k]!]!;
    }
  };

  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) line[j] = f[j * nx + i]!;
    pass(ny);
    for (let j = 0; j < ny; j++) f[j * nx + i] = out[j]!;
  }
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) line[i] = f[j * nx + i]!;
    pass(nx);
    for (let i = 0; i < nx; i++) f[j * nx + i] = out[i]!;
  }
  const res = new Float32Array(nx * ny);
  for (let i = 0; i < res.length; i++) res[i] = f[i]! >= INF / 2 ? Infinity : Math.sqrt(f[i]!);
  return res;
}
