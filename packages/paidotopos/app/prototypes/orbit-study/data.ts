import type { Settings } from "./types";
import type { Control } from "@/components/control-panel";
export const defaults: Settings = { count: 180, twist: 137.5, spread: 14 };
export const controls: Control<Settings>[] = [
  { key: "count", label: "Particles", min: 20, max: 400, step: 1 },
  { key: "twist", label: "Rotation", min: 120, max: 150, step: 0.1 },
  { key: "spread", label: "Spacing", min: 5, max: 18, step: 1 },
];
