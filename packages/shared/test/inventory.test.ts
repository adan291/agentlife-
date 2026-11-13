import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  CatalogueFileSchema,
  SHOP_INTERACTIONS,
  ClientMsgSchema,
  FURNI_CATALOG,
  Hotel,
  InventoryFileSchema,
  PLACED_PER_FLOOR_MAX,
  addExtras,
  baseRoomForProject,
  emptyInventory,
  floorsWithPieces,
  furniOf,
  isBoughtId,
  layoutProblem,
  movePlaced,
  pickUpToStock,
  piecesOf,
  placeFromStock,
  projectRoomId,
  returnFloors,
  returnHidden,
  roomForProject,
  stockCount,
  validateRoom,
} from "../src/index.ts";
import type { Inventory, PlacedFurni, RoomDef } from "../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const load = (file: string): RoomDef => validateRoom(JSON.parse(readFileSync(join(here, "..", "..", "world-server", "rooms", file), "utf8")));
const lobby = load("lobby.json");
const hr = load("hr.json");
const template = load("project-template.json");
const items = CatalogueFileSchema.parse(JSON.parse(readFileSync(join(here, "..", "..", "world-server", "config", "catalogue-furni.json"), "utf8"))).items;

const stocked = (stock: Record<string, number>): Inventory => ({ ...emptyInventory(), stock });
const south = (x: number, y: number) => ({ x, y, dir: 4 as const });

describe("placeFromStock, pickUpToStock, movePlaced", () => {
  it("takes one item out of the stock and numbers the piece; ids are never reused", () => {
    const first = placeFromStock(stocked({ fern: 2 }), "demo", "fern", south(2, 1));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.piece).toEqual({ id: "bought_1", itemId: "fern", x: 2, y: 1, dir: 4 });
    expect(first.inventory.stock).toEqual({ fern: 1 });
    expect(first.inventory.seq).toBe(1);
    const back = pickUpToStock(first.inventory, "demo", "bought_1");
    expect(back.ok && back.inventory.stock).toEqual({ fern: 2 });
    expect(back.ok && piecesOf(back.inventory, "demo")).toEqual([]);
    const again = back.ok ? placeFromStock(back.inventory, "demo", "fern", south(3, 1)) : back;
    expect(again.ok && again.piece.id).toBe("bought_2");
  });

  it("drops the stock entry of the last item, and refuses an item that is not in stock", () => {
    const r = placeFromStock(stocked({ fern: 1 }), "demo", "fern", south(2, 1));
    expect(r.ok && r.inventory.stock).toEqual({});
    expect(placeFromStock(stocked({}), "demo", "fern", south(2, 1))).toEqual({ ok: false, reason: "You do not have that item." });
    expect(placeFromStock(stocked({ fern: 1 }), "demo", "constructor", south(2, 1)).ok).toBe(false);
  });

  it("holds at most 60 placed pieces on a floor", () => {
    let inv = stocked({ fern: PLACED_PER_FLOOR_MAX + 1 });
    for (let i = 0; i < PLACED_PER_FLOOR_MAX; i++) {
      const r = placeFromStock(inv, "demo", "fern", south(i % 12, 1));
      if (!r.ok) throw new Error(r.reason);
      inv = r.inventory;
    }
    expect(placeFromStock(inv, "demo", "fern", south(0, 2))).toEqual({ ok: false, reason: `This floor is full (${PLACED_PER_FLOOR_MAX} placed pieces).` });
    // Another floor has its own room.
    expect(placeFromStock(inv, "other", "fern", south(0, 2)).ok).toBe(true);
  });

  it("moves a placed piece and refuses one that is not yours", () => {
    const placed = placeFromStock(stocked({ fern: 1 }), "demo", "fern", south(2, 1));
    if (!placed.ok) throw new Error("place");
    const moved = movePlaced(placed.inventory, "demo", "bought_1", { x: 5, y: 5, dir: 2 });
    expect(moved.ok && piecesOf(moved.inventory, "demo")).toEqual([{ id: "bought_1", itemId: "fern", x: 5, y: 5, dir: 2 }]);
    expect(movePlaced(placed.inventory, "demo", "plant_2", south(1, 1))).toEqual({ ok: false, reason: "That piece is not one of yours." });
    expect(movePlaced(placed.inventory, "other", "bought_1", south(1, 1)).ok).toBe(false);
    expect(pickUpToStock(placed.inventory, "demo", "desk_architect").ok).toBe(false);
  });

  it("does not change the inventory it was given", () => {
    const inv = stocked({ fern: 1 });
    const copy = JSON.parse(JSON.stringify(inv));
    placeFromStock(inv, "demo", "fern", south(2, 1));
    expect(inv).toEqual(copy);
  });
});

describe("returning pieces", () => {
  const withTwoFloors = (): Inventory => {
    let inv = stocked({ fern: 3 });
    for (const [project, x] of [["a", 1], ["a", 2], ["b", 3]] as const) {
      const r = placeFromStock(inv, project, "fern", south(x, 1));
      if (!r.ok) throw new Error(r.reason);
      inv = r.inventory;
    }
    return inv;
  };

  it("a removed project gives its pieces back and leaves the other floors alone", () => {
    const inv = withTwoFloors();
    expect(floorsWithPieces(inv).sort()).toEqual(["a", "b"]);
    const out = returnFloors(inv, ["a"]);
    expect(out.stock).toEqual({ fern: 2 });
    expect(piecesOf(out, "a")).toEqual([]);
    expect(piecesOf(out, "b")).toHaveLength(1);
    expect(returnFloors(inv, ["nobody"])).toBe(inv);
  });

  it("may take the stock above the purchase cap: what comes back always fits the file", () => {
    const inv = withTwoFloors();
    const out = returnFloors({ ...inv, stock: { fern: 200 } }, ["a", "b"]);
    expect(out.stock).toEqual({ fern: 203 });
    expect(InventoryFileSchema.safeParse({ version: 1, stock: out.stock, placed: out.placed, seq: out.seq }).success).toBe(true);
  });

  it("pieces the floor does not show go back to the stock", () => {
    const inv = withTwoFloors();
    const out = returnHidden(inv, "a", new Set(["bought_1"]));
    expect(piecesOf(out, "a").map((p) => p.id)).toEqual(["bought_1"]);
    expect(out.stock).toEqual({ fern: 1 });
    expect(returnHidden(inv, "a", new Set(["bought_1", "bought_2"]))).toBe(inv);
  });
});

describe("the inventory file", () => {
  it("a file written before pieces could be placed stays valid and gets empty defaults", () => {
    expect(InventoryFileSchema.parse({ version: 1, stock: { fern: 2 } })).toEqual({ version: 1, stock: { fern: 2 }, placed: {}, seq: 0 });
  });

  it("checks placed pieces: ids, items, directions and the count per floor", () => {
    const piece = { id: "bought_1", itemId: "fern", x: 1, y: 1, dir: 4 };
    const ok = (placed: unknown) => InventoryFileSchema.safeParse({ version: 1, stock: {}, placed, seq: 1 }).success;
    expect(ok({ demo: [piece] })).toBe(true);
    expect(ok({ demo: [{ ...piece, id: "plant_2" }] })).toBe(false);
    expect(ok({ demo: [{ ...piece, dir: 3 }] })).toBe(false);
    expect(ok({ demo: [{ ...piece, itemId: "../x" }] })).toBe(false);
    expect(ok({ "Bad Project": [piece] })).toBe(false);
    expect(ok({ demo: [] })).toBe(false);
    expect(ok({ demo: Array.from({ length: PLACED_PER_FLOOR_MAX + 1 }, () => piece) })).toBe(false);
  });

  it("knows a bought id from an id of the template", () => {
    expect(isBoughtId("bought_1")).toBe(true);
    expect(isBoughtId("bought_")).toBe(false);
    expect(isBoughtId("bought_1x")).toBe(false);
    for (const p of template.furni) expect(isBoughtId(p.itemId)).toBe(false);
  });

  it("accepts the two new client messages", () => {
    expect(ClientMsgSchema.safeParse({ type: "furni_place", itemId: "fern", x: 2, y: 1, dir: 4 }).success).toBe(true);
    expect(ClientMsgSchema.safeParse({ type: "furni_place", itemId: "../x", x: 2, y: 1, dir: 4 }).success).toBe(false);
    expect(ClientMsgSchema.safeParse({ type: "furni_place", itemId: "fern", x: 2, y: 1, dir: 3 }).success).toBe(false);
    expect(ClientMsgSchema.safeParse({ type: "furni_pickup", itemId: "bought_1" }).success).toBe(true);
    expect(ClientMsgSchema.safeParse({ type: "furni_pickup", itemId: "" }).success).toBe(false);
  });
});

describe("the hotel places and picks up bought pieces", () => {
  const roomId = projectRoomId("demo");
  const fern = (id: string, x: number, y: number, dir: 0 | 2 | 4 | 6 = 4): PlacedFurni => ({ itemId: id, defId: "fern", x, y, dir });
  const hotelWith = () => {
    const h = new Hotel({ lobby, hr, template, clock: () => 0 });
    h.addProject({ id: "demo", name: "Demo" });
    return h;
  };

  it("places a piece through the checks of a move, saves before it changes, and keeps the template layout empty", () => {
    const h = hotelWith();
    const seen: unknown[] = [];
    const r = h.placeFurniture(roomId, fern("bought_1", 2, 1), (layout) => seen.push(layout));
    expect(r.ok).toBe(true);
    expect(seen).toEqual([{}]);
    expect(h.sim(roomId)!.room.furni.some((p) => p.itemId === "bought_1")).toBe(true);
    expect(h.isExtra(roomId, "bought_1")).toBe(true);
    expect(h.isExtra(roomId, "plant_2")).toBe(false);
    expect(layoutProblem(h.sim(roomId)!.room)).toBeUndefined();
  });

  it.each([
    [fern("bought_1", 9, 8), "That tile is taken by the potted plant."],
    [fern("bought_1", 30, 30), "That is outside the room."],
    [fern("bought_1", 5, 3), "A standing spot of the team is on that tile."],
  ])("refuses a spot that a move would refuse (%#)", (piece, reason) => {
    const h = hotelWith();
    const before = h.sim(roomId)!.room.furni.length;
    const r = h.placeFurniture(roomId, piece, () => {
      throw new Error("must not save");
    });
    expect(r).toMatchObject({ ok: false, reason });
    expect(h.sim(roomId)!.room.furni).toHaveLength(before);
  });

  it("a wall piece may stand free on the floor; against a wall it faces the room", () => {
    const h = hotelWith();
    const clock = (x: number, y: number, dir: 0 | 2 | 4 | 6) => ({ itemId: "bought_1", defId: "wall_clock", x, y, dir });
    expect(h.placeFurniture(roomId, clock(6, 5, 4)).ok).toBe(true);
    expect(h.moveFurniture(roomId, "bought_1", { x: 6, y: 5, dir: 6 }).ok).toBe(true);
    expect(h.moveFurniture(roomId, "bought_1", { x: 2, y: 0, dir: 6 })).toMatchObject({ ok: false, code: "wall" });
    expect(h.moveFurniture(roomId, "bought_1", { x: 2, y: 0, dir: 4 }).ok).toBe(true);
  });

  it("refuses a floor piece the user does not own the use of", () => {
    const h = hotelWith();
    // Furniture that starts work or belongs to the template cannot be placed from the inventory.
    expect(h.placeFurniture(roomId, { itemId: "bought_2", defId: "mailbox", x: 2, y: 3, dir: 4 })).toMatchObject({ ok: false, code: "unknown_item" });
    expect(h.placeFurniture(roomId, { itemId: "bought_3", defId: "agent_desk", x: 2, y: 3, dir: 4 })).toMatchObject({ ok: false, code: "unknown_item" });
    expect(h.placeFurniture(roomId, { itemId: "bought_4", defId: "no_such_def", x: 2, y: 3, dir: 4 })).toMatchObject({ ok: false, code: "unknown_item" });
  });

  it("refuses a piece that is already on the floor, in the lobby and on a floor that does not exist", () => {
    const h = hotelWith();
    expect(h.placeFurniture(roomId, fern("bought_1", 2, 1)).ok).toBe(true);
    expect(h.placeFurniture(roomId, fern("bought_1", 3, 1))).toMatchObject({ ok: false, code: "duplicate" });
    expect(h.placeFurniture("lobby", fern("bought_2", 2, 1))).toMatchObject({ ok: false, code: "not_editable" });
    expect(h.placeFurniture("hr", fern("bought_2", 2, 1))).toMatchObject({ ok: false, code: "not_editable" });
    expect(h.placeFurniture("project:nobody", fern("bought_2", 2, 1))).toMatchObject({ ok: false, code: "not_editable" });
  });

  it("blocks a piece that would cut the way to the computer", () => {
    const h = hotelWith();
    // The computer is used from (4, 7): a plant on that tile leaves nobody a place to stand.
    expect(h.placeFurniture(roomId, fern("bought_1", 4, 7))).toMatchObject({ ok: false, code: "blocks_path" });
  });

  it("picks up a bought piece, never a piece of the template", () => {
    const h = hotelWith();
    h.placeFurniture(roomId, fern("bought_1", 2, 1));
    const saved: unknown[] = [];
    const r = h.pickUpFurniture(roomId, "bought_1", (layout) => saved.push(layout));
    expect(r.ok).toBe(true);
    expect(saved).toEqual([{}]);
    expect(h.sim(roomId)!.room.furni.some((p) => p.itemId === "bought_1")).toBe(false);
    for (const id of ["desk_architect", "computer_desk_1", "mailbox_1", "board_1", "review_desk_1", "test_lab_1", "library_shelf_1", "elevator_1", "plant_2"]) {
      expect(h.pickUpFurniture(roomId, id)).toMatchObject({ ok: false, code: "not_removable" });
      expect(h.sim(roomId)!.room.furni.some((p) => p.itemId === id)).toBe(true);
    }
    expect(h.pickUpFurniture(roomId, "bought_9")).toMatchObject({ ok: false, code: "unknown_item" });
    expect(h.pickUpFurniture("lobby", "plant_2")).toMatchObject({ ok: false, code: "not_editable" });
  });

  it("a save that throws changes nothing", () => {
    const h = hotelWith();
    const boom = () => {
      throw new Error("disk full");
    };
    expect(h.placeFurniture(roomId, fern("bought_1", 2, 1), boom)).toMatchObject({ ok: false, code: "save_failed" });
    expect(h.isExtra(roomId, "bought_1")).toBe(false);
    h.placeFurniture(roomId, fern("bought_1", 2, 1));
    expect(h.pickUpFurniture(roomId, "bought_1", boom)).toMatchObject({ ok: false, code: "save_failed" });
    expect(h.isExtra(roomId, "bought_1")).toBe(true);
  });

  it("moves a bought piece like any piece, and the template layout does not hold it", () => {
    const h = hotelWith();
    h.placeFurniture(roomId, fern("bought_1", 2, 1));
    const layouts: unknown[] = [];
    expect(h.moveFurniture(roomId, "bought_1", { x: 3, y: 1, dir: 6 }, (l) => layouts.push(l)).ok).toBe(true);
    expect(layouts).toEqual([{}]);
    expect(h.sim(roomId)!.room.furni.find((p) => p.itemId === "bought_1")).toMatchObject({ x: 3, y: 1, dir: 6 });
    expect(h.moveFurniture(roomId, "bought_1", { x: 9, y: 8, dir: 4 })).toMatchObject({ ok: false, reason: "That tile is taken by the potted plant." });
  });

  it("a floor is built with the bought pieces, and one that no longer fits is left out", () => {
    const extras = [fern("bought_1", 2, 1), fern("bought_2", 9, 8), fern("bought_3", 40, 40), { itemId: "bought_4", defId: "no_such_def", x: 3, y: 1, dir: 4 as const }];
    const room = roomForProject(template, { id: "demo", name: "Demo" }, undefined, extras);
    expect(room.furni.filter((p) => p.itemId.startsWith("bought_")).map((p) => p.itemId)).toEqual(["bought_1"]);
    expect(layoutProblem(room)).toBeUndefined();
    const h = new Hotel({ lobby, hr, template, clock: () => 0, extrasOf: () => extras });
    h.addProject({ id: "demo", name: "Demo" });
    expect(h.sim(roomId)!.room.furni.filter((p) => p.itemId.startsWith("bought_")).map((p) => p.itemId)).toEqual(["bought_1"]);
    expect(addExtras(baseRoomForProject(template, { id: "demo", name: "Demo" }), [])).toEqual(baseRoomForProject(template, { id: "demo", name: "Demo" }));
  });

  it("Reset layout keeps the bought pieces, and says so when one is in the way of the template", () => {
    const h = hotelWith();
    h.placeFurniture(roomId, fern("bought_1", 2, 1));
    h.moveFurniture(roomId, "plant_2", { x: 8, y: 8, dir: 4 });
    const r = h.resetLayout(roomId);
    expect(r.ok).toBe(true);
    const room = h.sim(roomId)!.room;
    expect(room.furni.find((p) => p.itemId === "plant_2")).toMatchObject({ x: 9, y: 8 });
    expect(room.furni.find((p) => p.itemId === "bought_1")).toMatchObject({ x: 2, y: 1 });

    // A piece on the template spot of the plant: the plant is away, the user puts a fern where it belongs, reset is refused.
    h.moveFurniture(roomId, "plant_2", { x: 8, y: 8, dir: 4 });
    h.placeFurniture(roomId, fern("bought_2", 9, 8));
    expect(h.resetLayout(roomId)).toMatchObject({ ok: false, reason: "A piece you placed is in the way. Pick it up first." });
    expect(h.sim(roomId)!.room.furni.find((p) => p.itemId === "plant_2")).toMatchObject({ x: 8, y: 8 });
    expect(h.pickUpFurniture(roomId, "bought_2").ok).toBe(true);
    expect(h.resetLayout(roomId).ok).toBe(true);
  });

  it("every item of the shipped catalogue can be shown on a floor, and none is a piece that starts work", () => {
    for (const item of items) {
      const def = FURNI_CATALOG[item.defId]!;
      // The coffee machine is the one piece for sale that can be used: it only changes the mood of a ghost.
      if (def.interaction !== undefined) expect(SHOP_INTERACTIONS, item.id).toContain(def.interaction);
      expect(furniOf({ id: "bought_1", itemId: item.id, x: 1, y: 1, dir: 4 }, items)?.defId, item.id).toBe(item.defId);
    }
  });
});

describe("property: any sequence of places, moves, pick-ups and removals", () => {
  type Op =
    | { kind: "place"; item: string; x: number; y: number; dir: 0 | 2 | 4 | 6 }
    | { kind: "move"; k: number; x: number; y: number; dir: 0 | 2 | 4 | 6 }
    | { kind: "pickup"; k: number }
    | { kind: "remove" };
  const dir = fc.constantFrom(0, 2, 4, 6) as fc.Arbitrary<0 | 2 | 4 | 6>;
  const op: fc.Arbitrary<Op> = fc.oneof(
    fc.record({ kind: fc.constant("place" as const), item: fc.constantFrom("fern", "armchair", "wall_clock", "rune_rug", "coffin"), x: fc.integer({ min: -1, max: 12 }), y: fc.integer({ min: -1, max: 10 }), dir }),
    fc.record({ kind: fc.constant("move" as const), k: fc.nat(8), x: fc.integer({ min: -1, max: 12 }), y: fc.integer({ min: -1, max: 10 }), dir }),
    fc.record({ kind: fc.constant("pickup" as const), k: fc.nat(8) }),
    fc.constant({ kind: "remove" as const }),
  );
  const START = 12;

  it("never creates or loses a piece, never touches the template, and every floor stays valid", () => {
    fc.assert(
      fc.property(fc.array(op, { maxLength: 50 }), (ops) => {
        const h = new Hotel({ lobby, hr, template, clock: () => 0 });
        h.addProject({ id: "demo", name: "Demo" });
        const roomId = projectRoomId("demo");
        const templateIds = template.furni.map((p) => p.itemId).sort();
        let inv: Inventory = stocked({ fern: START, armchair: START, wall_clock: START, rune_rug: START, coffin: START });
        const total = stockCount(inv.stock);
        const placed = () => piecesOf(inv, "demo");
        for (const o of ops) {
          if (o.kind === "place") {
            const r = placeFromStock(inv, "demo", o.item, { x: o.x, y: o.y, dir: o.dir });
            if (!r.ok) continue;
            const piece = furniOf(r.piece, items)!;
            h.placeFurniture(roomId, piece, () => (inv = r.inventory));
          } else if (o.kind === "move") {
            const p = placed()[o.k % Math.max(1, placed().length)];
            if (!p) continue;
            const to = { x: o.x, y: o.y, dir: o.dir };
            h.moveFurniture(roomId, p.id, to, () => {
              const r = movePlaced(inv, "demo", p.id, to);
              if (r.ok) inv = r.inventory;
            });
          } else if (o.kind === "pickup") {
            const p = placed()[o.k % Math.max(1, placed().length)];
            if (!p) continue;
            h.pickUpFurniture(roomId, p.id, () => {
              const r = pickUpToStock(inv, "demo", p.id);
              if (r.ok) inv = r.inventory;
            });
          } else {
            // A removed project gives everything back; the floor is built again from the inventory.
            inv = returnFloors(inv, ["demo"]);
            h.removeProject("demo");
            h.addProject({ id: "demo", name: "Demo" });
          }
          const room = h.sim(roomId)!.room;
          // The floor shows exactly the pieces the inventory says are placed; nothing of the template is gone or added.
          expect(room.furni.filter((p) => isBoughtId(p.itemId)).map((p) => p.itemId).sort()).toEqual(placed().map((p) => p.id).sort());
          expect(room.furni.filter((p) => !isBoughtId(p.itemId)).map((p) => p.itemId).sort()).toEqual(templateIds);
          expect(layoutProblem(room)).toBeUndefined();
          // Nothing is made or lost: stock plus placed pieces is what was bought.
          expect(stockCount(inv.stock) + Object.values(inv.placed).flat().length).toBe(total);
        }
        return true;
      }),
      { numRuns: 120 },
    );
  });
});
