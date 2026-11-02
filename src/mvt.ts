import MVT from "ol/format/MVT.js";
import Feature from "ol/Feature.js";
import MultiPolygon from "ol/geom/MultiPolygon.js";
import type Polygon from "ol/geom/Polygon.js";
import { createXYZ } from "ol/tilegrid.js";
import { transformExtent } from "ol/proj.js";
import polygonClipping from "polygon-clipping";
import type { BuildingProvider } from "./providers.js";

export interface MVTProviderOptions {
  url: string;
  attribution: string;
  layers?: string[];
  /** Stable building ID property, shared across tiles. Native MVT IDs are used otherwise. */
  idProperty?: string;
  zoom?: number;
  maxTiles?: number;
}
/** Join pieces of the same building before extrusion, removing interior tile-edge walls. */
export function mergeFragments(features: Feature[]): Feature[] {
  const groups = new Map<string, Feature[]>();
  const anonymous: Feature[] = [];
  for (const feature of features) {
    if (
      !["Polygon", "MultiPolygon"].includes(
        feature.getGeometry()?.getType() ?? "",
      )
    )
      continue;
    const id = feature.getId();
    if (id === undefined) {
      anonymous.push(feature);
      continue;
    }
    const key = `${feature.get("layer") ?? "building"}:${id}`;
    const group = groups.get(key) ?? [];
    group.push(feature);
    groups.set(key, group);
  }
  const result = [...anonymous];
  for (const [id, group] of groups) {
    const feature = group[0].clone();
    feature.setId(id);
    if (group.length > 1) {
      const polygons = group.map(
        (f) =>
          (
            f.getGeometry() as Polygon | MultiPolygon
          ).getCoordinates() as polygonClipping.Geom,
      );
      feature.setGeometry(
        new MultiPolygon(
          polygonClipping.union(polygons[0], ...polygons.slice(1)),
        ),
      );
    }
    result.push(feature);
  }
  return result;
}
/** OpenMapTiles-compatible MVT, loaded in bounded batches, four requests at a time. */
export function mvtProvider(options: MVTProviderOptions): BuildingProvider {
  const zoom = options.zoom ?? 14,
    maxTiles = options.maxTiles ?? 16;
  if (
    !Number.isInteger(zoom) ||
    zoom < 0 ||
    zoom > 22 ||
    !Number.isInteger(maxTiles) ||
    maxTiles < 1 ||
    maxTiles > 128
  )
    throw new RangeError("Invalid MVT tile limits");
  if (!["{z}", "{x}", "{y}"].every((token) => options.url.includes(token)))
    throw new Error("MVT URL requires {z}, {x}, {y}");
  const grid = createXYZ({ maxZoom: zoom });
  return {
    attribution: options.attribution,
    async load({ bbox, projection, signal }) {
      const extent = transformExtent(bbox, "EPSG:4326", "EPSG:3857");
      const range = grid.getTileRangeForExtentAndZ(extent, zoom);
      if (range.getWidth() * range.getHeight() > maxTiles)
        throw new Error("MVT viewport exceeds maxTiles");
      const tiles: number[][] = [];
      for (let x = range.minX; x <= range.maxX; x++)
        for (let y = range.minY; y <= range.maxY; y++) tiles.push([zoom, x, y]);
      const features: Feature[] = [];
      for (let i = 0; i < tiles.length; i += 4) {
        const batch = await Promise.all(
          tiles.slice(i, i + 4).map(async (tile) => {
            const url = options.url
              .replace("{z}", String(tile[0]))
              .replace("{x}", String(tile[1]))
              .replace("{y}", String(tile[2]));
            const response = await fetch(url, { signal });
            if (response.status === 204) return [];
            if (!response.ok) throw new Error(`MVT HTTP ${response.status}`);
            const format = new MVT<Feature>({
              featureClass: Feature,
              layers: options.layers ?? ["building"],
              idProperty: options.idProperty,
            });
            const result = format.readFeatures(await response.arrayBuffer(), {
              extent: grid.getTileCoordExtent(tile),
              featureProjection: "EPSG:3857",
            });
            if (projection.getCode() !== "EPSG:3857")
              for (const f of result)
                f.getGeometry()?.transform("EPSG:3857", projection);
            return result;
          }),
        );
        features.push(...batch.flat());
      }
      return mergeFragments(features);
    },
  };
}
