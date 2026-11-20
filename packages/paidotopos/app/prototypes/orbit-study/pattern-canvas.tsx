import { makePattern } from "./pattern";
import type { Settings } from "./types";
export function PatternCanvas({ settings }: { settings: Settings }) {
  return (
    <div className="aspect-square max-h-[65svh] w-full overflow-hidden rounded-xl border bg-card">
      <svg
        role="img"
        aria-label="A spiral of particles arranged using the rotation and spacing parameters"
        viewBox="0 0 800 800"
        className="h-full w-full text-primary"
      >
        {makePattern(settings).map((dot, i) => (
          <circle
            key={i}
            cx={dot.x}
            cy={dot.y}
            r={dot.r}
            opacity={dot.opacity}
            fill="currentColor"
          />
        ))}
      </svg>
    </div>
  );
}
