import VectorLayer from "ol/layer/Vector.js";
import VectorSource from "ol/source/Vector.js";
import Feature from "ol/Feature.js";
import Point from "ol/geom/Point.js";
import { Style, Circle, Fill } from "ol/style.js";
import type Map from "ol/Map.js";
/** Mirrors RDM's default-z-index POI content layer for browser integration tests. */
export function addNavigationFixture(map: Map, offset = [0, 0]) {
  const viewCenter = map.getView().getCenter()!;
  const center = [viewCenter[0] + offset[0], viewCenter[1] + offset[1]];
  const f = new Feature({
    geometry: new Point(center),
    poiId: "navigation-poi",
  });
  map.addLayer(
    new VectorLayer({
      source: new VectorSource({ features: [f] }),
      style: new Style({
        image: new Circle({ radius: 14, fill: new Fill({ color: "#ff0044" }) }),
      }),
    }),
  );
  return map.getPixelFromCoordinate(center);
}
