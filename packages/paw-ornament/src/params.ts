import { clamp } from "./core/math";

export const TOE_MOTIFS = ["snowflake", "vines", "flower", "tree", "heart", "star", "paw", "moon", "open", "solid"] as const;
export const MAIN_MOTIFS = ["forest", "mountains", "name", "snowflake", "heart", "open", "solid"] as const;
export const FONTS = ["Pacifico", "Lobster", "Fredoka"] as const;

export type ToeMotif = (typeof TOE_MOTIFS)[number];
export type MainMotif = (typeof MAIN_MOTIFS)[number];
export type Paw = "dog" | "cat";
export type FontName = (typeof FONTS)[number];

/** Pad order: outer left, inner left, inner right, outer right, main. */
export const PAD_COUNT = 5;
export const MAIN_PAD = 4;

export interface PadConfig<M extends string = string> {
  motif: M;
  /** Bumped to re-roll the pad's design without touching the others. */
  variant: number;
}

export interface SceneOptions {
  /** 0..1 density of trees. */
  trees: number;
  wind: number;
  waves: number;
  branches: boolean;
}

/** Text rasterised by the caller (the generator has no font engine). */
export interface TextMask {
  width: number;
  height: number;
  /** Coverage 0..255, row-major. */
  data: Uint8Array | Uint8ClampedArray | number[];
  /** Baseline, in mask pixels from the top. */
  baseline: number;
  /** Cache key, e.g. text + font. */
  key: string;
}

export interface Params {
  version: 2;
  seed: string;
  paw: Paw;
  toes: [PadConfig<ToeMotif>, PadConfig<ToeMotif>, PadConfig<ToeMotif>, PadConfig<ToeMotif>];
  main: PadConfig<MainMotif>;
  scene: SceneOptions;
  name: { text: string; font: FontName };
  /** Finished width of the ornament in mm. */
  widthMm: number;
  borderMm: number;
  /** Material left between neighbouring pads. */
  ringMm: number;
  /** Width of detail lines (snowflake arms, branches, swirls). */
  lineMm: number;
  hole: boolean;
  holeMm: number;
  /** Teardrop piercings in the material between pads. */
  web: boolean;
  /** Laser kerf; the outline is grown by half of it so parts come out true to size. */
  kerfMm: number;
  /** Openings smaller than this are filled. */
  minHoleMm2: number;
  /** Material narrower than this is reported as a thin spot. */
  minFeatureMm: number;
  /** Samples across the 1000-unit canvas. */
  resolution: number;
}

export const DEFAULTS: Params = Object.freeze({
  version: 2,
  seed: "lapka",
  paw: "dog",
  toes: [
    { motif: "snowflake", variant: 0 },
    { motif: "snowflake", variant: 0 },
    { motif: "snowflake", variant: 0 },
    { motif: "snowflake", variant: 0 },
  ],
  main: { motif: "forest", variant: 0 },
  scene: { trees: 0.6, wind: 2, waves: 3, branches: true },
  name: { text: "Łatka", font: "Pacifico" },
  widthMm: 90,
  borderMm: 3.6,
  ringMm: 1.8,
  lineMm: 0.75,
  hole: true,
  holeMm: 5,
  web: true,
  kerfMm: 0,
  minHoleMm2: 0.6,
  minFeatureMm: 0.5,
  resolution: 1000,
}) as Params;

/** Ranges for numeric options, shared by the generator and the UI. */
export const RANGES = {
  widthMm: [40, 200],
  borderMm: [1.5, 8],
  ringMm: [0.8, 5],
  lineMm: [0.35, 2],
  holeMm: [2, 12],
  kerfMm: [0, 0.5],
  minHoleMm2: [0, 10],
  minFeatureMm: [0.1, 3],
  resolution: [120, 1800],
  trees: [0, 1],
  wind: [0, 4],
  waves: [0, 5],
} as const satisfies Record<string, readonly [number, number]>;

type Loose = { [K in keyof Params]?: unknown } & Record<string, unknown>;

const num = (v: unknown, fallback: number, [lo, hi]: readonly [number, number]) => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? clamp(n, lo, hi) : fallback;
};
const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
const oneOf = <T extends string>(v: unknown, list: readonly T[], fallback: T): T =>
  list.includes(v as T) ? (v as T) : fallback;

function pad<M extends string>(v: unknown, list: readonly M[], fallback: PadConfig<M>): PadConfig<M> {
  // legacy: a bare motif name; "empty" was renamed to "open", "filigree" to "vines"
  const legacy = (m: unknown) => (m === "empty" ? "open" : m === "filigree" ? "vines" : m);
  if (typeof v === "string") return { motif: oneOf(legacy(v), list, fallback.motif), variant: 0 };
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return {
      motif: oneOf(legacy(o.motif), list, fallback.motif),
      variant: Math.max(0, Math.floor(num(o.variant, 0, [0, 1e9]))),
    };
  }
  return { ...fallback };
}

/**
 * Accepts anything (stored settings, URL data, older versions) and returns a
 * complete, clamped Params. Never throws.
 */
export function normalizeParams(input: unknown = {}): Params {
  const o = (input && typeof input === "object" ? input : {}) as Loose;
  const d = DEFAULTS;
  const rawToes = o.toes;
  const toes = (
    Array.isArray(rawToes)
      ? d.toes.map((t, i) => pad(rawToes[i], TOE_MOTIFS, t))
      : d.toes.map((t) => pad(rawToes ?? t, TOE_MOTIFS, t))
  ) as Params["toes"];
  // v1 kept the main pad in `scene: "forest" | "empty"` and its options at the top level
  const sceneIn = (o.scene && typeof o.scene === "object" ? o.scene : o) as Record<string, unknown>;
  const mainIn = o.main ?? (typeof o.scene === "string" ? o.scene : undefined);
  const nameIn = (o.name && typeof o.name === "object" ? o.name : {}) as Record<string, unknown>;
  const text = typeof nameIn.text === "string" ? nameIn.text.slice(0, 24) : d.name.text;
  return {
    version: 2,
    seed: typeof o.seed === "string" && o.seed.trim() ? o.seed.trim().slice(0, 64) : typeof o.seed === "number" ? String(o.seed) : d.seed,
    paw: oneOf(o.paw, ["dog", "cat"] as const, d.paw),
    toes,
    main: pad(mainIn, MAIN_MOTIFS, d.main),
    scene: {
      trees: num(sceneIn.trees, d.scene.trees, RANGES.trees),
      wind: Math.round(num(sceneIn.wind, d.scene.wind, RANGES.wind)),
      waves: Math.round(num(sceneIn.waves, d.scene.waves, RANGES.waves)),
      branches: bool(sceneIn.branches, d.scene.branches),
    },
    name: { text, font: oneOf(nameIn.font, FONTS, d.name.font) },
    widthMm: num(o.widthMm, d.widthMm, RANGES.widthMm),
    borderMm: num(o.borderMm, d.borderMm, RANGES.borderMm),
    ringMm: num(o.ringMm, d.ringMm, RANGES.ringMm),
    lineMm: num(o.lineMm, d.lineMm, RANGES.lineMm),
    hole: bool(o.hole, d.hole),
    holeMm: num(o.holeMm, d.holeMm, RANGES.holeMm),
    web: bool(o.web, d.web),
    kerfMm: num(o.kerfMm, d.kerfMm, RANGES.kerfMm),
    minHoleMm2: num(o.minHoleMm2, d.minHoleMm2, RANGES.minHoleMm2),
    minFeatureMm: num(o.minFeatureMm, d.minFeatureMm, RANGES.minFeatureMm),
    resolution: Math.round(num(o.resolution, d.resolution, RANGES.resolution)),
  };
}
