import GeoJSON from "ol/format/GeoJSON.js";
import type Feature from "ol/Feature.js";
import type Projection from "ol/proj/Projection.js";
import osmtogeojson from "osmtogeojson";

export type BBox = [number, number, number, number];
export interface BuildingRequest {
  bbox: BBox;
  signal: AbortSignal;
  projection: Projection;
  location?: { center: [number, number]; radius: number };
}
export interface BuildingProvider {
  attribution: string;
  load(request: BuildingRequest): Promise<Feature[]>;
}
const format = new GeoJSON();
export function overpassProvider(
  endpoint = "https://overpass-api.de/api/interpreter",
): BuildingProvider {
  return {
    attribution:
      '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
    async load({ bbox: [w, s, e, n], signal, projection, location }) {
      const bounds = location
        ? `around:${location.radius},${location.center[1]},${location.center[0]}`
        : `${s},${w},${n},${e}`;
      const query = `[out:json][timeout:25];(way["building"]["building"!="no"](${bounds});relation["building"]["building"!="no"]["type"="multipolygon"](${bounds});way["building:part"]["building:part"!="no"](${bounds});relation["building:part"]["building:part"!="no"]["type"="multipolygon"](${bounds}););out body;>;out skel qt;`;
      const response = await fetch(endpoint, {
        method: "POST",
        body: new URLSearchParams({ data: query }),
        signal,
      });
      if (!response.ok) throw new Error(`Overpass HTTP ${response.status}`);
      const data = await response.json();
      if (data.remark) throw new Error(`Overpass: ${data.remark}`);
      if (!Array.isArray(data.elements))
        throw new Error("Invalid Overpass response");
      const json = osmtogeojson(data, { flatProperties: true });
      return format.readFeatures(json, { featureProjection: projection });
    },
  };
}
/** Use for municipal datasets, Overture extracts or an application backend. GeoJSON is WGS84. */
export function geoJSONProvider(
  url: string | ((bbox: BBox) => string),
  attribution: string,
): BuildingProvider {
  return {
    attribution,
    async load({ bbox, signal, projection }) {
      const response = await fetch(
        typeof url === "function" ? url(bbox) : url,
        { signal },
      );
      if (!response.ok) throw new Error(`Buildings HTTP ${response.status}`);
      return format.readFeatures(await response.json(), {
        featureProjection: projection,
      });
    },
  };
}
/** Try providers in order; empty coverage falls through. Never conflates unrelated IDs. */
export function fallbackProvider(
  ...providers: BuildingProvider[]
): BuildingProvider {
  if (!providers.length) throw new Error("At least one provider is required");
  return {
    attribution: providers.map((p) => p.attribution).join(" · "),
    async load(request) {
      const errors: unknown[] = [];
      let succeeded = false;
      for (const provider of providers) {
        try {
          const features = await provider.load(request);
          succeeded = true;
          if (features.length) return features;
        } catch (error) {
          if (request.signal.aborted) throw error;
          errors.push(error);
        }
      }
      if (!succeeded)
        throw new AggregateError(errors, "All building providers failed");
      return [];
    },
  };
}

/** Enrich footprints using a trusted application's identity/spatial matching service.
 * Errors propagate: wrap the enriched provider in fallbackProvider(enriched, base)
 * when the enrichment service is optional. */
export function enrichProvider(
  base: BuildingProvider,
  enrich: (features: Feature[], request: BuildingRequest) => Promise<void>,
  attribution: string,
): BuildingProvider {
  return {
    attribution: [base.attribution, attribution].filter(Boolean).join(" · "),
    async load(request) {
      const features = (await base.load(request)).map((feature) => {
        const copy = feature.clone();
        copy.setId(feature.getId());
        return copy;
      });
      await enrich(features, request);
      request.signal.throwIfAborted();
      return features;
    },
  };
}

/** Small-area recovery for interactive GPS prototypes, never a viewport-wide OSM download.
 * Prefer a dedicated building backend for production fleets. OSM fallback is limited
 * to radius <=100m and at most one request per 30 seconds per provider instance. */
export function nearbyOSMProvider(): BuildingProvider {
  const primary = overpassProvider();
  let lastFallback = -Infinity;
  return {
    attribution: primary.attribution,
    async load(request) {
      if (!request.location || request.location.radius > 100)
        throw new Error(
          "Nearby OSM requires a GPS radius of at most 100 metres",
        );
      const timeout = new AbortController();
      const timer = setTimeout(() => timeout.abort(), 8000);
      const signal = AbortSignal.any([request.signal, timeout.signal]);
      try {
        return await primary.load({ ...request, signal });
      } catch (error) {
        if (request.signal.aborted) throw error;
      } finally {
        clearTimeout(timer);
      }
      request.signal.throwIfAborted();
      if (Date.now() - lastFallback < 30000)
        throw new Error("OSM building fallback cooling down");
      lastFallback = Date.now();
      const response = await fetch(
        `https://api.openstreetmap.org/api/0.6/map.json?bbox=${request.bbox.join(",")}`,
        { signal: request.signal },
      );
      if (!response.ok)
        throw new Error(`OSM buildings HTTP ${response.status}`);
      const json = osmtogeojson(await response.json(), {
        flatProperties: true,
      });
      return format
        .readFeatures(json, { featureProjection: request.projection })
        .filter((feature) => {
          const building = feature.get("building"),
            part = feature.get("building:part");
          return (building && building !== "no") || (part && part !== "no");
        });
    },
  };
}
