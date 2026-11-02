import { describe, it, expect } from "vitest";
import Feature from "ol/Feature.js";
import { parseHeight, resolveHeight } from "../src/heights.js";
import { fallbackProvider } from "../src/providers.js";
import { get } from "ol/proj.js";
import TileRise from "../src/TileRise.js";
describe("height resolution", () => {
  it.each([
    [12, 12],
    ["12 m", 12],
    ["12,5", 12.5],
    ["10 ft", 3.048],
    ["10' 6\"", 3.2004],
    ["", undefined],
    ["12;14", undefined],
    ["12 garbage", undefined],
    [NaN, undefined],
    [Infinity, undefined],
    [-1, undefined],
    [null, undefined],
  ])("parses %s", (value, expected) => {
    expect(parseHeight(value)).toBe(expected);
  });
  it("prefers measured height to levels, exposes provenance and clamps base", () => {
    expect(
      resolveHeight(
        new Feature({ height: 20, "building:levels": 9, min_height: 50 }),
      ),
    ).toEqual({
      height: 20,
      minHeight: 20,
      source: "height",
      estimated: false,
    });
  });
  it("skips malformed fields and uses levels with roof height", () => {
    expect(
      resolveHeight(
        new Feature({ height: "bad", "building:levels": 4, "roof:height": 2 }),
      ),
    ).toMatchObject({ height: 14, estimated: true });
  });
  it("does not multiply missing levels into NaN", () =>
    expect(resolveHeight(new Feature()).height).toBe(10));
  it("preserves zero and clamps extreme data", () => {
    expect(resolveHeight(new Feature({ height: 0 })).height).toBe(0);
    expect(resolveHeight(new Feature({ height: 99999 })).height).toBe(1000);
  });
  it("supports Overture and OpenMapTiles properties", () => {
    expect(resolveHeight(new Feature({ num_floors: 5 })).height).toBe(15);
    expect(
      resolveHeight(new Feature({ render_height: 21, render_min_height: 6 })),
    ).toMatchObject({ height: 21, minHeight: 6 });
  });
  it("validates renderer options before attachment", () => {
    expect(() => new TileRise({ sun: { elevation: 0 } })).toThrow();
    expect(() => new TileRise({ heightScale: NaN })).toThrow();
    const rise = new TileRise();
    expect(() => rise.setOptions({ maxFeatures: 0 })).toThrow();
    rise.dispose();
  });
});
describe("provider fallback", () => {
  const request = {
    bbox: [0, 0, 1, 1] as [number, number, number, number],
    signal: new AbortController().signal,
    projection: get("EPSG:3857")!,
  };
  it("falls through unavailable and empty sources", async () => {
    const feature = new Feature();
    const provider = fallbackProvider(
      {
        attribution: "a",
        load: async () => {
          throw Error("offline");
        },
      },
      { attribution: "b", load: async () => [] },
      { attribution: "c", load: async () => [feature] },
    );
    expect(await provider.load(request)).toEqual([feature]);
  });
  it("reports total failure instead of replacing data with empty coverage", async () => {
    await expect(
      fallbackProvider({
        attribution: "a",
        load: async () => {
          throw Error("offline");
        },
      }).load(request),
    ).rejects.toThrow("All building providers failed");
  });
});
