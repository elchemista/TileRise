import type Feature from "ol/Feature.js";

export interface HeightOptions {
  defaultHeight?: number;
  levelHeight?: number;
  maxHeight?: number;
  height?: (feature: Feature) => unknown;
}
export interface HeightInfo {
  height: number;
  minHeight: number;
  source: string;
  estimated: boolean;
}
/** Strict parser: rejects lists, NaN, negative values and trailing garbage. */
export function parseHeight(value: unknown): number | undefined {
  if (typeof value === "number")
    return Number.isFinite(value) && value >= 0 ? value : undefined;
  if (typeof value !== "string") return undefined;
  const feet = value
    .trim()
    .match(/^(\d+(?:\.\d+)?)'\s*(?:(\d+(?:\.\d+)?)"?)?$/);
  if (feet) return Number(feet[1]) * 0.3048 + Number(feet[2] || 0) * 0.0254;
  const match = value
    .trim()
    .replace(",", ".")
    .match(/^(\d+(?:\.\d+)?)\s*(m|meters?|metres?|ft|feet)?$/i);
  return match
    ? Number(match[1]) * (/^(ft|feet)$/i.test(match[2] || "") ? 0.3048 : 1)
    : undefined;
}
export function resolveHeight(
  feature: Feature,
  options: HeightOptions = {},
): HeightInfo {
  const p = { ...feature.get("tags"), ...feature.getProperties() };
  const max = options.maxHeight ?? 1000;
  let height: number | undefined;
  let source = "default";
  let estimated = true;
  const custom = options.height?.(feature);
  for (const [key, value] of [
    ["custom", custom],
    ["height", p.height],
    ["render_height", p.render_height],
    ["est_height", p.est_height],
  ] as const) {
    const n = parseHeight(value);
    if (n !== undefined) {
      height = n;
      source = key;
      estimated = key === "est_height" || key === "render_height";
      break;
    }
  }
  if (height === undefined) {
    for (const key of ["building:levels", "num_floors", "levels"]) {
      const levels = parseHeight(p[key]);
      if (levels !== undefined) {
        height =
          levels * (options.levelHeight ?? 3) +
          (parseHeight(p["roof:height"]) ?? 0);
        source = key;
        break;
      }
    }
  }
  height = Math.min(max, height ?? options.defaultHeight ?? 10);
  const min =
    parseHeight(p.min_height) ??
    parseHeight(p.render_min_height) ??
    (parseHeight(p["building:min_level"]) ?? 0) * (options.levelHeight ?? 3);
  return { height, minHeight: Math.min(height, min), source, estimated };
}
