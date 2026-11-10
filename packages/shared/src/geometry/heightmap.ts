export interface Heightmap {
  /** Columns (x extent). */
  w: number;
  /** Rows (y extent). */
  l: number;
  /** Floor height at (x, y), or null when there is no floor (or out of range). */
  height(x: number, y: number): number | null;
}

/** Parse rows of characters: `x` = no floor, `0`-`9` = floor height. Row index = y, column = x. */
export function parseHeightmap(rows: readonly string[]): Heightmap {
  if (rows.length === 0) throw new Error("heightmap has no rows");
  const w = rows[0]!.length;
  if (w === 0) throw new Error("heightmap row 0 is empty");
  const cells: (number | null)[] = [];
  rows.forEach((row, y) => {
    if (row.length !== w) {
      throw new Error(`heightmap row ${y} has length ${row.length}, expected ${w}`);
    }
    for (let x = 0; x < w; x++) {
      const ch = row[x]!;
      if (ch === "x") cells.push(null);
      else if (ch >= "0" && ch <= "9") cells.push(ch.charCodeAt(0) - 48);
      else throw new Error(`heightmap has invalid character '${ch}' at (${x}, ${y})`);
    }
  });
  const l = rows.length;
  return {
    w,
    l,
    height(x, y) {
      if (!Number.isInteger(x) || !Number.isInteger(y)) return null;
      if (x < 0 || y < 0 || x >= w || y >= l) return null;
      return cells[y * w + x] ?? null;
    },
  };
}
