import { test, expect } from "@playwright/test";
test.beforeEach(async ({ page }) => {
  await page.route("**/tile.openstreetmap.org/**", (r) => r.abort());
});
test("solid geometry, holes, toggles, rotation and disposal", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  const canvas = page.locator(".tilerise-layer");
  await expect(canvas).toBeVisible();
  await expect
    .poll(() =>
      canvas.evaluate((c: HTMLCanvasElement) => {
        const data = c
          .getContext("2d")!
          .getImageData(0, 0, c.width, c.height).data;
        let opaque = 0;
        for (let i = 3; i < data.length; i += 4) if (data[i] === 255) opaque++;
        return opaque;
      }),
    )
    .toBeGreaterThan(5000);
  await page.screenshot({ path: "test-results/scene.png" });
  const before = await canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL());
  await page.locator("#walls").uncheck();
  await expect
    .poll(() => canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL()))
    .not.toBe(before);
  await page.locator("#walls").check();
  await page.locator("#rotation").fill("75");
  await page.locator("#rotation").dispatchEvent("input");
  await expect
    .poll(() => canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL()))
    .not.toBe(before);
  await page.locator("#enabled").uncheck();
  await expect(canvas).not.toBeAttached();
  await page.locator("#enabled").check();
  await expect(canvas).toBeVisible();
  await page.evaluate(() => {
    const { map, rise } = (window as any).tileRiseDemo;
    map.removeLayer(rise);
    rise.dispose();
  });
  await expect(canvas).not.toBeAttached();
  expect(errors).toEqual([]);
});
test("automatic viewport loading and cancellation on removal", async ({
  page,
}) => {
  let calls = 0;
  await page.route("**/api/interpreter", async (route) => {
    calls++;
    await route.fulfill({
      json: {
        elements: [
          {
            type: "way",
            id: 1,
            tags: { building: "yes", height: "20" },
            nodes: [1, 2, 3, 4, 1],
          },
          { type: "node", id: 1, lat: 45.464, lon: 9.19 },
          { type: "node", id: 2, lat: 45.464, lon: 9.1905 },
          { type: "node", id: 3, lat: 45.4645, lon: 9.1905 },
          { type: "node", id: 4, lat: 45.4645, lon: 9.19 },
        ],
      },
    });
  });
  await page.goto("/");
  await page.locator("#data").selectOption("live");
  await expect(page.locator("#status")).toContainText("1 edifici");
  expect(calls).toBe(1);
  await page.evaluate(() => {
    const { map } = (window as any).tileRiseDemo;
    map.getView().setRotation(0.6);
  });
  await expect(page.locator(".tilerise-layer")).toBeVisible();
  await page.locator("#data").selectOption("fixture");
  await expect(page.locator("#status")).toContainText("Scena locale");
});

test("RDM-style POIs remain above buildings and clickable", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".tilerise-layer")).toBeVisible();
  const pixel = await page.evaluate(async () => {
    const { map, addNavigationFixture } = (window as any).tileRiseDemo;
    map.on("singleclick", (event: any) => {
      (window as any).picked = map.forEachFeatureAtPixel(
        event.pixel,
        (f: any) => f.get("poiId"),
      );
    });
    return addNavigationFixture(map);
  });
  await page.mouse.click(pixel[0], pixel[1]);
  await expect
    .poll(() => page.evaluate(() => (window as any).picked))
    .toBe("navigation-poi");
});

test("cancelled responses cannot replace a newly installed layer", async ({
  page,
}) => {
  let release!: () => void;
  const delayed = new Promise<void>((r) => (release = r));
  await page.route("**/api/interpreter", async (route) => {
    await delayed;
    await route.fulfill({ json: { elements: [] } }).catch(() => {});
  });
  await page.goto("/");
  await page.locator("#data").selectOption("live");
  await expect(page.locator("#status")).toContainText("Caricamento");
  await page.locator("#data").selectOption("fixture");
  release();
  await expect(page.locator("#status")).toContainText("Scena locale");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).tileRiseDemo.rise.getSource().getFeatures().length,
      ),
    )
    .toBe(5);
});

test("facades are opaque and courtyard is not roof-filled", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".tilerise-layer")).toBeVisible();
  const alpha = await page.evaluate(() => {
    const { map, rise } = (window as any).tileRiseDemo;
    const ctx = (
      document.querySelector(".tilerise-layer") as HTMLCanvasElement
    ).getContext("2d")!;
    const sample = (coordinate: number[], offset: number) => {
      const p = map.getPixelFromCoordinate(coordinate);
      return ctx.getImageData(Math.round(p[0]), Math.round(p[1] + offset), 1, 1)
        .data[3];
    };
    const center = map.getView().getCenter();
    return {
      wall: sample([center[0] - 120, center[1] - 90], -15),
      hole: sample([center[0] + 15, center[1] - 20], -5),
    };
  });
  expect(alpha.wall).toBe(255);
  expect(alpha.hole).toBeLessThan(255);
});

test("SPA target teardown aborts an in-flight building request", async ({
  page,
}) => {
  let release!: () => void;
  const delayed = new Promise<void>((r) => (release = r));
  await page.route("**/api/interpreter", async (route) => {
    await delayed;
    await route.fulfill({ json: { elements: [] } }).catch(() => {});
  });
  await page.goto("/");
  await page.locator("#data").selectOption("live");
  await expect(page.locator("#status")).toContainText("Caricamento");
  const aborted = page.waitForEvent("requestfailed", (r) =>
    r.url().includes("/api/interpreter"),
  );
  await page.evaluate(() =>
    (window as any).tileRiseDemo.map.setTarget(undefined),
  );
  await aborted;
  release();
});

test("tilted and rotated map keeps POI hit detection aligned", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".tilerise-layer")).toBeVisible();
  const screen = await page.evaluate(async () => {
    const path = "/src/index.ts";
    const { createNavigationTilt } = await import(/* @vite-ignore */ path);
    const { map, addNavigationFixture } = (window as any).tileRiseDemo;
    map.getView().setRotation(0.8);
    map.renderSync();
    const pixel = addNavigationFixture(map, [70, 30]);
    createNavigationTilt(map).setEnabled(true);
    map.renderSync();
    map.on("singleclick", (event: any) => {
      (window as any).picked = map.forEachFeatureAtPixel(
        event.pixel,
        (f: any) => f.get("poiId"),
      );
    });
    const style = getComputedStyle(document.querySelector(".ol-layers")!);
    const origin = style.transformOrigin.split(" ").map(parseFloat);
    const projected = new DOMMatrix(style.transform).transformPoint({
      x: pixel[0] - origin[0],
      y: pixel[1] - origin[1],
    });
    return [
      projected.x / projected.w + origin[0],
      projected.y / projected.w + origin[1],
    ];
  });
  await page.mouse.click(screen[0], screen[1]);
  await expect
    .poll(() => page.evaluate(() => (window as any).picked))
    .toBe("navigation-poi");
});
