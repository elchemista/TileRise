import Feature from "ol/Feature.js";
import Polygon from "ol/geom/Polygon.js";
import MultiPolygon from "ol/geom/MultiPolygon.js";
import { fromLonLat } from "ol/proj.js";
const center = fromLonLat([9.19, 45.4642]);
const ring = (points: number[][]) =>
  points.map(([x, y]) => [center[0] + x, center[1] + y]);
export const fixtures = [
  new Feature({
    geometry: new Polygon([
      ring([
        [-160, -90],
        [-80, -90],
        [-80, -20],
        [-160, -20],
        [-160, -90],
      ]),
    ]),
    height: "24 m",
    name: "Metri",
  }),
  new Feature({
    geometry: new Polygon([
      ring([
        [-40, -80],
        [75, -80],
        [75, 40],
        [-40, 40],
        [-40, -80],
      ]),
      ring([
        [-10, -50],
        [45, -50],
        [45, 10],
        [-10, 10],
        [-10, -50],
      ]),
    ]),
    "building:levels": 6,
    name: "Cortile",
  }),
  new Feature({
    geometry: new Polygon([
      ring([
        [-150, 30],
        [-65, 30],
        [-65, 65],
        [-110, 65],
        [-110, 125],
        [-150, 125],
        [-150, 30],
      ]),
    ]),
    height: "65'",
    name: "Concavo",
  }),
  new Feature({
    geometry: new MultiPolygon([
      [
        ring([
          [110, -70],
          [155, -70],
          [155, -20],
          [110, -20],
          [110, -70],
        ]),
      ],
      [
        ring([
          [110, 10],
          [170, 10],
          [170, 65],
          [110, 65],
          [110, 10],
        ]),
      ],
    ]),
    height: 32,
    name: "MultiPolygon",
  }),
  new Feature({
    geometry: new Polygon([
      ring([
        [-30, 100],
        [35, 100],
        [35, 155],
        [-30, 155],
        [-30, 100],
      ]),
    ]),
    height: 48,
    min_height: 8,
    name: "Sopraelevato",
  }),
];
export { center };
