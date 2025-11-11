import { feature as topoFeature } from "topojson-client";
import type {
  Feature,
  FeatureCollection,
  Geometry,
  GeometryCollection,
  MultiPolygon,
  Polygon,
  Position,
} from "geojson";

export type Detail = "110m" | "50m" | "10m";

type LandFeatureLike = FeatureCollection | Feature | null | undefined;
type TopoSource = { url: string; object: string };

const ANTARCTIC_LAT = -60;

export const topoSources: Record<Detail, TopoSource> = {
  "110m": {
    url: "https://cdn.jsdelivr.net/npm/world-atlas@2/land-110m.json",
    object: "land",
  },
  "50m": {
    url: "https://cdn.jsdelivr.net/npm/world-atlas@2/land-50m.json",
    object: "land",
  },
  "10m": {
    url: "https://cdn.jsdelivr.net/npm/world-atlas@2/land-10m.json",
    object: "land",
  },
};

export async function fetchLand(detail: Detail): Promise<FeatureCollection> {
  const { url, object } = topoSources[detail];
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${detail} dataset (${response.status})`);
  }
  const topo = await response.json();
  const topoObject = topo.objects[object];
  if (!topoObject) {
    throw new Error(`TopoJSON object "${object}" missing in ${detail}`);
  }
  const geojson = topoFeature(topo, topoObject) as LandFeatureLike;
  return rewindFeatureCollection(toFeatureCollection(geojson));
}

export function clipSouthPole(
  collection: FeatureCollection,
  includeSouthPole: boolean
): FeatureCollection {
  if (includeSouthPole) {
    return cloneFeatureCollection(collection);
  }

  const features: Feature[] = [];
  for (const feature of collection.features) {
    const geometry = clipGeometry(feature.geometry, ANTARCTIC_LAT);
    if (!geometry) continue;
    features.push({
      type: "Feature",
      properties: feature.properties ? { ...feature.properties } : undefined,
      geometry: rewindGeometry(geometry),
    });
  }

  return { type: "FeatureCollection", features };
}

function clipGeometry(
  geometry: Geometry | null,
  minLatitude: number
): Geometry | null {
  if (!geometry) return null;
  switch (geometry.type) {
    case "Polygon": {
      const coordinates = clipPolygon(geometry.coordinates, minLatitude);
      return coordinates.length ? { type: "Polygon", coordinates } : null;
    }
    case "MultiPolygon": {
      const coordinates = geometry.coordinates
        .map((polygon) => clipPolygon(polygon, minLatitude))
        .filter((polygon) => polygon.length);
      return coordinates.length
        ? { type: "MultiPolygon", coordinates }
        : null;
    }
    case "GeometryCollection": {
      const geometries = geometry.geometries
        .map((geom) => clipGeometry(geom, minLatitude))
        .filter((geom): geom is Geometry => Boolean(geom));
      return geometries.length
        ? { type: "GeometryCollection", geometries }
        : null;
    }
    default:
      return cloneGeometry(geometry);
  }
}

function clipPolygon(
  polygon: Polygon["coordinates"],
  minLatitude: number
): Polygon["coordinates"] {
  const result: Polygon["coordinates"] = [];
  for (const ring of polygon) {
    const clipped = clipRing(ring, minLatitude);
    if (clipped && clipped.length >= 4) {
      result.push(clipped);
    }
  }
  return result;
}

function clipRing(ring: Position[], minLatitude: number): Position[] | null {
  if (!ring.length) return null;
  const points = ring.slice();
  if (!points.length) return null;
  const firstPoint = points[0];
  const lastPoint = points[points.length - 1];
  if (firstPoint[0] !== lastPoint[0] || firstPoint[1] !== lastPoint[1]) {
    points.push(firstPoint);
  }
  const output: Position[] = [];

  for (let i = 0; i < points.length - 1; i++) {
    const current = points[i];
    const next = points[i + 1];
    const currentInside = current[1] >= minLatitude;
    const nextInside = next[1] >= minLatitude;

    if (currentInside && nextInside) {
      output.push([...next]);
    } else if (currentInside && !nextInside) {
      output.push(interpolateLat(current, next, minLatitude));
    } else if (!currentInside && nextInside) {
      output.push(interpolateLat(current, next, minLatitude));
      output.push([...next]);
    }
  }

  if (!output.length) return null;
  const first = output[0];
  const last = output[output.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    output.push([...first]);
  }
  return output;
}

function interpolateLat(a: Position, b: Position, lat: number): Position {
  const deltaLat = b[1] - a[1];
  if (deltaLat === 0) {
    return [b[0], lat];
  }
  const t = (lat - a[1]) / deltaLat;
  return [a[0] + t * (b[0] - a[0]), lat];
}

function toFeatureCollection(geojson: LandFeatureLike): FeatureCollection {
  if (!geojson) {
    return { type: "FeatureCollection", features: [] };
  }

  if (geojson.type === "FeatureCollection") {
    return cloneFeatureCollection(geojson);
  }

  if (geojson.type === "Feature") {
    return cloneFeatureCollection({ type: "FeatureCollection", features: [geojson] });
  }

  throw new Error("Unsupported GeoJSON payload");
}

function cloneFeatureCollection(collection: FeatureCollection): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: collection.features.map(cloneFeature),
  };
}

function cloneFeature(feature: Feature): Feature {
  return {
    type: "Feature",
    properties: feature.properties ? { ...feature.properties } : undefined,
    geometry: feature.geometry ? cloneGeometry(feature.geometry) : null,
  };
}

function cloneGeometry(geometry: Geometry): Geometry {
  switch (geometry.type) {
    case "Polygon":
      return {
        type: "Polygon",
        coordinates: geometry.coordinates.map(cloneRing),
      } satisfies Polygon;
    case "MultiPolygon":
      return {
        type: "MultiPolygon",
        coordinates: geometry.coordinates.map((polygon) => polygon.map(cloneRing)),
      } satisfies MultiPolygon;
    case "GeometryCollection":
      return {
        type: "GeometryCollection",
        geometries: geometry.geometries.map((g) => cloneGeometry(g)),
      } satisfies GeometryCollection;
    default:
      return JSON.parse(JSON.stringify(geometry)) as Geometry;
  }
}

function cloneRing(ring: Position[]): Position[] {
  return ring.map(([lon, lat]) => [lon, lat]);
}

function rewindFeatureCollection(collection: FeatureCollection): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: collection.features.map((feature) => ({
      type: "Feature",
      properties: feature.properties,
      geometry: rewindGeometry(feature.geometry),
    })),
  };
}

function rewindGeometry(geometry: Geometry | null): Geometry | null {
  if (!geometry) return null;
  switch (geometry.type) {
    case "Polygon":
      return {
        type: "Polygon",
        coordinates: rewindPolygon(geometry.coordinates),
      } satisfies Polygon;
    case "MultiPolygon":
      return {
        type: "MultiPolygon",
        coordinates: geometry.coordinates.map(rewindPolygon),
      } satisfies MultiPolygon;
    case "GeometryCollection":
      return {
        type: "GeometryCollection",
        geometries: geometry.geometries.map((g) => rewindGeometry(g)).filter(
          (g): g is Geometry => Boolean(g)
        ),
      } satisfies GeometryCollection;
    default:
      return geometry;
  }
}

function rewindPolygon(polygon: Polygon["coordinates"]) {
  const cloned = polygon.map(cloneRing);
  if (!cloned.length) return cloned;
  if (ringArea(cloned[0]) < 0) {
    cloned[0].reverse();
  }
  for (let i = 1; i < cloned.length; i++) {
    if (ringArea(cloned[i]) > 0) {
      cloned[i].reverse();
    }
  }
  return cloned;
}

function ringArea(ring: Position[]) {
  let sum = 0;
  for (let i = 0, len = ring.length, j = len - 1; i < len; j = i++) {
    const [x0, y0] = ring[j];
    const [x1, y1] = ring[i];
    sum += x0 * y1 - x1 * y0;
  }
  return sum / 2;
}
