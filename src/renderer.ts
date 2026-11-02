import { EntranceAnimation } from "./EntranceAnimation.js";
import type Feature from "ol/Feature.js";
import type { FrameState } from "ol/Map.js";
import { getPointResolution } from "ol/proj.js";
import type Polygon from "ol/geom/Polygon.js";
import type MultiPolygon from "ol/geom/MultiPolygon.js";
import { resolveHeight, type HeightOptions } from "./heights.js";

export interface RenderOptions extends HeightOptions {
  walls: boolean;
  shadows: boolean;
  lighting: boolean;
  wallColor: string;
  roofColor: string;
  outlineColor: string;
  heightScale: number;
  sun: { azimuth: number; elevation: number };
  maxFeatures: number;
  animationDuration: number;
}
type Point = number[];
function path(ctx: CanvasRenderingContext2D, rings: Point[][]) {
  ctx.beginPath();
  for (const ring of rings) {
    ring.forEach((p, i) =>
      i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]),
    );
    ctx.closePath();
  }
}
export class BuildingRenderer {
  private entrance = new EntranceAnimation();
  private cache = new WeakMap<
    Feature,
    { revision: number; polygons: number[][][][] }
  >();
  draw(
    ctx: CanvasRenderingContext2D,
    features: Feature[],
    frame: FrameState,
    o: RenderOptions,
  ) {
    const duration =
      typeof matchMedia !== "undefined" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches
        ? 0
        : o.animationDuration;
    const t = frame.coordinateToPixelTransform;
    const pixel = (p: Point): Point => [
      t[0] * p[0] + t[2] * p[1] + t[4],
      t[1] * p[0] + t[3] * p[1] + t[5],
    ];
    const meters = getPointResolution(
      frame.viewState.projection,
      frame.viewState.resolution,
      frame.viewState.center,
      "m",
    );
    if (!(meters > 0)) return 0;
    const rotation = frame.viewState.rotation;
    const sun = (o.sun.azimuth * Math.PI) / 180 - rotation;
    const shadowLength = 1 / Math.tan((o.sun.elevation * Math.PI) / 180);
    const buildings: {
      rings: Point[][];
      h: number;
      min: number;
      depth: number;
    }[] = [];
    const parentIds = new Set(
      features
        .map((f) => f.get("building_id"))
        .filter((v) => v != null)
        .map(String),
    );
    for (const feature of features.slice(0, o.maxFeatures)) {
      // Only suppress explicitly linked parent footprints. Spatial guesses can erase adjacent buildings.
      if (parentIds.has(String(feature.getId() ?? feature.get("id")))) continue;
      const geometry = feature.getGeometry();
      if (
        !geometry ||
        !["Polygon", "MultiPolygon"].includes(geometry.getType())
      )
        continue;
      let cached = this.cache.get(feature);
      if (!cached || cached.revision !== feature.getRevision()) {
        const coordinates = (
          geometry as Polygon | MultiPolygon
        ).getCoordinates();
        cached = {
          revision: feature.getRevision(),
          polygons:
            geometry.getType() === "Polygon"
              ? [coordinates as number[][][]]
              : (coordinates as number[][][][]),
        };
        this.cache.set(feature, cached);
      }
      const info = resolveHeight(feature, o);
      if (info.height <= info.minHeight) continue;
      const progress = this.entrance.progress(feature, frame.time, duration);
      if (progress < 1) frame.animate = true;
      for (const polygon of cached.polygons) {
        if (
          !polygon.length ||
          polygon.some(
            (r) =>
              r.length < 4 ||
              r.some((p) => !Number.isFinite(p[0]) || !Number.isFinite(p[1])),
          )
        )
          continue;
        const rings = polygon.map((r) => r.map(pixel));
        buildings.push({
          rings,
          h: (info.height / meters) * o.heightScale * progress,
          min: (info.minHeight / meters) * o.heightScale * progress,
          depth: Math.max(...rings[0].map((p) => p[1])),
        });
      }
    }
    buildings.sort((a, b) => a.depth - b.depth);
    if (o.shadows) {
      // One union-like path avoids repeated alpha darkening where shadows overlap.
      ctx.beginPath();
      for (const b of buildings) {
        const dx = -Math.sin(sun) * b.h * shadowLength,
          dy = Math.cos(sun) * b.h * shadowLength;
        for (const ring of b.rings)
          for (let i = 0; i < ring.length - 1; i++) {
            const a = ring[i],
              c = ring[i + 1];
            const quad = [a, c, [c[0] + dx, c[1] + dy], [a[0] + dx, a[1] + dy]];
            // Normalize orientation so overlapping shadows do not cancel.
            const area = quad.reduce(
              (v, p, j) =>
                v + p[0] * quad[(j + 1) % 4][1] - quad[(j + 1) % 4][0] * p[1],
              0,
            );
            if (area < 0) quad.reverse();
            quad.forEach((p, j) =>
              j ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]),
            );
            ctx.closePath();
          }
      }
      ctx.fillStyle = "rgba(24,36,43,0.18)";
      ctx.fill();
    }
    for (const b of buildings) {
      if (o.walls) {
        const walls: { quad: Point[]; depth: number; shade: number }[] = [];
        b.rings.forEach((ring, ri) => {
          const area = ring
            .slice(0, -1)
            .reduce(
              (v, p, i) => v + p[0] * ring[i + 1][1] - ring[i + 1][0] * p[1],
              0,
            );
          for (let i = 0; i < ring.length - 1; i++) {
            const a = ring[i],
              c = ring[i + 1],
              dx = c[0] - a[0],
              dy = c[1] - a[1];
            const sign = (area > 0 ? 1 : -1) * (ri === 0 ? 1 : -1);
            const nx = dy * sign,
              ny = -dx * sign,
              len = Math.hypot(nx, ny);
            if (ny <= 0 || len === 0) continue;
            walls.push({
              quad: [
                [a[0], a[1] - b.min],
                [c[0], c[1] - b.min],
                [c[0], c[1] - b.h],
                [a[0], a[1] - b.h],
              ],
              depth: (a[1] + c[1]) / 2,
              shade: o.lighting
                ? 0.12 +
                  (0.32 *
                    (1 - (nx * Math.sin(sun) - ny * Math.cos(sun)) / len)) /
                    2
                : 0,
            });
          }
        });
        walls.sort((a, b) => a.depth - b.depth);
        for (const wall of walls) {
          path(ctx, [wall.quad]);
          ctx.fillStyle = o.wallColor;
          ctx.fill();
          ctx.fillStyle = `rgba(0,0,0,${wall.shade})`;
          ctx.fill();
        }
      }
      path(
        ctx,
        b.rings.map((r) => r.map((p) => [p[0], p[1] - b.h])),
      );
      ctx.fillStyle = o.roofColor;
      ctx.fill("evenodd");
      ctx.strokeStyle = o.outlineColor;
      ctx.lineWidth = 0.65;
      ctx.stroke();
    }
    return buildings.length;
  }
}
