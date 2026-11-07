# paw-ornament

Generative laser-cut paw ornaments. A dog or cat paw with a hanging hole, where
each of the five pads carries its own pattern, exported as true-size SVG, PDF
or PNG. Every design comes out as one connected piece, so nothing falls out of
the sheet.

| Pad | Patterns |
| --- | --- |
| Toes (each one separately) | snowflake, vines, flower, tree, heart, star, paw, moon, open, solid |
| Main pad | winter forest, mountains, name, snowflake, heart, open, solid |

## How it works

The ornament is a single signed distance field (negative = material) sampled
on a grid:

1. **Layout** (`src/layout.ts`): pads are ellipses (the main pad a smooth union
   of several); toes shrink until each keeps one bridge width from its
   neighbours. The silhouette is their smooth union grown by the rim width.
   The world-to-millimetre scale is settled on the measured width, so the
   finished size is exact.
2. **Motifs** (`src/motifs/`): each pad gets its own seeded RNG
   (`seed|toeN|motif|variant`), so re-rolling one pad leaves the rest alone.
   A motif returns material (stamped and clipped to the pad, so it joins the
   rim), openings to cut, and whether the pad stays solid. Solid pads get a
   groove held by a few tabs so the paw keeps its shape.
3. **Cleanup** (`src/core/cleanup.ts`): loose islands near the main piece are
   joined with a bridge along the shortest path (the dot over "Ż" in a name,
   for example) and far or tiny ones are dropped; openings below
   `minHoleMm2` are filled; an optional morphological check flags material
   thinner than `minFeatureMm`. Kerf compensation grows the outline by half
   the kerf.
4. **Tracing** (`src/core/trace.ts`): oriented marching squares into closed,
   non-intersecting loops, simplified with Douglas-Peucker.

Exports (`src/export/files.ts`): a stencil SVG (one even-odd path, user units
in mm), a cut file (red 0.1 mm hairlines), and a vector PDF at 1:1.

## Library

```ts
import { generate, toSVG, toPDF } from "paw-ornament";

const r = generate({
  seed: "finn",
  paw: "cat",
  toes: ["heart", "snowflake", { motif: "star", variant: 2 }, "moon"],
  main: "mountains",
  widthMm: 80,
  kerfMm: 0.15,
}, { checkThin: true });

r.stats; // { widthMm, heightMm, cutLengthMm, openings, bridgesAdded, thinSpots, ... }
const svg = toSVG(r, { mode: "cut" });
```

`normalizeParams` accepts anything (including settings saved by version 1)
and returns complete, clamped parameters. The "name" scene needs a
`textMask` option, a rasterised coverage mask of the text; the web UI builds
it with a canvas (`src/ui/text.ts`).

## Web app

`src/ui/app.ts` with `src/app.html`: click a pad on the preview or the pad
picker, then pick its pattern from a palette of live previews of that pad.
Generation runs in a Web Worker (`src/ui/engine.ts`) with one queue slot per
channel, so slider drags never pile up; a quick draft renders first, then the
full-resolution pass with the thin-spot check. Undo/redo (Ctrl+Z,
Ctrl+Shift+Z), Polish and English, light and dark themes, settings remembered
in local storage.

## Scripts

- `bun run build`: bundles the worker and app into `dist/index.html` (standalone)
  and `dist/paw-ornament.html` (artifact body).
- `bun run lint`: `tsc` in strict mode.
- `bun test`: invariants (one piece for every motif on both paws, determinism,
  exact width, kerf, bridges), export validity (SVG sizing, PDF xref) and core
  algorithms (distance transform against brute force, tracing, cleanup).
- `bun scripts/render.ts out [preset=toes|classic|all] [key=value ...]`: writes
  sample SVGs and, if Playwright is installed, a PNG contact sheet.
