import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { canStep, findPath, isWalkable, parseHeightmap } from "../src/index.ts";
import type { PathGrid, Tile } from "../src/index.ts";

function gridOf(rows: string[], blocked: Tile[] = []): PathGrid {
  const hm = parseHeightmap(rows);
  const set = new Set(blocked.map((t) => `${t.x},${t.y}`));
  return { height: hm.height, blocked: (x, y) => set.has(`${x},${y}`) };
}

/** Independent reachability check (BFS using canStep) for the "null when unreachable" property. */
function reachable(grid: PathGrid, from: Tile, to: Tile, w: number, l: number): boolean {
  const seen = new Set<string>([`${from.x},${from.y}`]);
  const queue: Tile[] = [from];
  while (queue.length) {
    const c = queue.shift()!;
    if (c.x === to.x && c.y === to.y) return true;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const n = { x: c.x + dx, y: c.y + dy };
        if (n.x < 0 || n.y < 0 || n.x >= w || n.y >= l) continue;
        const k = `${n.x},${n.y}`;
        if (seen.has(k) || !canStep(grid, c, n)) continue;
        seen.add(k);
        queue.push(n);
      }
    }
  }
  return false;
}

const W = 8;
const L = 7;
const cellArb = fc.oneof(
  { weight: 6, arbitrary: fc.constantFrom("0", "1") },
  { weight: 1, arbitrary: fc.constantFrom("x", "3") },
);
const rowsArb = fc.array(fc.array(cellArb, { minLength: W, maxLength: W }).map((r) => r.join("")), {
  minLength: L,
  maxLength: L,
});
const blockedArb = fc.array(
  fc.record({ x: fc.integer({ min: 0, max: W - 1 }), y: fc.integer({ min: 0, max: L - 1 }) }),
  { maxLength: 10 },
);
const tileArb = fc.record({
  x: fc.integer({ min: 0, max: W - 1 }),
  y: fc.integer({ min: 0, max: L - 1 }),
});

describe("findPath", () => {
  it("walks straight and returns empty when already there", () => {
    const g = gridOf(["0000"]);
    expect(findPath(g, { x: 0, y: 0 }, { x: 3, y: 0 })).toEqual([
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ]);
    expect(findPath(g, { x: 1, y: 0 }, { x: 1, y: 0 })).toEqual([]);
  });

  it("goes around a blocked tile and prefers diagonals when open", () => {
    const g = gridOf(["000", "000", "000"], [{ x: 1, y: 1 }]);
    const p = findPath(g, { x: 0, y: 0 }, { x: 2, y: 2 })!;
    expect(p.length).toBe(4);
    expect(p).not.toContainEqual({ x: 1, y: 1 });
    expect(findPath(gridOf(["000", "000", "000"]), { x: 0, y: 0 }, { x: 2, y: 2 })).toHaveLength(2);
  });

  it("does not cut corners", () => {
    // Diagonal (0,0)->(1,1) would squeeze between two blocked tiles.
    const g = gridOf(["00", "00"], [{ x: 1, y: 0 }]);
    expect(canStep(g, { x: 0, y: 0 }, { x: 1, y: 1 })).toBe(false);
    expect(findPath(g, { x: 0, y: 0 }, { x: 1, y: 1 })).toEqual([
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ]);
  });

  it("respects the height step limit", () => {
    const g = gridOf(["030"]);
    expect(findPath(g, { x: 0, y: 0 }, { x: 2, y: 0 })).toBeNull();
    expect(findPath(gridOf(["012"]), { x: 0, y: 0 }, { x: 2, y: 0 })).toHaveLength(2);
  });

  it("returns null for void, blocked or walled-off targets", () => {
    expect(findPath(gridOf(["0x0"]), { x: 0, y: 0 }, { x: 1, y: 0 })).toBeNull();
    expect(findPath(gridOf(["000"], [{ x: 2, y: 0 }]), { x: 0, y: 0 }, { x: 2, y: 0 })).toBeNull();
    expect(findPath(gridOf(["0x0"]), { x: 0, y: 0 }, { x: 2, y: 0 })).toBeNull();
  });

  it("every step is between adjacent walkable tiles and the path ends at the target", () => {
    fc.assert(
      fc.property(rowsArb, blockedArb, tileArb, tileArb, (rows, blocked, from, to) => {
        const g = gridOf(rows, blocked);
        const path = findPath(g, from, to);
        fc.pre(path !== null);
        let prev: Tile = from;
        for (const t of path!) {
          expect(Math.max(Math.abs(t.x - prev.x), Math.abs(t.y - prev.y))).toBe(1);
          expect(isWalkable(g, t.x, t.y)).toBe(true);
          expect(canStep(g, prev, t)).toBe(true);
          prev = t;
        }
        expect(prev).toEqual(to);
      }),
      { numRuns: 300 },
    );
  });

  it("returns null exactly when the target is unreachable", () => {
    fc.assert(
      fc.property(rowsArb, blockedArb, tileArb, tileArb, (rows, blocked, from, to) => {
        const g = gridOf(rows, blocked);
        const path = findPath(g, from, to);
        const ok = isWalkable(g, to.x, to.y) && reachable(g, from, to, W, L);
        expect(path !== null).toBe(ok);
      }),
      { numRuns: 300 },
    );
  });
});
