import { feature as topoFeature } from "topojson-client";
import * as d3 from "d3-geo";
import type {
  Feature,
  FeatureCollection,
  Geometry,
  GeometryCollection,
  MultiPolygon,
  Polygon,
  Position,
} from "geojson";

export type Detail = "110m" | "50m";

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
  return normalizeFeatureCollection(geojson);
}

export function clipSouthPole(
  collection: FeatureCollection,
  includeSouthPole: boolean
): FeatureCollection {
  if (includeSouthPole) {
    return collection;
  }

  return {
    type: "FeatureCollection",
    features: collection.features.filter((feature) => {
      const bounds = d3.geoBounds(feature as Feature);
      return bounds[1][1] > ANTARCTIC_LAT;
    }),
  };
}

function normalizeFeatureCollection(geojson: LandFeatureLike): FeatureCollection {
  if (!geojson) {
    return { type: "FeatureCollection", features: [] };
  }

  if (geojson.type === "FeatureCollection") {
    return {
      type: "FeatureCollection",
      features: geojson.features.flatMap(splitFeature),
    };
  }

  if (geojson.type === "Feature") {
    return {
      type: "FeatureCollection",
      features: splitFeature(geojson),
    };
  }

  throw new Error("Unsupported GeoJSON payload");
}

function splitFeature(feature: Feature): Feature[] {
  const geometry = feature.geometry;
  if (!geometry) return [];

  switch (geometry.type) {
    case "Polygon":
      return [clonePolygonFeature(feature.properties, geometry.coordinates)];
    case "MultiPolygon":
      return geometry.coordinates.map((polygon) =>
        clonePolygonFeature(feature.properties, polygon)
      );
    case "GeometryCollection":
      return geometry.geometries.flatMap((geom) =>
        splitFeature({
          type: "Feature",
          properties: feature.properties,
          geometry: geom,
        })
      );
    default:
      return [];
  }
}

function clonePolygonFeature(
  properties: Feature["properties"],
  polygon: Polygon["coordinates"]
): Feature<Polygon> {
  return {
    type: "Feature",
    properties,
    geometry: {
      type: "Polygon",
      coordinates: clonePolygon(polygon),
    },
  };
}

function clonePolygon(polygon: Polygon["coordinates"]) {
  return polygon.map((ring) => ring.map(([lon, lat]) => [lon, lat] as Position));
}
