import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { MOTE_COUNT, flicker, isFlameItem, moteAt } from "../src/scene/ambient-fx.ts";
import { moonlightQuads, roomBounds } from "../src/scene/room-view.ts";

describe("flame flicker", () => {
  it("stays between 0.55 and 1", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2_000_000_000 }), fc.double({ min: 0, max: 1000, noNaN: true }), (now, seed) => {
        const v = flicker(now, seed, false);
        expect(v).toBeGreaterThanOrEqual(0.55);
        expect(v).toBeLessThanOrEqual(1);
      }),
    );
  });

  it("is steady when motion is reduced", () => {
    expect(flicker(0, 1, true)).toBe(flicker(99_999, 7, true));
  });

  it("moves, and two seeds are not in step", () => {
    const a = [0, 50, 100, 150].map((t) => flicker(t, 1, false));
    expect(new Set(a).size).toBeGreaterThan(1);
    expect(flicker(500, 1, false)).not.toBe(flicker(500, 40, false));
  });

  it("only the lamps have a flame", () => {
    expect(isFlameItem("lamp")).toBe(true);
    expect(isFlameItem("jack_o_lantern_lamp")).toBe(true);
    expect(isFlameItem("sofa")).toBe(false);
  });
});

describe("wisps", () => {
  const bounds = roomBounds(12, 10);

  it("stay inside the room (sway included) with a valid alpha, at any time", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: MOTE_COUNT - 1 }), fc.integer({ min: 0, max: 2_000_000_000 }), (i, now) => {
        const m = moteAt(i, now, bounds);
        expect(m.x).toBeGreaterThanOrEqual(bounds.minX - 11);
        expect(m.x).toBeLessThanOrEqual(bounds.maxX + 11);
        expect(m.y).toBeGreaterThanOrEqual(bounds.minY - 1);
        expect(m.y).toBeLessThanOrEqual(bounds.maxY + 1);
        expect(m.alpha).toBeGreaterThanOrEqual(0);
        expect(m.alpha).toBeLessThanOrEqual(0.5);
        expect(m.radius).toBeGreaterThan(0);
      }),
    );
  });

  it("are deterministic and rise over time", () => {
    expect(moteAt(3, 12_345, bounds)).toEqual(moteAt(3, 12_345, bounds));
    expect(moteAt(3, 3_000, bounds).y).not.toBe(moteAt(3, 3_500, bounds).y);
  });
});

describe("moonlight", () => {
  it("falls on the floor only, for rooms of any size", () => {
    fc.assert(
      fc.property(fc.integer({ min: 4, max: 30 }), fc.integer({ min: 4, max: 30 }), (w, l) => {
        for (const quad of moonlightQuads(w, l)) {
          expect(quad).toHaveLength(4);
          for (const [x, y] of quad) {
            expect(x).toBeGreaterThanOrEqual(-0.5);
            expect(x).toBeLessThanOrEqual(w - 0.5);
            expect(y).toBeGreaterThanOrEqual(-0.5);
            expect(y).toBeLessThanOrEqual(l - 0.5);
          }
        }
      }),
    );
  });
});
