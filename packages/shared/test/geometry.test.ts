import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  LAYER,
  depthKey,
  parseHeightmap,
  screenToTile,
  tileToScreen,
} from "../src/index.ts";

describe("projection", () => {
  it("projects known tiles at 64x32", () => {
    expect(tileToScreen({ x: 0, y: 0 })).toEqual({ sx: 0, sy: 0 });
    expect(tileToScreen({ x: 1, y: 0 })).toEqual({ sx: 32, sy: 16 });
    expect(tileToScreen({ x: 0, y: 1 })).toEqual({ sx: -32, sy: 16 });
    expect(tileToScreen({ x: 2, y: 2, z: 1 })).toEqual({ sx: 0, sy: 64 - 16 });
  });

  it("round-trips every tile", () => {
    fc.assert(
      fc.property(fc.integer({ min: -50, max: 50 }), fc.integer({ min: -50, max: 50 }), (x, y) => {
        const { sx, sy } = tileToScreen({ x, y });
        expect(screenToTile(sx, sy)).toEqual({ x, y });
      }),
    );
  });

  it("maps points inside a tile diamond back to that tile", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -30, max: 30 }),
        fc.integer({ min: -30, max: 30 }),
        fc.double({ min: -0.45, max: 0.45, noNaN: true }),
        fc.double({ min: -0.45, max: 0.45, noNaN: true }),
        (x, y, dx, dy) => {
          const { sx, sy } = tileToScreen({ x: x + dx, y: y + dy });
          expect(screenToTile(sx, sy)).toEqual({ x, y });
        },
      ),
    );
  });
});

describe("parseHeightmap", () => {
  it("parses heights and voids", () => {
    const hm = parseHeightmap(["0x1", "239"]);
    expect(hm.w).toBe(3);
    expect(hm.l).toBe(2);
    expect(hm.height(0, 0)).toBe(0);
    expect(hm.height(1, 0)).toBeNull();
    expect(hm.height(2, 0)).toBe(1);
    expect(hm.height(2, 1)).toBe(9);
  });

  it("returns null outside the grid", () => {
    const hm = parseHeightmap(["00"]);
    expect(hm.height(-1, 0)).toBeNull();
    expect(hm.height(2, 0)).toBeNull();
    expect(hm.height(0, 1)).toBeNull();
  });

  it("rejects ragged rows, bad characters and empty maps", () => {
    expect(() => parseHeightmap(["00", "0"])).toThrow(/row 1/);
    expect(() => parseHeightmap(["0a"])).toThrow(/invalid character/);
    expect(() => parseHeightmap([])).toThrow();
  });
});

describe("depthKey", () => {
  const rect = fc.record({
    x: fc.integer({ min: 0, max: 20 }),
    y: fc.integer({ min: 0, max: 20 }),
    w: fc.integer({ min: 1, max: 4 }),
    l: fc.integer({ min: 1, max: 4 }),
    z: fc.integer({ min: 0, max: 9 }),
  });

  it("orders avatar above furniture on the same tile", () => {
    expect(depthKey({ x: 2, y: 3, layer: LAYER.avatar })).toBeGreaterThan(
      depthKey({ x: 2, y: 3, layer: LAYER.furni }),
    );
  });

  it("uses the front-most tile of multi-tile furniture", () => {
    expect(depthKey({ x: 1, y: 1, w: 2, l: 2, layer: LAYER.furni })).toBe(
      depthKey({ x: 2, y: 2, layer: LAYER.furni }),
    );
  });

  it("draws a footprint that is entirely behind another first", () => {
    fc.assert(
      fc.property(rect, rect, (a, b) => {
        const aMaxX = a.x + a.w - 1;
        const aMaxY = a.y + a.l - 1;
        const bMaxX = b.x + b.w - 1;
        const bMaxY = b.y + b.l - 1;
        const behind =
          (aMaxX < b.x && aMaxY <= bMaxY) || (aMaxY < b.y && aMaxX <= bMaxX);
        fc.pre(behind);
        expect(depthKey({ ...a, layer: LAYER.furni })).toBeLessThan(
          depthKey({ ...b, layer: LAYER.furni }),
        );
      }),
    );
  });
});
