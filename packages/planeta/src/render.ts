import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import { createCanvas } from "canvas";
import * as d3 from "d3-geo";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import {
  clipSouthPole,
  fetchLand,
  topoSources,
  type Detail,
} from "./lib/land";

const OUTPUT_DIR = join(process.cwd(), "out");

interface CLIOptions {
  detail: Detail;
  width: number;
  includeSouthPole: boolean;
  outfile: string;
}

function parseArgs(): CLIOptions {
  const args = new Map<string, string>();
  process.argv.slice(2).forEach((arg) => {
    const [key, value = "true"] = arg.split("=");
    args.set(key, value);
  });

  const detail = (args.get("--detail") as Detail) ?? "110m";
  if (!topoSources[detail]) {
    throw new Error(`Unsupported detail "${detail}"`);
  }

  const width = Number(args.get("--width") ?? "1024");
  if (!Number.isFinite(width) || width <= 0) {
    throw new Error("--width must be a positive number");
  }

  const includeSouthPole = args.get("--include-south-pole") === "true";
  const outfile = args.get("--out") ?? `render-${detail}.png`;

  return { detail, width, includeSouthPole, outfile };
}

async function main() {
  const { detail, width, includeSouthPole, outfile } = parseArgs();
  const height = Math.round(width / 1.5);
  const land = await fetchLand(detail);
  const clipped = clipSouthPole(land, includeSouthPole);
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");

  context.fillStyle = "white";
  context.fillRect(0, 0, width, height);

  const fitTarget = createBoundsGeometry(clipped, includeSouthPole);
  const projection = d3.geoMercator().fitExtent(
    [
      [0, 0],
      [width, height],
    ],
    fitTarget
  );
  const path = d3.geoPath(
    projection,
    context as unknown as CanvasRenderingContext2D
  );

  context.fillStyle = "black";
  for (const feature of clipped.features) {
    context.beginPath();
    path(feature as Feature);
    context.fill("evenodd");
  }

  const outPath = resolveOutputPath(outfile);
  await fs.mkdir(dirname(outPath), { recursive: true });

  await fs.writeFile(outPath, canvas.toBuffer("image/png"));
  console.log(`Saved ${outPath} (${detail}, south pole: ${includeSouthPole})`);
}

function createBoundsGeometry(
  collection: FeatureCollection,
  includeSouthPole: boolean
) {
  const bounds = {
    minLat: 90,
    maxLat: -90,
    minLon: 180,
    maxLon: -180,
  };

  for (const feature of collection.features) {
    updateBounds(bounds, feature.geometry, includeSouthPole);
  }

  if (bounds.minLat === 90) {
    bounds.minLat = -90;
    bounds.maxLat = 90;
    bounds.minLon = -180;
    bounds.maxLon = 180;
  }

  return {
    type: "Polygon" as const,
    coordinates: [
      [
        [bounds.minLon, bounds.minLat],
        [bounds.maxLon, bounds.minLat],
        [bounds.maxLon, bounds.maxLat],
        [bounds.minLon, bounds.maxLat],
        [bounds.minLon, bounds.minLat],
      ],
    ],
  };
}

function updateBounds(
  bounds: {
    minLat: number;
    maxLat: number;
    minLon: number;
    maxLon: number;
  },
  geometry: Geometry | null,
  includeSouthPole: boolean
) {
  if (!geometry) return;
  switch (geometry.type) {
    case "Polygon":
      geometry.coordinates.forEach((ring) =>
        ring.forEach(([lon, lat]) => accumulate(bounds, lon, lat, includeSouthPole))
      );
      break;
    case "MultiPolygon":
      geometry.coordinates.forEach((polygon) =>
        polygon.forEach((ring) =>
          ring.forEach(([lon, lat]) => accumulate(bounds, lon, lat, includeSouthPole))
        )
      );
      break;
    case "GeometryCollection":
      geometry.geometries.forEach((geom) =>
        updateBounds(bounds, geom, includeSouthPole)
      );
      break;
    default:
      break;
  }
}

function accumulate(
  bounds: {
    minLat: number;
    maxLat: number;
    minLon: number;
    maxLon: number;
  },
  lon: number,
  lat: number,
  includeSouthPole: boolean
) {
  if (!includeSouthPole && lat < ANTARCTIC_LAT) {
    lat = ANTARCTIC_LAT;
  }
  if (lat < bounds.minLat) bounds.minLat = lat;
  if (lat > bounds.maxLat) bounds.maxLat = lat;
  if (lon < bounds.minLon) bounds.minLon = lon;
  if (lon > bounds.maxLon) bounds.maxLon = lon;
}

const ANTARCTIC_LAT = -60;

function resolveOutputPath(outfile: string) {
  const sanitized = outfile.replace(/^(\.\/)+/, "");
  return join(OUTPUT_DIR, sanitized);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
