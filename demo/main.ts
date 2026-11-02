import { addNavigationFixture } from "./navigation-fixture.js";
import Map from "ol/Map.js";
import View from "ol/View.js";
import VectorSource from "ol/source/Vector.js";
import TileRise, { createBasemap } from "../src/index.js";
import { fixtures, center } from "./fixtures.js";
import "./style.css";
const el = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const input = (id: string) => el<HTMLInputElement>(id);
const status = el("status");
let base = createBasemap();
let rise = new TileRise({ source: new VectorSource({ features: fixtures }) });
const map = new Map({
  target: "map",
  layers: [base, rise],
  view: new View({ center, zoom: 18, constrainRotation: false }),
});
function settings() {
  rise.setOptions({
    walls: input("walls").checked,
    shadows: input("shadows").checked,
    lighting: input("lighting").checked,
    heightScale: +input("scale").value,
    sun: {
      azimuth: +input("azimuth").value,
      elevation: +input("elevation").value,
    },
    roofColor: input("roof").value,
    wallColor: input("wall").value,
  });
  rise.setVisible(input("enabled").checked);
  el("scale-value").textContent = `${input("scale").value}×`;
}
for (const id of [
  "walls",
  "shadows",
  "lighting",
  "scale",
  "azimuth",
  "elevation",
  "roof",
  "wall",
  "enabled",
])
  input(id).addEventListener("input", settings);
input("rotation").addEventListener("input", () =>
  map.getView().setRotation((+input("rotation").value * Math.PI) / 180),
);
el("data").addEventListener("change", () => {
  map.removeLayer(rise);
  rise.dispose();
  rise = new TileRise({
    source:
      input("data").value === "fixture"
        ? new VectorSource({ features: fixtures })
        : undefined,
    onStatus: (s) => {
      status.textContent =
        s.state === "loading"
          ? "Caricamento edifici…"
          : s.state === "error"
            ? `Dati non disponibili: ${s.error?.message}`
            : s.state === "zoom-in"
              ? "Avvicinati per caricare gli edifici"
              : `${s.count} edifici · OpenStreetMap`;
    },
  });
  map.getLayers().insertAt(1, rise);
  settings();
  if (input("data").value === "fixture")
    status.textContent = "Scena locale · 5 edifici di verifica";
});
el("base").addEventListener("change", () => {
  try {
    const next = createBasemap({
      type: input("base").value as "osm" | "roadmap" | "satellite",
      key: input("key").value,
    });
    next.getSource()?.on("change", () => {
      if (next.getSource()?.getState() === "error")
        status.textContent =
          "Google non disponibile: verifica chiave e Map Tiles API.";
    });
    map.getLayers().setAt(0, next);
    base.getSource()?.dispose();
    base.dispose();
    base = next;
  } catch (error) {
    input("base").value = "osm";
    status.textContent = (error as Error).message;
  }
});
el("reset").addEventListener("click", () =>
  map.getView().animate({ center, zoom: 18, rotation: 0, duration: 400 }),
);
// Test harness, only exposed in the local demo.
Object.assign(window, {
  tileRiseDemo: {
    map,
    addNavigationFixture,
    get rise() {
      return rise;
    },
  },
});
