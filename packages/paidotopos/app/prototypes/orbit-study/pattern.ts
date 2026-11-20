import type { Dot, Settings } from "./types";
export function makePattern({ count, twist, spread }: Settings): Dot[] {
  return Array.from(
    { length: Math.max(0, Math.min(400, Math.floor(count))) },
    (_, i) => {
      const angle = (i * twist * Math.PI) / 180;
      const radius = spread * Math.sqrt(i);
      return {
        x: 400 + Math.cos(angle) * radius,
        y: 400 + Math.sin(angle) * radius,
        r: 2.5 + 3 * (1 - i / count),
        opacity: 0.3 + 0.7 * (1 - i / count),
      };
    },
  );
}
