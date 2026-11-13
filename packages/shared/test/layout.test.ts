import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  FURNI_CATALOG,
  Hotel,
  LayoutSchema,
  LayoutsFileSchema,
  applyLayout,
  baseRoomForProject,
  checkMove,
  footprintTiles,
  isPinned,
  layoutOf,
  layoutProblem,
  projectRoomId,
  resolveAnchor,
  roomForProject,
  useTile,
  validateRoom,
} from "../src/index.ts";
import type { Layout, Placement, RoomDef } from "../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const load = (file: string): RoomDef => validateRoom(JSON.parse(readFileSync(join(here, "..", "..", "world-server", "rooms", file), "utf8")));
const lobby = load("lobby.json");
const hr = load("hr.json");
const template = load("project-template.json");
const floor = baseRoomForProject(template, { id: "demo", name: "Demo" });

const piece = (room: RoomDef, id: string) => room.furni.find((p) => p.itemId === id)!;
const tilesOf = (room: RoomDef, id: string) => {
  const p = piece(room, id);
  return footprintTiles(p, FURNI_CATALOG[p.defId]!);
};
const move = (room: RoomDef, id: string, to: Placement, occupied?: { x: number; y: number }[]) =>
  checkMove(room, id, to, occupied ? { occupied } : {});

describe("the default layout of a project floor", () => {
  it("follows every rule of the arrange mode", () => {
    expect(layoutProblem(template)).toBeUndefined();
  });

  it("has at most five wall pieces on the north wall, and none of the pieces share a tile", () => {
    const north = template.furni.filter((p) => FURNI_CATALOG[p.defId]?.mount === "wall" && p.y === 0);
    expect(north.length).toBeGreaterThan(0);
    expect(north.length).toBeLessThanOrEqual(5);
    const seen = new Set<string>();
    for (const p of template.furni) {
      for (const t of footprintTiles(p, FURNI_CATALOG[p.defId]!)) {
        const k = `${t.x},${t.y}`;
        expect(seen.has(k), `${p.itemId} at ${k}`).toBe(false);
        seen.add(k);
      }
    }
  });

  it("puts the computer, mailbox and board close to the elevator, with the furniture on both walls and the floor", () => {
    const near = (id: string) => {
      const u = useTile(piece(template, id));
      return Math.max(Math.abs(u.x - template.door.x), Math.abs(u.y - template.door.y));
    };
    for (const id of ["computer_desk_1", "mailbox_1", "board_1"]) expect(near(id), id).toBeLessThanOrEqual(6);
    expect(template.furni.some((p) => p.x === 0 && p.itemId !== "elevator_1" && p.itemId !== "cobweb_1")).toBe(true);
    expect(template.furni.some((p) => p.y === 0)).toBe(true);
    expect(template.furni.some((p) => p.x > 1 && p.y > 1 && p.y < 9)).toBe(true);
  });

  it("every anchor that follows a piece is on the tile in front of it", () => {
    for (const a of template.anchors.filter((x) => x.follows)) {
      const u = useTile(piece(template, a.follows!));
      expect([a.x, a.y, a.dir], a.name).toEqual([u.x, u.y, (piece(template, a.follows!).dir + 4) % 8]);
    }
    expect(template.anchors.filter((a) => a.follows).map((a) => a.name).sort()).toEqual(["board", "computer", "desk", "desk", "desk", "mailbox"]);
  });

  it("a room whose anchor is not in front of the piece it follows is invalid", () => {
    const bad = { ...template, anchors: template.anchors.map((a) => (a.name === "mailbox" ? { ...a, x: 2 } : a)) };
    expect(() => validateRoom(bad)).toThrow(/follows/);
    const ghost = { ...template, anchors: template.anchors.map((a) => (a.name === "mailbox" ? { ...a, follows: "nothing" } : a)) };
    expect(() => validateRoom(ghost)).toThrow(/unknown piece/);
  });
});

describe("checkMove", () => {
  it("accepts a plant moved to a free tile, and gives back the new room without touching the old one", () => {
    const before = piece(floor, "plant_2");
    const r = move(floor, "plant_2", { x: 8, y: 8, dir: 4 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(piece(r.room, "plant_2")).toMatchObject({ x: 8, y: 8 });
    expect(piece(floor, "plant_2")).toEqual(before);
  });

  it.each([
    ["outside", "plant_2", { x: 12, y: 3, dir: 4 }, "That is outside the room."],
    ["outside", "plant_2", { x: -1, y: 3, dir: 4 }, "That is outside the room."],
    ["taken", "plant_2", { x: 4, y: 2, dir: 4 }, "That tile is taken."],
    ["taken", "sofa_1", { x: 9, y: 8, dir: 0 }, "That tile is taken."],
    ["wall", "library_shelf_1", { x: 6, y: 3, dir: 4 }, "This piece goes on a wall."],
    ["wall", "mailbox_1", { x: 0, y: 6, dir: 0 }, "This piece goes on a wall."],
    ["spot", "plant_2", { x: 6, y: 3, dir: 4 }, "A standing spot of the team is on that tile."],
    ["pinned", "elevator_1", { x: 0, y: 4, dir: 2 }, "The elevator stays where it is."],
    ["unknown_item", "nothing_1", { x: 3, y: 3, dir: 4 }, "That piece is not in this room."],
  ] as const)("refuses with %s: %s", (code, id, to, reason) => {
    const r = move(floor, id, to);
    expect(r).toEqual({ ok: false, code, reason });
  });

  it("refuses a piece that would stand on the tile in front of the mailbox, and says which path it blocks", () => {
    const r = move(floor, "plant_2", { x: 1, y: 6, dir: 4 });
    expect(r).toEqual({ ok: false, code: "blocks_path", reason: "Blocks the path to the mailbox." });
  });

  it("refuses the move that would shut the elevator in", () => {
    // The door tile is (1, 8). Three solid pieces on (1, 7), (2, 8) and (1, 9) close every step out of it.
    const first = move(floor, "plant_2", { x: 1, y: 7, dir: 4 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = move(first.room, "lamp_1", { x: 2, y: 8, dir: 4 });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const third = move(second.room, "jack_lamp_1", { x: 1, y: 9, dir: 4 });
    expect(third).toMatchObject({ ok: false, code: "blocks_path" });
    if (!third.ok) expect(third.reason).toMatch(/^Blocks the path to the .+\.$/);
  });

  it("says nobody could reach a piece that its own new place cuts off", () => {
    // A computer desk at (11, 5) facing east has its front tile outside the room.
    const r = move(floor, "computer_desk_1", { x: 11, y: 5, dir: 2 });
    expect(r).toEqual({ ok: false, code: "blocks_path", reason: "Nobody could reach the computer desk from there." });
  });

  it("refuses a solid piece on a tile where someone stands or walks, but lets a chair go there", () => {
    const people = [{ x: 8, y: 8 }];
    expect(move(floor, "plant_2", { x: 8, y: 8, dir: 4 }, people)).toEqual({ ok: false, code: "occupied", reason: "Someone is standing there." });
    expect(move(floor, "chair_1", { x: 8, y: 8, dir: 4 }, people).ok).toBe(true);
  });

  it("never moves the elevator or the door, in any floor", () => {
    expect(isPinned(FURNI_CATALOG["elevator"])).toBe(true);
    expect(isPinned(FURNI_CATALOG["door"])).toBe(true);
    expect(isPinned(FURNI_CATALOG["plant"])).toBe(false);
    for (const room of [lobby, hr]) {
      const lift = room.furni.find((p) => p.defId === "elevator")!;
      expect(checkMove(room, lift.itemId, { x: 5, y: 5, dir: 2 })).toMatchObject({ ok: false, code: "pinned" });
    }
  });

  it("a desk that moves takes its seat with it, facing the desk", () => {
    const r = move(floor, "desk_architect", { x: 8, y: 7, dir: 2 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(resolveAnchor(r.room, "desk", "architect")).toMatchObject({ x: 9, y: 7, dir: 6 });
    // The standing spots stay where they were.
    expect(resolveAnchor(r.room, "home", "architect")).toEqual(resolveAnchor(floor, "home", "architect"));
    expect(layoutProblem(r.room)).toBeUndefined();
  });

  it("rotating the computer desk moves the anchor to its new front", () => {
    const r = move(floor, "computer_desk_1", { x: 3, y: 7, dir: 4 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(resolveAnchor(r.room, "computer")).toMatchObject({ x: 3, y: 8, dir: 0 });
    expect(tilesOf(r.room, "computer_desk_1")).toEqual([{ x: 3, y: 7 }, { x: 4, y: 7 }]);
  });

  it("a wall piece can go from the north wall to the west wall by turning to face east", () => {
    const r = move(floor, "library_shelf_1", { x: 0, y: 1, dir: 2 });
    expect(r.ok).toBe(true);
  });
});

describe("layouts", () => {
  const plantAway: Layout = { plant_2: { x: 8, y: 8, dir: 4 }, desk_qa: { x: 10, y: 6, dir: 6 } };

  it("layoutOf keeps only the pieces that moved, and applyLayout is its inverse", () => {
    const { room, skipped } = applyLayout(floor, plantAway);
    expect(skipped).toEqual([]);
    expect(layoutOf(floor, room)).toEqual(plantAway);
    expect(layoutOf(floor, floor)).toEqual({});
  });

  it("applying a saved layout never throws and leaves a valid room", () => {
    const { room } = applyLayout(floor, plantAway);
    expect(layoutProblem(room)).toBeUndefined();
    expect(resolveAnchor(room, "desk", "qa")).toMatchObject({ x: 9, y: 6 });
  });

  it("a layout that no longer fits falls back to the template for that piece", () => {
    const stale: Layout = {
      plant_2: { x: 8, y: 8, dir: 4 },
      // Same tile as the plant above: the second one cannot go there.
      plant_1: { x: 8, y: 8, dir: 4 },
      // Not in the room, and the elevator: both ignored.
      ghost_9: { x: 3, y: 3, dir: 4 },
      elevator_1: { x: 5, y: 5, dir: 2 },
    };
    const { room, skipped } = applyLayout(floor, stale);
    expect(piece(room, "plant_2")).toMatchObject({ x: 8, y: 8 });
    expect(piece(room, "plant_1")).toMatchObject({ x: 11, y: 0 });
    expect(piece(room, "elevator_1")).toMatchObject({ x: 0, y: 8 });
    expect(skipped).toEqual(["plant_1"]);
    expect(layoutProblem(room)).toBeUndefined();
  });

  it("two pieces that swap places are accepted as a whole, though neither move fits alone", () => {
    const swap: Layout = { plant_1: { x: 1, y: 0, dir: 4 }, plant_3: { x: 11, y: 0, dir: 4 } };
    const { room, skipped } = applyLayout(floor, swap);
    expect(skipped).toEqual([]);
    expect(piece(room, "plant_1")).toMatchObject({ x: 1, y: 0 });
    expect(piece(room, "plant_3")).toMatchObject({ x: 11, y: 0 });
  });

  it("roomForProject builds a floor from the template and a layout", () => {
    const room = roomForProject(template, { id: "demo", name: "Demo" }, plantAway);
    expect(piece(room, "plant_2")).toMatchObject({ x: 8, y: 8 });
    expect(roomForProject(template, { id: "demo", name: "Demo" }).furni).toEqual(floor.furni);
  });

  it("the schemas accept a layout and refuse bad ids, directions and sizes", () => {
    expect(LayoutSchema.safeParse(plantAway).success).toBe(true);
    expect(LayoutSchema.safeParse({ "bad id": { x: 1, y: 1, dir: 4 } }).success).toBe(false);
    expect(LayoutSchema.safeParse({ plant_2: { x: 1, y: 1, dir: 1 } }).success).toBe(false);
    expect(LayoutSchema.safeParse({ plant_2: { x: 1.5, y: 1, dir: 4 } }).success).toBe(false);
    const many = Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`p${i}`, { x: 1, y: 1, dir: 4 }]));
    expect(LayoutSchema.safeParse(many).success).toBe(false);
    expect(LayoutsFileSchema.safeParse({ demo: plantAway }).success).toBe(true);
    expect(LayoutsFileSchema.safeParse({ "Not A Project": plantAway }).success).toBe(false);
    expect(LayoutsFileSchema.safeParse([]).success).toBe(false);
  });
});

describe("arranging in the hotel", () => {
  function makeHotel(layoutOfProject?: (id: string) => Layout | undefined) {
    let t = 1_000_000;
    const hotel = new Hotel({
      lobby,
      hr,
      template,
      clock: () => t,
      sim: { msPerTile: 10 },
      startRoom: projectRoomId("demo"),
      ...(layoutOfProject ? { layoutOf: layoutOfProject } : {}),
    });
    hotel.addProject({ id: "demo", name: "Demo" });
    return { hotel, advance: (ms: number) => (t += ms), room: projectRoomId("demo") };
  }

  it("moves a piece in the simulation and reports the new layout to `save`", () => {
    const { hotel, room } = makeHotel();
    const saved: Layout[] = [];
    const r = hotel.moveFurniture(room, "plant_2", { x: 8, y: 8, dir: 4 }, (l) => saved.push(l));
    expect(r.ok).toBe(true);
    expect(saved).toEqual([{ plant_2: { x: 8, y: 8, dir: 4 } }]);
    expect(piece(hotel.sim(room)!.room, "plant_2")).toMatchObject({ x: 8, y: 8 });
  });

  it("a refused move calls nothing and changes nothing", () => {
    const { hotel, room } = makeHotel();
    let called = false;
    const r = hotel.moveFurniture(room, "plant_2", { x: 4, y: 2, dir: 4 }, () => (called = true));
    expect(r).toMatchObject({ ok: false, code: "taken" });
    expect(called).toBe(false);
    expect(piece(hotel.sim(room)!.room, "plant_2")).toMatchObject({ x: 9, y: 8 });
  });

  it("when saving fails the floor stays as it was", () => {
    const { hotel, room } = makeHotel();
    const r = hotel.moveFurniture(room, "plant_2", { x: 8, y: 8, dir: 4 }, () => {
      throw new Error("disk full");
    });
    expect(r).toMatchObject({ ok: false, code: "save_failed" });
    expect(piece(hotel.sim(room)!.room, "plant_2")).toMatchObject({ x: 9, y: 8 });
  });

  it("the lobby and the HR office cannot be arranged", () => {
    const { hotel } = makeHotel();
    for (const id of ["lobby", "hr", "project:nope"]) {
      expect(hotel.moveFurniture(id, "plant_1", { x: 3, y: 3, dir: 4 })).toMatchObject({ ok: false, code: "not_editable" });
      expect(hotel.resetLayout(id)).toMatchObject({ ok: false, code: "not_editable" });
    }
  });

  it("a piece cannot go where somebody stands or is walking to", () => {
    const { hotel, room, advance } = makeHotel();
    hotel.join();
    const sim = hotel.sim(room)!;
    sim.handleIntent(1, { type: "move", x: 8, y: 8 });
    advance(5);
    expect(hotel.moveFurniture(room, "plant_1", { x: 8, y: 8, dir: 4 })).toMatchObject({ ok: false, code: "occupied" });
  });

  it("a floor built with a saved layout has it, and reset brings the template back", () => {
    const { hotel, room } = makeHotel((id) => (id === "demo" ? { plant_2: { x: 8, y: 8, dir: 4 } } : undefined));
    expect(piece(hotel.sim(room)!.room, "plant_2")).toMatchObject({ x: 8, y: 8 });
    const saved: Layout[] = [];
    const r = hotel.resetLayout(room, (l) => saved.push(l));
    expect(r.ok).toBe(true);
    expect(saved).toEqual([{}]);
    expect(piece(hotel.sim(room)!.room, "plant_2")).toMatchObject({ x: 9, y: 8 });
  });

  it("the path grid follows the move: the avatar can walk where the plant was and not where it is", () => {
    const { hotel, room } = makeHotel();
    hotel.join();
    const sim = hotel.sim(room)!;
    expect(sim.handleIntent(1, { type: "move", x: 9, y: 8 })[0]).toMatchObject({ type: "error", code: "no_path" });
    expect(hotel.moveFurniture(room, "plant_2", { x: 8, y: 8, dir: 4 }).ok).toBe(true);
    expect(sim.handleIntent(1, { type: "move", x: 9, y: 8 })[0]).toMatchObject({ type: "walk" });
    expect(sim.handleIntent(1, { type: "move", x: 8, y: 8 })[0]).toMatchObject({ type: "error", code: "no_path" });
  });
});

describe("property: any sequence of moves leaves a valid floor", () => {
  const movable = floor.furni.filter((p) => !isPinned(FURNI_CATALOG[p.defId])).map((p) => p.itemId);
  const placement = fc.record({
    x: fc.integer({ min: -2, max: 13 }),
    y: fc.integer({ min: -2, max: 11 }),
    dir: fc.constantFrom(0 as const, 2 as const, 4 as const, 6 as const),
  });
  const step = fc.record({ id: fc.constantFrom(...movable), to: placement });

  it("keeps everything reachable from the elevator and no two pieces on one tile", () => {
    let accepted = 0;
    fc.assert(
      fc.property(fc.array(step, { minLength: 1, maxLength: 40 }), (steps) => {
        let room = floor;
        for (const { id, to } of steps) {
          const r = checkMove(room, id, to);
          if (!r.ok) {
            expect(r.reason.length).toBeGreaterThan(0);
            continue;
          }
          room = r.room;
          accepted++;
          // Every accepted move leaves a valid room.
          expect(layoutProblem(room)).toBeUndefined();
        }
        const tiles = new Set<string>();
        for (const p of room.furni) {
          for (const t of footprintTiles(p, FURNI_CATALOG[p.defId]!)) {
            const k = `${t.x},${t.y}`;
            expect(tiles.has(k)).toBe(false);
            tiles.add(k);
          }
        }
        // The pinned pieces and the fixed anchors never moved.
        expect(piece(room, "elevator_1")).toEqual(piece(floor, "elevator_1"));
        expect(room.door).toEqual(floor.door);
        for (const a of floor.anchors.filter((x) => !x.follows)) expect(room.anchors).toContainEqual(a);
        // A saved layout of the result rebuilds the same room.
        expect(applyLayout(floor, layoutOf(floor, room)).room.furni).toEqual(room.furni);
      }),
      { numRuns: 150 },
    );
    // Not vacuous: plenty of the random moves were allowed.
    expect(accepted).toBeGreaterThan(100);
  });
});
