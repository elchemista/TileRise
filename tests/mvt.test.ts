import { it, expect } from "vitest";
import Feature from "ol/Feature.js";
import Polygon from "ol/geom/Polygon.js";
import MultiPolygon from "ol/geom/MultiPolygon.js";
import { mergeFragments, mvtProvider } from "../src/mvt.js";
function box(x: number, id?: number) {
  const f = new Feature({
    geometry: new Polygon([
      [
        [x, 0],
        [x + 10, 0],
        [x + 10, 10],
        [x, 10],
        [x, 0],
      ],
    ]),
    layer: "building",
    height: 12,
  });
  f.setId(id);
  return f;
}
it("merges tile-cut walls, preserves area and properties", () => {
  const merged = mergeFragments([box(0, 7), box(10, 7)]);
  expect(merged).toHaveLength(1);
  expect((merged[0].getGeometry() as MultiPolygon).getArea()).toBe(200);
  expect(merged[0].get("height")).toBe(12);
  expect((merged[0].getGeometry() as MultiPolygon).getPolygons()).toHaveLength(
    1,
  );
});
it("keeps distinct and unidentified buildings separate", () =>
  expect(
    mergeFragments([box(0, 1), box(10, 2), box(20), box(30)]),
  ).toHaveLength(4));
it("rejects unbounded/invalid tile configuration", () => {
  expect(() => mvtProvider({ url: "x", attribution: "x" })).toThrow();
  expect(() =>
    mvtProvider({ url: "/{z}/{x}/{y}", attribution: "x", maxTiles: 1000 }),
  ).toThrow();
});

it("decodes real binary MVT into the map projection", async () => {
  const { fromGeojsonVt } = await import("vt-pbf");
  const { vi } = await import("vitest");
  const { get } = await import("ol/proj.js");
  const data = fromGeojsonVt({
    building: {
      features: [
        {
          id: 42,
          type: 3,
          geometry: [
            [
              [100, 100],
              [200, 100],
              [200, 200],
              [100, 200],
              [100, 100],
            ],
          ],
          tags: { render_height: 18 },
        },
      ],
    },
  } as never);
  const fetchMock = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(new Uint8Array(data)));
  try {
    const features = await mvtProvider({
      url: "https://test/{z}/{x}/{y}.pbf",
      attribution: "test",
      zoom: 0,
    }).load({
      bbox: [1, 1, 2, 2],
      projection: get("EPSG:3857")!,
      signal: new AbortController().signal,
    });
    expect(features).toHaveLength(1);
    expect(features[0].get("render_height")).toBe(18);
    const extent = features[0].getGeometry()!.getExtent();
    expect(extent[0]).toBeLessThan(-18000000);
    expect(extent[1]).toBeGreaterThan(18000000);
  } finally {
    fetchMock.mockRestore();
  }
});
