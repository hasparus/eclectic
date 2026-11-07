# paw-ornament

Generative laser-cut paw ornaments: snowflakes in the toe pads, a winter forest
with wind swirls and snow drifts in the main pad, a hanging hole on top. Dog and
cat paws. Every seed gives a different design. Exports SVG sized in millimetres.

## How it works

The ornament is one signed distance field (negative = material, positive = cut).
Pads are ellipses, the silhouette is their smooth union grown by the rim width,
and each motif (tapered strokes, polygons, outlines) is stamped into the field
and clipped to its pad, so it always touches the surrounding rim. Before
tracing, the field is cleaned for cutting:

- only the largest connected piece of material is kept, so nothing falls out;
- openings smaller than `minHoleMm2` are filled.

Marching squares then traces closed, non-intersecting loops, which become a
single `fill-rule="evenodd"` path (stencil) or red 0.1 mm hairlines (cut file).

## Use

- `src/generator.js`: `generate(params)` returns loops and stats; `toSVG(result, { mode: "fill" | "cut" })`.
- `node scripts/build.mjs` inlines the generator into `src/app.html` and writes `dist/index.html`.
- `node scripts/render.mjs out seeds=lapka,finn paw=cat` renders sample SVGs and a PNG sheet (needs Playwright).

Parameters: `seed`, `paw` (dog/cat), `toes` (snowflake/filigree/empty),
`scene` (forest/empty), `trees`, `wind`, `waves`, `branches`, `web`, `hole`,
`holeMm`, `widthMm`, `lineMm`, `borderMm`, `ringMm`, `resolution`.
