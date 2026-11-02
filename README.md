# TileRise

**Solid, lightweight 2.5D buildings for OpenLayers. Add one layer; start navigating.**

TileRise extrudes building footprints into opaque walls and flat roofs using Canvas 2D. It loads OpenStreetMap buildings around the current viewport automatically, resolves heights, shades facades and projects directional ground shadows. No Three.js, separate camera, prototype patches or activation call.

This is an initial **0.1 implementation**, not a full 3D engine. The map remains planar; roofs move vertically in screen space. There are no windows, textures, terrain or free-camera navigation.

## Quick start

TileRise is an ESM TypeScript library with generated declarations. OpenLayers is a **peer dependency**: use the application's existing OpenLayers instance (10.6+ within version 10). The RDM integration was inspected against OpenLayers 10.10.

This repository is not published to npm yet. Build and install it locally:

```sh
# In this repository (Node.js 22.12+)
npm ci
npm run build
npm pack

# In your application: use the actual path printed by npm pack
npm install /path/to/tilerise/tilerise-0.1.2.tgz
```

```ts
import Map from 'ol/Map.js';
import View from 'ol/View.js';
import { fromLonLat } from 'ol/proj.js';
import TileRise, { createBasemap } from 'tilerise';

const map = new Map({
  target: 'map',
  view: new View({ center: fromLonLat([9.19, 45.4642]), zoom: 18 }),
  layers: [
    createBasemap(), // OpenStreetMap; your existing basemap also works
    new TileRise(),  // automatically active, automatically loads buildings
  ],
});
```

No `enable()`, manually populated source, CSS import or additional UI is required for TileRise. Your map still needs its usual container size and OpenLayers CSS. Default loading starts above zoom 15 and below resolution 5, subject to the viewport request-area limit.

## RDM SPA integration

The current navigation implementation is `packages/navigation/map.ts` in `rdm/lib/rdm_spa`. Its `createNavigationMap()` constructs an OpenLayers map with the base layer, notification areas, route/POI content and position layers. It does not currently expose a generic plugin option.

Add the import and **one layer entry immediately after `baseMap.layer`**:

```ts
import TileRise from 'tilerise';

// Inside the existing new Map({ ... }) call:
layers: [
  baseMap.layer,
  new TileRise({ locationOnly: true }),
  // existing notificationAreas layer
  // existing content / route / POI layer
  // existing accuracy / position layer (zIndex: 10)
],
```

RDM's adapters already connect the GPS fix and follow state to `setLocation()` / `enable()`, and expose an **Enable 3D** setting (translated into all 14 supported languages). The preference controls both buildings and visual pitch, defaults to enabled for older saved settings, and never enables 3D in static/preview mode. For a new integration, wire those GPS lifecycle calls as described below. `packages/navigation/baseMap.ts` already handles Google and OSM; keep using it. Switching those sources does not reset TileRise, the camera, routes or tracking. Keep the building layer at the default z-index and before the navigation overlays so POIs and routes remain legible and clickable. TileRise does not participate in feature hit detection or capture pointer events.

For an already constructed map, this equivalent form inserts the layer at index 1:

```ts
const buildings = new TileRise({ map });
```

The older `src/domains/map/services/openlayer.ts` can use the same constructor after creating its `OLMap`. If an application later reorders its layers, preserve the building layer below navigation overlays.

Removing the layer cancels pending requests. A map target listener also cancels them when a SPA clears the target. For permanent removal, also dispose it:

```ts
map.removeLayer(buildings);
buildings.dispose();
```

The local RDM SPA now installs the package from `vendor/tilerise-0.1.2.tgz` and enables it in both navigation adapters. The snippets above describe that integration; consumers of this standalone package still add the layer explicitly. Its existing offline cache does not automatically cache building requests; provide an offline-capable provider if offline building coverage is required.

## Basemaps and building data are separate

Raster map tiles are only the background. TileRise does **not** infer building geometry or height from satellite imagery or Google tiles.

| Background | Setup |
| --- | --- |
| Existing OpenLayers base layer | Keep it; add TileRise above it |
| OpenStreetMap | `createBasemap()` |
| Google road map | `createBasemap({ type: 'roadmap', key })` |
| Google satellite | `createBasemap({ type: 'satellite', key })` |
| Google terrain | `createBasemap({ type: 'terrain', key })` |

Google uses OpenLayers' official `ol/source/Google` and the Google Map Tiles API. Supply your own enabled API key and preserve the map's attribution control. The demo keeps keys only in memory and offers no server-side key proxy. The RDM app's own Google fallback remains the preferred integration there. Google operation requires valid credentials and was not live-tested with a key in this repository.

## Building providers

### Automatic OpenStreetMap / Overpass

`new TileRise()` uses the public Overpass endpoint. It requests building ways, multipolygon relations and building parts, including nodes required to reconstruct complete rings and courtyards.

Requests are debounced, bounded to a small area, cancelled when superseded, and timed out. Errors preserve the last successful source and use a 30-second retry cooldown. The current coverage is reused while it contains the viewport; up to eight exact query results are cached in memory for five minutes. There is no persistent cache or bulk prefetch.

```ts
import TileRise, { overpassProvider } from 'tilerise';

const buildings = new TileRise({
  provider: overpassProvider('https://your-overpass.example/api/interpreter'),
  onStatus(status) {
    // idle | loading | ready | error | zoom-in
    console.log(status.state, status.count, status.error?.message);
  },
});
```

The public endpoint is useful for development and light usage. For production navigation, configure a suitable building service or MVT provider. Availability, density and height completeness depend on the upstream dataset. Requests disclose the viewed bounding box to the selected provider.

### Existing OpenLayers vector source

```ts
const buildings = new TileRise({ source: buildingsSource });
```

Supplying `source` disables automatic fetching, even if `provider` is also supplied. Feature geometries must use the map's projection. Source feature changes invalidate cached geometry. TileRise does not dispose a source supplied by the application. Only Polygon and MultiPolygon geometries are drawn.

### GeoJSON: municipal datasets, Overture extracts, your backend

```ts
import { geoJSONProvider } from 'tilerise';

const buildings = new TileRise({
  provider: geoJSONProvider(
    ([west, south, east, north]) =>
      `/api/buildings?bbox=${[west, south, east, north].join(',')}`,
    'Building data © Your data provider',
  ),
});
```

The endpoint returns WGS84 GeoJSON. A static GeoJSON URL also works. Overture data must first be exported or served as GeoJSON/MVT; this library does not download the global GeoParquet dataset in the browser. Overture-style `height`, `num_floors` and explicit `building_id` relationships are understood.

### OpenMapTiles / MVT

```ts
import { mvtProvider } from 'tilerise';

const buildings = new TileRise({
  provider: mvtProvider({
    url: 'https://your-tiles.example/{z}/{x}/{y}.pbf',
    attribution: '© OpenStreetMap contributors · © OpenMapTiles',
    layers: ['building'],
    zoom: 14,
    maxTiles: 16,
    // idProperty: 'id', // if your service carries IDs in a property
  }),
});
```

The adapter loads XYZ Web Mercator tiles in batches of four and decodes full OpenLayers features. Fragments sharing a stable ID and source-layer name are unioned **before extrusion**, removing internal tile-edge walls. `render_height` and `render_min_height` are supported.

A stable cross-tile ID is essential: anonymous fragments cannot be stitched reliably. Tile providers must not reuse an ID for unrelated buildings. Merging removes internal seams between loaded fragments; the outer edge of the fetched tile coverage can still truncate buildings. A missing tile is an error; HTTP 204 represents empty coverage. This bounded viewport adapter is not a streaming `VectorTileSource` renderer.

### Multiple sources and height enrichment

```ts
import { fallbackProvider, geoJSONProvider, overpassProvider } from 'tilerise';

const buildings = new TileRise({
  provider: fallbackProvider(
    geoJSONProvider(bbox => `/api/city-buildings?bbox=${bbox.join(',')}`, 'City dataset'),
    overpassProvider(),
  ),
});
```

Fallback tries providers in order after failure or empty coverage. It returns the **first nonempty result**; it does not blend partial datasets or claim universal height coverage.

For measured-height services, use `enrichProvider(base, async (features, request) => { ... }, attribution)`. The callback receives cloned footprints, the WGS84 bbox, map projection and cancellation signal. Set a matched feature's `height` or additional properties there. Identity/spatial matching belongs to your service: guessing that nearby footprints represent the same building can silently assign wrong heights. Wrap optional enrichment with `fallbackProvider(enriched, base)` if the base should survive enrichment failures. Provider attribution strings are trusted application configuration, not unsanitized remote text.

## Height resolution

`resolveHeight(feature, options)` returns `{ height, minHeight, source, estimated }` in metres. Priority:

1. Valid custom `height(feature)` result.
2. `height`.
3. `render_height`.
4. `est_height`.
5. `building:levels`, `num_floors`, then `levels`, multiplied by `levelHeight`; add `roof:height` if present.
6. `defaultHeight`.

Finite nonnegative numbers, metre strings, decimal commas, feet and feet/inches are accepted. Empty strings, malformed lists, negative values, infinity and NaN are rejected. Zero is preserved. Heights are capped by `maxHeight`. `min_height`, `render_min_height` and `building:min_level` define elevated bases and are clamped to the total height. `ele` is not used as building height: it describes altitude, not structural height.

Levels, default heights, `est_height` and `render_height` are conservatively marked as estimated. A dataset's `height` field is treated as supplied height; this is provenance, not independent verification of a real-world measurement. Rendering does not fabricate a measured height when the field is missing.

```ts
const buildings = new TileRise({
  defaultHeight: 10,
  levelHeight: 3,
  height: feature => feature.get('survey_height'),
});
```

The custom resolver falls through to normal properties when it returns an invalid or missing value. It must be synchronous and should not throw.

## GPS-only navigation and visual pitch

RDM now uses `new TileRise({ locationOnly: true })`. It starts hidden and makes no
requests before a valid GPS fix. While following the user, call
`buildings.setLocation([longitude, latitude], 100)` and `buildings.enable()`.
Call `buildings.setLocation(null)` when entering static/preview mode or stopping GPS.
Queries are centred on that fix, not the visible map; only footprints within 100 m
are rendered. GPS movements of up to 20 m reuse coverage, while rotation never
changes the query. New coverage can therefore lag by up to 20 m at the boundary.

The location-only default provider tries Overpass for eight seconds, then uses the
OSM map API for a strictly bounded <=100 m query. The latter is limited to one call
per 30 seconds per instance. This is a small-area prototype fallback, not a backend
for production fleets; use a dedicated provider for sustained production traffic.
Partial multipolygon relations at the fallback bbox boundary may be unavailable.

`createNavigationTilt(map, 25)` returns `{ setEnabled, dispose }`. It applies visual
CSS perspective to the map planes (including DOM overlays), keeps UI controls flat,
and inversely transforms pointer coordinates for POI hit detection. Rotation is
still controlled by OpenLayers. The transform is anchored to the camera centre,
including view padding; it does not create a free 3D camera. Dispose this helper
alongside the map. Rendering remains Canvas 2D; there is no WebGL geometry backend.

New building identities grow from ground level over `animationDuration` milliseconds
(default 600), with ease-out timing. Reloaded IDs and map rotation do not restart the
animation. Reduced-motion preferences disable it. Set `animationDuration: 0` for
instant rendering. Only active entrance transitions request additional frames.

## Options and controls

| Option | Default | Meaning |
| --- | --- | --- |
| `walls`, `shadows`, `lighting` | `true` | Solid facades, ground shadows and facade shading |
| `wallColor` | `#c4cfce` | Opaque six-digit hex |
| `roofColor` | `#edf1e9` | Opaque six-digit hex |
| `outlineColor` | `#8a9a99` | Six-digit hex roof outline |
| `sun.azimuth` | `225` | Degrees clockwise from geographic north |
| `sun.elevation` | `45` | Degrees above horizon, accepted range 5–90 |
| `heightScale` | `1` | Visual exaggeration; also affects shadows |
| `defaultHeight` | `10` | Metres when no usable height information exists |
| `levelHeight` | `3` | Metres per floor |
| `maxHeight` | `1000` | Cap on source heights in metres |
| `maxFeatures` | `8000` | Upper bound on source features considered per frame |
| `minZoom` | `15` | OpenLayers layer visibility threshold (exclusive) |
| `maxResolution` | `5` | OpenLayers visibility threshold in map units/pixel (exclusive) |
| `debounceMs` | `350` | Delay before a settled viewport request |
| `requestTimeoutMs` | `30000` | Provider request timeout |
| `maxQueryArea` | `0.004` | Maximum bbox area in square degrees; zoom in if exceeded |
| `onStatus` | — | Loading/coverage/error callback |
| `source`, `provider`, `map` | — | Optional source override, provider or immediate map attachment |

```ts
buildings.setOptions({
  shadows: false,
  heightScale: 1.2,
  sun: { azimuth: 180, elevation: 55 },
});
buildings.disable(); // equivalent to setVisible(false)
buildings.enable();  // equivalent to setVisible(true); not needed initially
buildings.setOpacity(0.85);
buildings.refresh(); // clear request cache and reload automatic coverage
console.log(buildings.getStatus());
```

`setOptions()` updates rendering/height options atomically and rejects invalid values. Use inherited OpenLayers setters for visibility, opacity, minZoom and maxResolution. Replace the layer to change provider configuration. Public status count is loaded source features, not the number of polygon components visible on screen.

## Rendering and limitations

- Filled facades with directional shading; flat opaque roofs and subtle outlines.
- Polygon/MultiPolygon support, concave outlines and even-odd courtyard holes.
- Elevated bases, metre-aware scale at the view latitude, map rotation and high-DPI canvases.
- Spatial source queries with a height/shadow margin; geometry cached by feature revision.
- Shadows first, then buildings ordered by screen-space ground depth; walls ordered within each building.
- Parent outlines are suppressed when a loaded part explicitly references their ID through `building_id`. Unlinked OSM `building:part` footprints are not spatially conflated; overlapping parent shells may remain.

Painter ordering is approximate. Interpenetrating volumes, complex overlapping parts and extreme height differences can show occlusion artifacts. Roof slopes, terrain heights and physically exact lighting/shadow occlusion are not implemented. Viewport loading uses a fixed pixel buffer; exceptionally tall off-screen buildings outside loaded coverage may appear late. Antimeridian-spanning and polar automatic queries are rejected. Ground shadows and heightScale are visual approximations, not a survey tool. There is no browser-wide performance guarantee; benchmark your actual datasets and devices.

## Demo and development

```sh
npm ci
npm run dev          # interactive demo at http://localhost:5173
npm run check        # TypeScript
npm test             # height, validation, provider and fragment-union tests
npx playwright install chromium
npm run test:browser # deterministic Chromium integration tests
npm run build        # ESM library + declarations in dist/
npm run build:demo   # deployable demo in demo-dist/
```

The demo starts with synthetic, explicitly labelled test buildings around Milan so geometry can be evaluated independently of a data service. Select **Edifici reali · OpenStreetMap** for viewport loading. The panel exposes walls, shadows, lighting, height exaggeration, sun direction/elevation, roof/wall colours, map rotation and basemap selection.

Browser tests block external basemap tiles and mock Overpass. They exercise actual Canvas drawing, toggles, rotation, automatic loading and disposal. A screenshot is written to `test-results/scene.png`. They do not certify live Google credentials, third-party uptime or cross-browser/mobile performance.

## Architecture

| File | Responsibility |
| --- | --- |
| `src/TileRise.ts` | OpenLayers layer, lifecycle, request cancellation, viewport coverage/cache |
| `src/renderer.ts` | Projection, geometry cache, facade/roof/shadow rendering |
| `src/heights.ts` | Numeric parsing, height priority and provenance |
| `src/providers.ts` | Overpass, GeoJSON, fallback and enrichment contracts |
| `src/mvt.ts` | Bounded MVT loading and stable-ID fragment union |
| `src/basemaps.ts` | Optional OSM / official Google source helpers |

## OpenLayers compatibility

The custom canvas uses the documented `Layer` constructor's `render` callback. Layer order, source updates, visibility and map insertion follow OpenLayers' managed-layer model. TileRise also uses two OL 10 lifecycle internals (`unrender` and the observable managed-layer `map` property) to cancel work on hiding, removal and SPA target teardown. These hooks are covered by browser tests; revalidate them before upgrading to a new OpenLayers major version. Unmanaged `setMap()` attachment is not supported: use the `layers` array, `map.addLayer()` or the TileRise `{ map }` convenience option.

- [Layer: custom render callback, ordering and visibility](https://openlayers.org/en/latest/apidoc/module-ol_layer_Layer-Layer.html)
- [Map: managed layers, target lifecycle and feature hit detection](https://openlayers.org/en/latest/apidoc/module-ol_Map-Map.html)

## License and references

TileRise's original implementation is MIT-licensed. It was inspired by the Canvas extrusion approach in [ol-ext Render3D](https://github.com/Viglino/ol-ext/blob/master/src/layer/Render3D.js); no ol-ext source was copied or vendored. Dependencies and datasets retain their own licenses and attribution requirements. Preserve provider attributions in the map.

- [OpenLayers Google source and Map Tiles API integration](https://openlayers.org/en/latest/apidoc/module-ol_source_Google-Google.html)
- [OpenMapTiles building schema](https://openmaptiles.org/schema/#building)
- [OpenStreetMap height tags](https://wiki.openstreetmap.org/wiki/Key:height)
- [Overture buildings guide](https://docs.overturemaps.org/guides/buildings/)
- [OpenStreetMap attribution and data license](https://www.openstreetmap.org/copyright)
