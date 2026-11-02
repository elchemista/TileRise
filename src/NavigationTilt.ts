import type Map from "ol/Map.js";

/** Inverse of CSS perspective(d) rotateX(angle) scale(scale), around viewport center. */
export function untiltPixel(
  pixel: number[],
  size: number[],
  angle: number,
  scale: number,
  perspective: number,
  origin = [size[0] / 2, size[1] / 2],
): number[] {
  const radians = (angle * Math.PI) / 180;
  const dx = pixel[0] - origin[0],
    dy = pixel[1] - origin[1];
  const y =
    dy / (scale * (Math.cos(radians) + (dy * Math.sin(radians)) / perspective));
  const x = (dx * (1 - (scale * y * Math.sin(radians)) / perspective)) / scale;
  return [x + origin[0], y + origin[1]];
}
/** Visual pitch for a planar OL map. UI controls stay upright; pointer coordinates are inverted. */
export function createNavigationTilt(map: Map, angle = 25) {
  if (!Number.isFinite(angle) || angle < 0 || angle > 35)
    throw new RangeError("Tilt must be 0–35 degrees");
  const originalPixel = map.getEventPixel;
  let active = false;
  const saved = new globalThis.Map<
    HTMLElement,
    { transform: string; origin: string }
  >();
  // Strong enough overscan to keep the rear edge outside the visible viewport.
  const scale = 1.5;
  function distance() {
    const size = map.getSize() ?? [1, 1];
    return Math.max(...size) * 3;
  }
  function origin() {
    const size = map.getSize?.() ?? [1, 1];
    const center = map.getView?.().getCenter();
    return center
      ? (map.getPixelFromCoordinate?.(center) ?? [size[0] / 2, size[1] / 2])
      : [size[0] / 2, size[1] / 2];
  }
  function update() {
    if (!active) return;
    const viewport = map.getViewport?.();
    if (!viewport) return;
    for (const element of Array.from(
      viewport.querySelectorAll<HTMLElement>(
        ".ol-layers, .ol-overlaycontainer",
      ),
    )) {
      if (!saved.has(element))
        saved.set(element, {
          transform: element.style.transform,
          origin: element.style.transformOrigin,
        });
      const anchor = origin();
      element.style.transformOrigin = `${anchor[0]}px ${anchor[1]}px`;
      element.style.transform = `perspective(${distance()}px) rotateX(${angle}deg) scale(${scale})`;
    }
  }
  const onResize = () => update();
  map.on("change:size", onResize);
  map.on("postrender", onResize);
  function setEnabled(enabled: boolean) {
    if (enabled === active) {
      update();
      return;
    }
    active = enabled;
    if (enabled) {
      map.getEventPixel = function (event) {
        return untiltPixel(
          originalPixel.call(map, event),
          map.getSize() ?? [1, 1],
          angle,
          scale,
          distance(),
          origin(),
        );
      };
      update();
    } else {
      map.getEventPixel = originalPixel;
      for (const [element, style] of saved) {
        element.style.transform = style.transform;
        element.style.transformOrigin = style.origin;
      }
      saved.clear();
    }
  }
  return {
    setEnabled,
    dispose() {
      setEnabled(false);
      map.un?.("change:size", onResize);
      map.un?.("postrender", onResize);
    },
  };
}
