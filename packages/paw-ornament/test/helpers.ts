import type { Vec } from "../src/core/math";
import { loopArea } from "../src/core/trace";
import type { Result } from "../src/index";

/** Number of separate pieces of material: loops wound like the outermost one. */
export function pieces(r: Result): number {
  const areas = r.loops.map(loopArea);
  let outer = 0;
  areas.forEach((a, i) => {
    if (Math.abs(a) > Math.abs(areas[outer]!)) outer = i;
  });
  const sign = Math.sign(areas[outer]!);
  return areas.filter((a) => Math.sign(a) === sign).length;
}

/** Net material area in mm². */
export function materialArea(r: Result): number {
  const areas = r.loops.map(loopArea);
  return Math.abs(areas.reduce((s, a) => s + a, 0)) / r.unitsPerMm ** 2;
}

export const allPoints = (r: Result): Vec[] => r.loops.flat();
