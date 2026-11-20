import { test, expect } from "bun:test";
import { makePattern } from "./pattern";
test("geometry stays finite and bounded at control extremes", () => {
  for (const count of [20, 400])
    for (const twist of [120, 150])
      for (const spread of [5, 18]) {
        const points = makePattern({ count, twist, spread });
        expect(points).toHaveLength(count);
        expect(
          points.every(
            (p) =>
              Number.isFinite(p.x) &&
              Number.isFinite(p.y) &&
              p.x > 0 &&
              p.x < 800 &&
              p.y > 0 &&
              p.y < 800,
          ),
        ).toBe(true);
      }
});
