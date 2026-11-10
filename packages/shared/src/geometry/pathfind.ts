export interface Tile {
  x: number;
  y: number;
}

/** Minimal grid view needed for pathfinding. */
export interface PathGrid {
  /** Floor height at (x, y), or null when there is no floor. */
  height(x: number, y: number): number | null;
  /** True when furniture or another rule blocks the tile. Optional. */
  blocked?(x: number, y: number): boolean;
}

export const MAX_HEIGHT_STEP = 1;

export function isWalkable(grid: PathGrid, x: number, y: number): boolean {
  return grid.height(x, y) !== null && !(grid.blocked?.(x, y) ?? false);
}

/** True when moving one step (orthogonal or diagonal) from a to b is allowed. */
export function canStep(grid: PathGrid, a: Tile, b: Tile): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dx) > 1 || Math.abs(dy) > 1 || (dx === 0 && dy === 0)) return false;
  const ha = grid.height(a.x, a.y);
  const hb = grid.height(b.x, b.y);
  if (hb === null || !isWalkable(grid, b.x, b.y)) return false;
  if (ha !== null && Math.abs(ha - hb) > MAX_HEIGHT_STEP) return false;
  if (dx !== 0 && dy !== 0) {
    // No corner cutting: both orthogonal neighbours must be walkable.
    if (!isWalkable(grid, a.x + dx, a.y) || !isWalkable(grid, a.x, a.y + dy)) return false;
  }
  return true;
}

const NEIGHBOURS: readonly (readonly [number, number])[] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
  [1, -1],
  [1, 1],
  [-1, 1],
  [-1, -1],
];

interface Node {
  x: number;
  y: number;
  g: number;
  f: number;
  parent: Node | null;
}

/** Chebyshev distance with the diagonal cost folded in (octile). Admissible for costs 1 / 1.4. */
function heuristic(ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  return Math.max(dx, dy) + 0.4 * Math.min(dx, dy);
}

/**
 * A* over 8 neighbours. Cost 1 orthogonal, 1.4 diagonal, no corner cutting, height step <= 1.
 * Returns the tiles to walk through, excluding `from` and ending at `to` (empty when from == to),
 * or null when `to` is unwalkable or unreachable. `from` itself need not be walkable.
 */
export function findPath(grid: PathGrid, from: Tile, to: Tile): Tile[] | null {
  if (!isWalkable(grid, to.x, to.y)) return null;
  if (from.x === to.x && from.y === to.y) return [];

  const key = (x: number, y: number) => `${x},${y}`;
  const open: Node[] = [
    { x: from.x, y: from.y, g: 0, f: heuristic(from.x, from.y, to.x, to.y), parent: null },
  ];
  const best = new Map<string, number>([[key(from.x, from.y), 0]]);
  const closed = new Set<string>();

  while (open.length > 0) {
    // Linear scan: rooms are tiny. Ties broken by lower g, then insertion order (deterministic).
    let bi = 0;
    for (let i = 1; i < open.length; i++) {
      const c = open[i]!;
      const b = open[bi]!;
      if (c.f < b.f || (c.f === b.f && c.g > b.g)) bi = i;
    }
    const cur = open.splice(bi, 1)[0]!;
    const ck = key(cur.x, cur.y);
    if (closed.has(ck)) continue;
    closed.add(ck);

    if (cur.x === to.x && cur.y === to.y) {
      const path: Tile[] = [];
      for (let n: Node | null = cur; n && n.parent; n = n.parent) path.push({ x: n.x, y: n.y });
      return path.reverse();
    }

    for (const [dx, dy] of NEIGHBOURS) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      const nk = key(nx, ny);
      if (closed.has(nk) || !canStep(grid, cur, { x: nx, y: ny })) continue;
      const g = cur.g + (dx !== 0 && dy !== 0 ? 1.4 : 1);
      const known = best.get(nk);
      if (known !== undefined && known <= g) continue;
      best.set(nk, g);
      open.push({ x: nx, y: ny, g, f: g + heuristic(nx, ny, to.x, to.y), parent: cur });
    }
  }
  return null;
}
