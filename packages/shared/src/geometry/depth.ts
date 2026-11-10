export const LAYER = { floor: 0, furni: 1, avatar: 2, overlay: 3 } as const;
export type Layer = (typeof LAYER)[keyof typeof LAYER];

export interface DepthItem {
  /** Top-left tile of the footprint (or the avatar's current tile, rounded up). */
  x: number;
  y: number;
  /** Footprint size; defaults to 1x1. */
  w?: number;
  l?: number;
  /** Height units (0-9). */
  z?: number;
  layer: Layer;
}

/**
 * Sort key: larger = drawn later (in front). Uses the front-most tile of the footprint,
 * so `depth = (x + y) * 1000 + z * 10 + layer`. z must stay within 0..99 to keep the tile term dominant.
 */
export function depthKey(item: DepthItem): number {
  const fx = item.x + (item.w ?? 1) - 1;
  const fy = item.y + (item.l ?? 1) - 1;
  return (fx + fy) * 1000 + (item.z ?? 0) * 10 + item.layer;
}
