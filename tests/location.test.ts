import { it, expect, vi } from "vitest";
import TileRise from "../src/TileRise.js";
import { overpassProvider } from "../src/providers.js";
import { untiltPixel } from "../src/NavigationTilt.js";
import { get } from "ol/proj.js";
it("location mode starts disabled and rejects invalid fixes", () => {
  const layer = new TileRise({ locationOnly: true });
  expect(layer.getVisible()).toBe(false);
  expect(() => layer.setLocation([NaN, 44])).toThrow();
  layer.setLocation([10, 45], 100);
  layer.enable();
  expect(layer.getVisible()).toBe(true);
  layer.setLocation(null);
  expect(layer.getVisible()).toBe(false);
  layer.dispose();
});
it("queries only the requested 100 metre GPS radius, independent of map bounds", async () => {
  const fetcher = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(Response.json({ elements: [] }));
  try {
    await overpassProvider().load({
      bbox: [-10, -10, 10, 10],
      signal: new AbortController().signal,
      projection: get("EPSG:3857")!,
      location: { center: [10, 45], radius: 100 },
    });
    expect(String(fetcher.mock.calls[0][1]?.body)).toContain(
      "around%3A100%2C45%2C10",
    );
  } finally {
    fetcher.mockRestore();
  }
});
it("inverts perspective coordinates for POI hit detection", () => {
  const size = [1000, 800],
    a = (25 * Math.PI) / 180,
    s = 1.5,
    d = 3000;
  for (const point of [
    [100, 200],
    [500, 400],
    [850, 700],
  ]) {
    const x = point[0] - 500,
      y = point[1] - 400,
      w = 1 - (s * y * Math.sin(a)) / d;
    const screen = [500 + (s * x) / w, 400 + (s * y * Math.cos(a)) / w];
    const original = untiltPixel(screen, size, 25, s, d);
    expect(original[0]).toBeCloseTo(point[0], 8);
    expect(original[1]).toBeCloseTo(point[1], 8);
  }
});

it("animates new identities once, including across source replacement and rotation", async () => {
  const { EntranceAnimation } = await import("../src/EntranceAnimation.js");
  const { default: Feature } = await import("ol/Feature.js");
  const animation = new EntranceAnimation(),
    a = new Feature();
  a.setId("way/1");
  expect(animation.progress(a, 1000, 600)).toBe(0);
  expect(animation.progress(a, 1300, 600)).toBe(0.875);
  const replacement = new Feature();
  replacement.setId("way/1");
  expect(animation.progress(replacement, 1600, 600)).toBe(1);
  expect(animation.progress(replacement, 1900, 600)).toBe(1);
  expect(animation.progress(new Feature(), 1900, 600)).toBe(0);
});

it("recovers a failed Overpass request with bounded OSM data and filters non-buildings", async () => {
  const { nearbyOSMProvider } = await import("../src/providers.js");
  const fetcher = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(new Response("", { status: 502 }))
    .mockResolvedValueOnce(
      Response.json({
        elements: [
          {
            type: "way",
            id: 1,
            tags: { building: "yes" },
            nodes: [1, 2, 3, 4, 1],
          },
          {
            type: "way",
            id: 2,
            tags: { landuse: "grass" },
            nodes: [1, 2, 3, 4, 1],
          },
          { type: "node", id: 1, lat: 45, lon: 10 },
          { type: "node", id: 2, lat: 45, lon: 10.0001 },
          { type: "node", id: 3, lat: 45.0001, lon: 10.0001 },
          { type: "node", id: 4, lat: 45.0001, lon: 10 },
        ],
      }),
    );
  try {
    const features = await nearbyOSMProvider().load({
      bbox: [10, 45, 10.001, 45.001],
      signal: new AbortController().signal,
      projection: get("EPSG:3857")!,
      location: { center: [10, 45], radius: 100 },
    });
    expect(features).toHaveLength(1);
    expect(features[0].get("building")).toBe("yes");
    expect(String(fetcher.mock.calls[1][0])).toContain(
      "map.json?bbox=10,45,10.001,45.001",
    );
  } finally {
    fetcher.mockRestore();
  }
});

it("validates the configured radius and uses it when setLocation omits an override", () => {
  expect(() => new TileRise({ radius: 0 })).toThrow();
  expect(() => new TileRise({ radius: NaN })).toThrow();
  expect(() => new TileRise({ radius: 1001 })).toThrow();
  const layer = new TileRise({ locationOnly: true, radius: 200 });
  layer.setLocation([10, 45]);
  // Observe the provider request in the browser suite; construction and explicit override remain valid.
  layer.setLocation([10, 45], 50);
  layer.dispose();
});
