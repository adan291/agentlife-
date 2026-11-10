/** 2:1 isometric projection. Tile 64x32 px at zoom 1, 1 height unit = 16 px. */
export const TILE_W = 64;
export const TILE_H = 32;
export const HEIGHT_UNIT = 16;

export interface ScreenPoint {
  sx: number;
  sy: number;
}

export interface TilePoint {
  x: number;
  y: number;
  z?: number;
}

/**
 * Screen position of a tile's centre (tile (x, y) covers the continuous range
 * [x - 0.5, x + 0.5] x [y - 0.5, y + 0.5]). Coordinates may be fractional, which
 * lets avatars be interpolated between tiles.
 */
export function tileToScreen(p: TilePoint): ScreenPoint {
  const z = p.z ?? 0;
  return {
    sx: ((p.x - p.y) * TILE_W) / 2,
    sy: ((p.x + p.y) * TILE_H) / 2 - z * HEIGHT_UNIT,
  };
}

/** Continuous (fractional) tile coordinates at height 0 for a screen point. */
export function screenToTileFloat(sx: number, sy: number): { x: number; y: number } {
  const a = (2 * sx) / TILE_W; // x - y
  const b = (2 * sy) / TILE_H; // x + y
  return { x: (a + b) / 2, y: (b - a) / 2 };
}

/** Integer tile containing a screen point (floor plane, z = 0). */
export function screenToTile(sx: number, sy: number): { x: number; y: number } {
  const f = screenToTileFloat(sx, sy);
  // `+ 0` turns -0 into 0 so results compare equal with Object.is.
  return { x: Math.round(f.x) + 0, y: Math.round(f.y) + 0 };
}
