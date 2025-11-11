import GUI from "lil-gui";
import * as d3 from "d3-geo";
import type { FeatureCollection } from "geojson";
import {
  clipSouthPole,
  fetchLand,
  type Detail,
} from "./lib/land";

const canvas = document.getElementById("map") as HTMLCanvasElement;
const ctx = canvas.getContext("2d");
const loadingIndicator = document.getElementById("loading");

if (!canvas || !ctx || !loadingIndicator) {
  throw new Error("Missing required DOM elements");
}

const aspectRatio = 1.5;

const settings = {
  width: 1024,
  detail: "110m" as Detail,
  includeSouthPole: false,
  download() {
    const height = Math.round(settings.width / aspectRatio);
    const link = document.createElement("a");
    link.download = `mercator-${settings.detail}-${settings.width}x${height}.png`;
    link.href = canvas.toDataURL();
    link.click();
  },
};

const gui = new GUI();

gui
  .add(settings, "width", 256, 4096, 1)
  .name("Width")
  .onFinishChange(() => draw());

gui
  .add(settings, "detail", ["110m", "50m", "10m"])
  .name("Map Detail")
  .onChange(() => load());

gui
  .add(settings, "includeSouthPole")
  .name("Include South Pole")
  .onChange(() => draw());

gui.add(settings, "download").name("Download PNG");

const landCache = new Map<Detail, FeatureCollection>();
let land: FeatureCollection | null = null;
let loadToken = 0;

function showLoading(message = "Loading map...") {
  loadingIndicator.textContent = message;
  loadingIndicator.removeAttribute("hidden");
}

function hideLoading() {
  loadingIndicator.setAttribute("hidden", "hidden");
}

async function load() {
  const detail = settings.detail;
  const currentToken = ++loadToken;

  if (!landCache.has(detail)) {
    showLoading();
  }

  if (landCache.has(detail)) {
    land = landCache.get(detail)!;
    draw();
    return;
  }

  try {
    const featureCollection = await fetchLand(detail);
    if (currentToken !== loadToken) return;
    landCache.set(detail, featureCollection);
    land = featureCollection;
    draw();
  } catch (error) {
    if (currentToken !== loadToken) return;
    console.error(error);
    showLoading("Failed to load map data");
  }
}

function draw() {
  if (!land) return;

  canvas.width = settings.width;
  canvas.height = Math.round(settings.width / aspectRatio);

  drawMercator(land);
  hideLoading();
}

function drawMercator(source: FeatureCollection) {
  const clippedLand = clipSouthPole(source, settings.includeSouthPole);
  const fitTarget = createBoundsGeometry(clippedLand);

  const projection = d3.geoMercator().fitExtent(
    [
      [0, 0],
      [canvas.width, canvas.height],
    ],
    fitTarget
  );
  const path = d3.geoPath(projection, ctx);

  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "black";
  for (const feature of clippedLand.features) {
    ctx.beginPath();
    path(feature);
    ctx.fill("evenodd");
  }
}

function createBoundsGeometry(collection: FeatureCollection) {
  const bounds = {
    minLat: 90,
    maxLat: -90,
    minLon: 180,
    maxLon: -180,
  };

  for (const feature of collection.features) {
    updateBounds(bounds, feature.geometry);
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
  geometry: FeatureCollection["features"][number]["geometry"]
) {
  if (!geometry) return;
  switch (geometry.type) {
    case "Polygon":
      geometry.coordinates.forEach((ring) =>
        ring.forEach(([lon, lat]) => accumulate(bounds, lon, lat))
      );
      break;
    case "MultiPolygon":
      geometry.coordinates.forEach((polygon) =>
        polygon.forEach((ring) =>
          ring.forEach(([lon, lat]) => accumulate(bounds, lon, lat))
        )
      );
      break;
    case "GeometryCollection":
      geometry.geometries.forEach((geom) => updateBounds(bounds, geom as any));
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
  lat: number
) {
  if (lat < bounds.minLat) bounds.minLat = lat;
  if (lat > bounds.maxLat) bounds.maxLat = lat;
  if (lon < bounds.minLon) bounds.minLon = lon;
  if (lon > bounds.maxLon) bounds.maxLon = lon;
}

load();
