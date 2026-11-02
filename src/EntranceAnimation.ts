import type Feature from "ol/Feature.js";
import { getUid } from "ol/util.js";
/** Stable feature identities keep viewport reloads and map rotation from restarting growth. */
export class EntranceAnimation {
  private starts = new Map<string, number>();
  progress(feature: Feature, time: number, duration: number): number {
    const key =
      feature.getId() !== undefined
        ? `id:${feature.getId()}`
        : `feature:${getUid(feature)}`;
    if (!this.starts.has(key)) {
      this.starts.set(key, time);
      if (this.starts.size > 16384)
        this.starts.delete(this.starts.keys().next().value!);
    }
    if (duration === 0) return 1;
    const t = Math.max(
      0,
      Math.min(1, (time - this.starts.get(key)!) / duration),
    );
    return 1 - (1 - t) ** 3;
  }
}
