import TileLayer from "ol/layer/Tile.js";
import OSM from "ol/source/OSM.js";
import Google from "ol/source/Google.js";
/** Optional convenience helper. Existing applications keep their own basemap. */
export function createBasemap(
  options: {
    type?: "osm" | "roadmap" | "satellite" | "terrain";
    key?: string;
  } = {},
) {
  if (!options.type || options.type === "osm")
    return new TileLayer({ source: new OSM() });
  if (!options.key?.trim())
    throw new Error("Google Map Tiles API key required");
  return new TileLayer({
    source: new Google({
      key: options.key,
      mapType: options.type,
      language: "it-IT",
      region: "IT",
      attributionsCollapsible: false,
    }),
  });
}
