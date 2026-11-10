/**
 * Eight logical directions, clockwise from north (-y): 0 N, 1 NE, 2 E, 3 SE, 4 S, 5 SW, 6 W, 7 NW.
 * Only 5 are drawn; 0, 1, 2 mirror 6, 5, 4 (a screen mirror swaps dx and dy).
 */
export type Dir = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const DIR_VECTORS: readonly (readonly [number, number])[] = [
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
];

export function oppositeDir(d: Dir): Dir {
  return ((d + 4) % 8) as Dir;
}

/** Direction of travel for a unit or larger step; keeps the previous direction when dx = dy = 0. */
export function dirFromDelta(dx: number, dy: number, fallback: Dir = 4): Dir {
  const sx = Math.sign(dx);
  const sy = Math.sign(dy);
  const i = DIR_VECTORS.findIndex(([vx, vy]) => vx === sx && vy === sy);
  return i < 0 ? fallback : (i as Dir);
}
