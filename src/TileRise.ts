import Layer from "ol/layer/Layer.js";
import { unByKey } from "ol/Observable.js";
import type { EventsKey } from "ol/events.js";
import VectorSource from "ol/source/Vector.js";
import type Feature from "ol/Feature.js";
import type Map from "ol/Map.js";
import type { FrameState } from "ol/Map.js";
import { getDistance } from "ol/sphere.js";
import { circular } from "ol/geom/Polygon.js";
import { buffer, containsExtent } from "ol/extent.js";
import { transform, transformExtent } from "ol/proj.js";
import { BuildingRenderer, type RenderOptions } from "./renderer.js";
import {
  overpassProvider,
  nearbyOSMProvider,
  type BuildingProvider,
  type BBox,
} from "./providers.js";

export interface TileRiseOptions extends Partial<Omit<RenderOptions, "sun">> {
  sun?: Partial<RenderOptions["sun"]>;
  map?: Map;
  source?: VectorSource<Feature>;
  provider?: BuildingProvider;
  /** Only load/render around setLocation(), never the viewport. Starts disabled. */
  locationOnly?: boolean;
  minZoom?: number;
  maxResolution?: number;
  debounceMs?: number;
  requestTimeoutMs?: number;
  /** Limit query footprint in square degrees; prevents accidental city-wide Overpass queries. */
  maxQueryArea?: number;
  onStatus?: (status: TileRiseStatus) => void;
}
export interface TileRiseStatus {
  state: "idle" | "loading" | "ready" | "error" | "zoom-in";
  count: number;
  error?: Error;
}
const defaults: RenderOptions = {
  walls: true,
  shadows: true,
  lighting: true,
  wallColor: "#c4cfce",
  roofColor: "#edf1e9",
  outlineColor: "#8a9a99",
  heightScale: 1,
  sun: { azimuth: 225, elevation: 45 },
  defaultHeight: 10,
  levelHeight: 3,
  maxHeight: 1000,
  maxFeatures: 8000,
  animationDuration: 600,
};

/** A normal managed OpenLayers layer. Adding it to map.layers activates everything. */
export default class TileRise extends Layer<VectorSource<Feature>> {
  private settings: RenderOptions;
  private config: TileRiseOptions;
  private provider?: BuildingProvider;
  private painter = new BuildingRenderer();
  private canvas?: HTMLCanvasElement;
  private pending?: ReturnType<typeof setTimeout>;
  private request?: AbortController;
  private generation = 0;
  private requestedKey = "";
  private covered?: number[];
  private location?: { center: [number, number]; radius: number };
  private coveredLocation?: [number, number];
  private requestedLocation?: [number, number];
  private requestedExtent?: number[];
  private projectionCode?: string;
  private retryAt = 0;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private destroyed = false;
  private targetListener?: EventsKey;
  private status: TileRiseStatus = { state: "idle", count: 0 };
  private cache = new globalThis.Map<
    string,
    { features: Feature[]; extent: number[]; time: number }
  >();
  constructor(options: TileRiseOptions = {}) {
    const provider = options.source
      ? undefined
      : (options.provider ??
        (options.locationOnly ? nearbyOSMProvider() : overpassProvider()));
    super({
      render: (frame) =>
        this.renderFrame(frame) ?? document.createElement("div"),
      source:
        options.source ??
        new VectorSource({ wrapX: false, attributions: provider?.attribution }),
      visible: !options.locationOnly,
      minZoom: options.minZoom ?? 15,
      maxResolution: options.maxResolution ?? 5,
    });
    this.config = {
      debounceMs: 350,
      requestTimeoutMs: 30000,
      maxQueryArea: 0.004,
      ...options,
    };
    this.settings = {
      ...defaults,
      ...options,
      sun: { ...defaults.sun, ...options.sun },
    };
    this.validate();
    this.provider = provider;
    this.on("change:visible", () => {
      if (!this.getVisible()) this.cancel();
    });
    // OL 10 managed layers expose their owning map through the observable map property.
    // Target removal does not call layer.unrender(), so watch it explicitly for SPA teardown.
    this.on("propertychange", (event) => {
      if (event.key !== "map") return;
      if (this.targetListener) unByKey(this.targetListener);
      this.targetListener = undefined;
      const owner = this.get("map") as Map | null;
      if (owner)
        this.targetListener = owner.on("change:target", () => {
          if (!owner.getTarget()) this.cancel();
        });
      else this.cancel();
    });
    // Constructor attachment inserts below navigation overlays, whose default z-index is also 0.
    if (options.map) options.map.getLayers().insertAt(1, this);
  }
  private validate() {
    if (
      !Number.isFinite(this.getMinZoom()) ||
      !Number.isFinite(this.getMaxResolution()) ||
      this.getMaxResolution() <= 0
    )
      throw new RangeError("Invalid zoom/resolution threshold");
    for (const key of ["wallColor", "roofColor", "outlineColor"] as const) {
      if (!/^#[0-9a-f]{6}$/i.test(this.settings[key]))
        throw new RangeError(`${key} must be an opaque #RRGGBB color`);
    }
    for (const key of [
      "defaultHeight",
      "levelHeight",
      "maxHeight",
      "heightScale",
      "maxFeatures",
      "animationDuration",
    ] as const) {
      const value = this.settings[key];
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
        throw new RangeError(`Invalid ${key}`);
    }
    if (
      !Number.isInteger(this.settings.maxFeatures) ||
      this.settings.maxFeatures < 1
    )
      throw new RangeError("Invalid maxFeatures");
    const { azimuth, elevation } = this.settings.sun;
    if (
      !Number.isFinite(azimuth) ||
      !Number.isFinite(elevation) ||
      elevation < 5 ||
      elevation > 90
    )
      throw new RangeError("Sun elevation must be 5–90° and azimuth finite");
    for (const key of [
      "debounceMs",
      "requestTimeoutMs",
      "maxQueryArea",
    ] as const) {
      const value = this.config[key]!;
      if (
        !Number.isFinite(value) ||
        value < 0 ||
        (key !== "debounceMs" && value === 0)
      )
        throw new RangeError(`Invalid ${key}`);
    }
  }
  setOptions(options: Partial<RenderOptions>) {
    const old = this.settings;
    this.settings = { ...old, ...options, sun: { ...old.sun, ...options.sun } };
    try {
      this.validate();
    } catch (error) {
      this.settings = old;
      throw error;
    }
    this.changed();
  }
  /** WGS84 longitude/latitude. null suspends location mode and cancels requests. */
  setLocation(center: [number, number] | null, radius = 100) {
    if (!center) {
      this.location = undefined;
      this.disable();
      return;
    }
    if (
      !center.every(Number.isFinite) ||
      Math.abs(center[0]) > 180 ||
      Math.abs(center[1]) > 85 ||
      !Number.isFinite(radius) ||
      radius <= 0 ||
      radius > 1000
    )
      throw new RangeError("Invalid location/radius");
    if (this.location?.radius !== radius) {
      this.covered = undefined;
      this.coveredLocation = undefined;
      this.cancel();
    }
    this.location = { center: [...center], radius };
    this.changed();
  }
  getStatus(): Readonly<TileRiseStatus> {
    return { ...this.status };
  }
  private report(state: TileRiseStatus["state"], error?: Error) {
    this.status = {
      state,
      count: this.getSource()!.getFeatures().length,
      error,
    };
    this.config.onStatus?.({ ...this.status });
  }
  enable() {
    this.setVisible(true);
  }
  disable() {
    this.setVisible(false);
  }
  refresh() {
    this.cancel();
    this.covered = undefined;
    this.cache.clear();
    this.retryAt = 0;
    this.changed();
  }
  private cancel() {
    this.generation++;
    clearTimeout(this.pending);
    this.pending = undefined;
    clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    this.request?.abort();
    this.request = undefined;
    this.requestedKey = "";
    this.requestedLocation = undefined;
    this.requestedExtent = undefined;
  }
  override unrender() {
    super.unrender();
    this.cancel();
  }
  private renderFrame(frame: FrameState | null): HTMLElement | null {
    if (
      !frame ||
      !frame.extent ||
      this.destroyed ||
      (this.config.locationOnly && !this.location)
    )
      return null;
    this.rendered = true;
    const canvas = (this.canvas ??= document.createElement("canvas"));
    canvas.className = "ol-layer tilerise-layer";
    canvas.style.cssText =
      "position:absolute;left:0;top:0;pointer-events:none;";
    const [w, h] = frame.size,
      dpr = frame.pixelRatio;
    if (canvas.width !== Math.round(w * dpr))
      canvas.width = Math.round(w * dpr);
    if (canvas.height !== Math.round(h * dpr))
      canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    canvas.style.opacity = String(
      frame.layerStatesArray[frame.layerIndex]?.opacity ?? this.getOpacity(),
    );
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    // Include tall buildings and long shadows whose footprints lie outside the viewport.
    const margin =
      (this.settings.maxHeight ?? 1000) *
      this.settings.heightScale *
      (1 + 1 / Math.tan((this.settings.sun.elevation * Math.PI) / 180));
    const extent = buffer(
      frame.extent,
      margin /
        Math.max(
          0.1,
          Math.cos(
            (transformExtent(
              frame.extent,
              frame.viewState.projection,
              "EPSG:4326",
            )[1] *
              Math.PI) /
              180,
          ),
        ),
    );
    const focus = this.location;
    const nearby = this.getSource()!
      .getFeaturesInExtent(extent)
      .filter((feature) => {
        if (!focus) return true;
        const coordinate = transform(
          focus.center,
          "EPSG:4326",
          frame.viewState.projection,
        );
        if (feature.getGeometry()?.intersectsCoordinate(coordinate))
          return true;
        const nearest = feature.getGeometry()?.getClosestPoint(coordinate);
        return (
          nearest &&
          getDistance(
            focus.center,
            transform(nearest, frame.viewState.projection, "EPSG:4326"),
          ) <= focus.radius
        );
      });
    this.painter.draw(ctx, nearby, frame, this.settings);
    if (this.provider && (this.location || !frame.viewHints.some(Boolean)))
      this.schedule(frame);
    return canvas;
  }
  private schedule(frame: FrameState) {
    if (!frame.extent) return;
    const projection = frame.viewState.projection;
    if (this.projectionCode !== projection.getCode()) {
      this.cancel();
      this.covered = undefined;
      this.cache.clear();
      this.getSource()!.clear();
      this.projectionCode = projection.getCode();
    }
    const focus = this.location;
    if (this.config.locationOnly && !focus) return;
    const within = (anchor?: [number, number]) =>
      focus &&
      anchor &&
      getDistance(focus.center, anchor) <= Math.min(20, focus.radius / 5);
    if (
      this.covered &&
      (focus
        ? within(this.coveredLocation)
        : containsExtent(this.covered, frame.extent))
    ) {
      if (this.requestedKey) this.cancel();
      return;
    }
    if (
      this.requestedKey &&
      (focus
        ? within(this.requestedLocation)
        : this.requestedExtent &&
          containsExtent(this.requestedExtent, frame.extent))
    )
      return;
    const extent = focus
      ? transformExtent(
          circular(focus.center, focus.radius, 64).getExtent(),
          "EPSG:4326",
          projection,
        )
      : buffer(frame.extent, frame.viewState.resolution * 120);
    const bbox = transformExtent(extent, projection, "EPSG:4326") as BBox;
    if (
      !bbox.every(Number.isFinite) ||
      bbox[0] < -180 ||
      bbox[2] > 180 ||
      bbox[1] < -85 ||
      bbox[3] > 85 ||
      (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]) > this.config.maxQueryArea!
    ) {
      this.cancel();
      if (this.status.state !== "zoom-in") this.report("zoom-in");
      return;
    }
    const key =
      projection.getCode() + ":" + bbox.map((v) => v.toFixed(5)).join(",");
    if (key === this.requestedKey || Date.now() < this.retryAt) return;
    this.cancel();
    this.requestedKey = key;
    this.requestedLocation = focus?.center;
    this.requestedExtent = extent;
    const generation = this.generation;
    this.pending = setTimeout(async () => {
      this.pending = undefined;
      const cached = this.cache.get(key);
      if (cached && Date.now() - cached.time < 300000) {
        this.apply(cached.features, cached.extent, focus?.center);
        this.requestedKey = "";
        return;
      }
      const request = new AbortController();
      this.request = request;
      const timeout = setTimeout(
        () => request.abort(new Error("Building request timed out")),
        this.config.requestTimeoutMs,
      );
      this.report("loading");
      try {
        const features = await this.provider!.load({
          bbox,
          projection,
          signal: request.signal,
          location: focus,
        });
        if (generation !== this.generation || this.destroyed) return;
        if (request.signal.aborted) throw request.signal.reason;
        const valid = features.filter((f) =>
          ["Polygon", "MultiPolygon"].includes(
            f.getGeometry()?.getType() ?? "",
          ),
        );
        this.cache.set(key, { features: valid, extent, time: Date.now() });
        if (this.cache.size > 8)
          this.cache.delete(this.cache.keys().next().value!);
        this.apply(valid, extent, focus?.center);
      } catch (error) {
        if (generation !== this.generation || this.destroyed) return;
        this.retryAt = Date.now() + 30000;
        this.report(
          "error",
          error instanceof Error ? error : new Error(String(error)),
        );
        this.retryTimer = setTimeout(() => this.changed(), 30050);
      } finally {
        clearTimeout(timeout);
        if (generation === this.generation) {
          this.request = undefined;
          this.requestedKey = "";
        }
      }
    }, this.config.debounceMs);
  }
  private apply(
    features: Feature[],
    extent: number[],
    location?: [number, number],
  ) {
    this.coveredLocation = location;
    this.covered = extent;
    this.getSource()!.clear(true);
    this.getSource()!.addFeatures(features);
    this.report("ready");
    this.changed();
  }
  protected override disposeInternal() {
    this.destroyed = true;
    if (this.targetListener) unByKey(this.targetListener);
    this.cancel();
    this.cache.clear();
    this.canvas = undefined;
    if (!this.config.source) this.getSource()?.dispose();
    super.disposeInternal();
  }
}
