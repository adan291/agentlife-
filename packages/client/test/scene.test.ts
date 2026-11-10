import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { FURNI_CATALOG, footprintSize, tileToScreen, validateRoom } from "@agentlife/shared";
import type { RoomDef } from "@agentlife/shared";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { viewFor } from "../src/scene/figure.ts";
import { pickFurni } from "../src/scene/pick.ts";
import { RECIPES } from "../src/scene/recipes.ts";
import { BUBBLE_MAX_MS, BUBBLE_MIN_MS, bubbleDurationMs, shortStatus } from "../src/scene/timing.ts";
import { poseAt } from "../src/scene/walk-anim.ts";
import { chooseZoom } from "../src/scene/zoom.ts";

const here = dirname(fileURLToPath(import.meta.url));
const room: RoomDef = validateRoom(
  JSON.parse(readFileSync(join(here, "..", "..", "world-server", "rooms", "office.json"), "utf8")),
);

describe("viewFor", () => {
  it("draws 5 views and mirrors 3", () => {
    const results = [0, 1, 2, 3, 4, 5, 6, 7].map(viewFor);
    expect(new Set(results.map((r) => r.view)).size).toBe(5);
    expect(results.filter((r) => r.mirror).length).toBe(3);
  });

  it("mirrors exactly the directions whose screen mirror is another direction", () => {
    // A horizontal screen mirror swaps dx and dy of the logical direction.
    const vec = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]] as const;
    for (let d = 0; d < 8; d++) {
      const { view, mirror } = viewFor(d);
      const [dx, dy] = vec[d]!;
      const target = vec.findIndex(([x, y]) => x === dy && y === dx);
      if (mirror) expect(view).toBe(target);
      else expect(view).toBe(d);
    }
  });
});

describe("poseAt", () => {
  const walk = { origin: { x: 0, y: 0 }, path: [{ x: 1, y: 0 }, { x: 2, y: 0 }], startedAt: 1000, msPerTile: 400 };

  it("is at the origin before the walk starts and faces the first step", () => {
    const p = poseAt(walk, 900);
    expect([p.x, p.y, p.moving, p.finished, p.dir]).toEqual([0, 0, false, false, 2]);
  });

  it("interpolates between tiles", () => {
    const p = poseAt(walk, 1200);
    expect(p.x).toBeCloseTo(0.5);
    expect(p.moving).toBe(true);
    expect(p.tile).toEqual({ x: 0, y: 0 });
  });

  it("ends on the last tile", () => {
    const p = poseAt(walk, 5000);
    expect([p.x, p.y, p.finished, p.moving]).toEqual([2, 0, true, false]);
  });

  it("stays between the two tiles of the current step (property)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 3000 }), (dt) => {
        const p = poseAt(walk, 1000 + dt);
        return p.x >= 0 && p.x <= 2 && p.y === 0;
      }),
    );
  });

  it("an empty path is finished at the origin", () => {
    expect(poseAt({ ...walk, path: [] }, 2000).finished).toBe(true);
  });
});

describe("bubble timing", () => {
  it("is between 4 and 8 seconds and grows with length", () => {
    expect(bubbleDurationMs("hi")).toBe(BUBBLE_MIN_MS);
    expect(bubbleDurationMs("x".repeat(300))).toBe(BUBBLE_MAX_MS);
    fc.assert(
      fc.property(fc.string({ maxLength: 300 }), fc.string({ maxLength: 300 }), (a, b) => {
        const da = bubbleDurationMs(a);
        const db = bubbleDurationMs(b);
        return da >= BUBBLE_MIN_MS && da <= BUBBLE_MAX_MS && (a.length <= b.length ? da <= db : da >= db);
      }),
    );
  });

  it("shortens status text", () => {
    expect(shortStatus("  a   b ")).toBe("a b");
    expect(shortStatus("x".repeat(60)).length).toBe(28);
  });
});

describe("chooseZoom", () => {
  it("uses 2x only when the room fits", () => {
    expect(chooseZoom(704, 430, 1920, 1000)).toBe(2);
    expect(chooseZoom(704, 430, 1280, 720)).toBe(1);
  });
});

describe("pickFurni", () => {
  const byId = (id: string) => room.furni.find((f) => f.itemId === id)!;

  it("finds an interactive item by its footprint tile and by its upper part", () => {
    const mb = byId("mailbox_1");
    const base = tileToScreen({ x: mb.x, y: mb.y });
    expect(pickFurni(room, base.sx, base.sy)?.itemId).toBe("mailbox_1");
    // Above the footprint, on the tall body of the mailbox.
    expect(pickFurni(room, base.sx, base.sy - 2.2 * 16)?.itemId).toBe("mailbox_1");
  });

  it("returns nothing on empty floor and ignores walkable decoration", () => {
    const empty = tileToScreen({ x: 6, y: 5 });
    expect(pickFurni(room, empty.sx, empty.sy)).toBeUndefined();
    const chair = byId("chair_1");
    const c = tileToScreen({ x: chair.x, y: chair.y });
    expect(pickFurni(room, c.sx, c.sy)).toBeUndefined();
  });

  it("picks every non-walkable furniture tile (property)", () => {
    for (const p of room.furni) {
      const def = FURNI_CATALOG[p.defId]!;
      if (def.walkable) continue;
      const { w, l } = footprintSize(def, p.dir);
      for (let dx = 0; dx < w; dx++) {
        for (let dy = 0; dy < l; dy++) {
          const s = tileToScreen({ x: p.x + dx, y: p.y + dy });
          const hit = pickFurni(room, s.sx, s.sy);
          expect(hit).toBeDefined();
        }
      }
    }
  });
});

describe("draw recipes", () => {
  /** A Graphics stand-in that accepts any drawing call and records the method names. */
  function fakeGraphics() {
    const calls: string[] = [];
    const g: unknown = new Proxy(
      {},
      {
        get(_t, name) {
          calls.push(String(name));
          return () => g;
        },
      },
    );
    return { g: g as import("pixi.js").Graphics, calls };
  }

  it("has a recipe for every catalog item, in every facing, that draws something", () => {
    for (const def of Object.values(FURNI_CATALOG)) {
      const recipe = RECIPES[def.draw];
      expect(recipe, `recipe for ${def.id}`).toBeDefined();
      for (const dir of [0, 2, 4, 6] as const) {
        const { g, calls } = fakeGraphics();
        const { w, l } = footprintSize(def, dir);
        recipe!(g, { w, l, dir, height: def.height });
        expect(calls.length).toBeGreaterThan(0);
      }
    }
  });

  it("covers the spooky decoration required by the spec", () => {
    expect(RECIPES["jack_o_lantern_lamp"]).toBeDefined();
    expect(RECIPES["cobweb"]).toBeDefined();
  });
});
