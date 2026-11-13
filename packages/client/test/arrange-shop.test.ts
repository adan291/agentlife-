import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CatalogueFileSchema, ClientMsgSchema, Hotel, emptyInventory, furniOf, movePlaced, pickUpToStock, placeFromStock, projectRoomId, stockList, validateRoom } from "@agentlife/shared";
import type { ClientMsg, Inventory, RoomDef } from "@agentlife/shared";
import { ArrangeModel } from "../src/ui/arrange.ts";
import { createArrangeBar } from "../src/ui/arrange-bar.ts";
import { createArrangeTray } from "../src/ui/arrange-tray.ts";
import { FakeDocument, findAll, textOf } from "./fake-dom.ts";
import type { FakeElement } from "./fake-dom.ts";

const here = dirname(fileURLToPath(import.meta.url));
const worldServer = join(here, "..", "..", "world-server");
const room = (name: string): RoomDef => validateRoom(JSON.parse(readFileSync(join(worldServer, "rooms", name), "utf8")));
const items = CatalogueFileSchema.parse(JSON.parse(readFileSync(join(worldServer, "config", "catalogue-furni.json"), "utf8"))).items;

/**
 * An arrange model with a stand-in for the world-server: the real hotel and the real inventory rules answer what the
 * model sends, as the gateway does. `answer()` replies to the messages sent so far.
 */
function harness(stock: Record<string, number> = { fern: 2, wall_clock: 1 }) {
  const hotel = new Hotel({ lobby: room("lobby.json"), hr: room("hr.json"), template: room("project-template.json"), clock: Date.now });
  const roomId = projectRoomId("demo");
  hotel.addProject({ id: "demo", name: "Demo" });
  let inv: Inventory = { ...emptyInventory(), stock };
  const sent: ClientMsg[] = [];
  const model = new ArrangeModel((m) => sent.push(m));
  const current = (): RoomDef => hotel.sim(roomId)!.room;
  const shop = () => ({ balance: 0, items: [...items], stock: stockList(inv.stock, items), stockMax: 200 as const });
  model.setRoom(current());
  model.onShop(shop());
  const answer = (): void => {
    for (const msg of sent.splice(0)) {
      if (msg.type === "furni_place") {
        const r = placeFromStock(inv, "demo", msg.itemId, { x: msg.x, y: msg.y, dir: msg.dir });
        if (!r.ok) {
          model.onRefused(r.reason);
          continue;
        }
        const placed = hotel.placeFurniture(roomId, furniOf(r.piece, items)!, () => (inv = r.inventory));
        if (!placed.ok) {
          model.onRefused(placed.reason);
          continue;
        }
      } else if (msg.type === "furni_pickup") {
        const r = pickUpToStock(inv, "demo", msg.itemId);
        const taken = hotel.pickUpFurniture(roomId, msg.itemId, () => {
          if (!r.ok) throw new Error(r.reason);
          inv = r.inventory;
        });
        if (!taken.ok) {
          model.onRefused(taken.reason);
          continue;
        }
      } else if (msg.type === "furni_move") {
        const to = { x: msg.x, y: msg.y, dir: msg.dir };
        const extra = hotel.isExtra(roomId, msg.itemId);
        const moved = hotel.moveFurniture(roomId, msg.itemId, to, () => {
          if (!extra) return;
          const r = movePlaced(inv, "demo", msg.itemId, to);
          if (r.ok) inv = r.inventory;
        });
        if (!moved.ok) {
          model.onRefused(moved.reason);
          continue;
        }
      }
      model.onLayout(current().furni, current().anchors);
      model.onShop(shop());
    }
  };
  return { model, sent, answer, current, stock: () => inv.stock, placedIds: () => (inv.placed["demo"] ?? []).map((p) => p.id) };
}

/** Carries an item over a tile and releases it there, the way a drag from the tray does. */
function dropAt(h: ReturnType<typeof harness>, itemId: string, x: number, y: number): void {
  expect(h.model.carry(itemId)).toBe(true);
  h.model.pointerMove({ x, y });
  h.model.pointerUp();
}

describe("the inventory tray list", () => {
  it("is empty before the shop answers and lists the stock in catalogue order after", () => {
    const h = harness({ wall_clock: 1, armchair: 3, fern: 2 });
    expect(h.model.tray().map((t) => [t.itemId, t.name, t.count])).toEqual([
      ["armchair", "Velvet armchair", 3],
      ["fern", "Fern", 2],
      ["wall_clock", "Wall clock", 1],
    ]);
    const bare = new ArrangeModel(() => undefined);
    expect(bare.tray()).toEqual([]);
  });
});

describe("placing a carried item", () => {
  it("shows a green preview over a free tile, sends furni_place on release and selects the new piece", () => {
    const h = harness();
    h.model.enter();
    expect(h.model.carry("fern")).toBe(true);
    expect(h.model.view().carrying).toBe("fern");
    expect(h.model.view().piece).toBe("Fern");
    h.model.pointerMove({ x: 2, y: 1 });
    expect(h.model.overlay()?.preview).toEqual({ tiles: [{ x: 2, y: 1 }], ok: true });
    expect(h.model.view().status).toBe("Click to place it here.");
    h.model.pointerUp();
    expect(h.sent).toEqual([{ type: "furni_place", itemId: "fern", x: 2, y: 1, dir: 4 }]);
    expect(ClientMsgSchema.safeParse(h.sent[0]).success).toBe(true);
    h.answer();
    const v = h.model.view();
    expect(v.status).toBe("Placed.");
    expect(v.carrying).toBeNull();
    expect(h.model.selectedId).toBe("bought_1");
    expect(v.piece).toBe("Fern");
    expect(v.where).toBe("tile 2, 1, facing south");
    expect(v.canPickUp).toBe(true);
    expect(h.model.tray().find((t) => t.itemId === "fern")?.count).toBe(1);
    expect(h.current().furni.some((p) => p.itemId === "bought_1")).toBe(true);
  });

  it("a click on the floor places too: the pointer goes down and up on the same tile", () => {
    const h = harness();
    h.model.enter();
    h.model.carry("fern");
    h.model.pointerDown([], { x: 2, y: 1 });
    h.model.pointerUp();
    expect(h.sent).toHaveLength(1);
    h.answer();
    expect(h.model.selectedId).toBe("bought_1");
  });

  it("says why a tile is refused and sends nothing", () => {
    const h = harness();
    h.model.enter();
    h.model.carry("fern");
    h.model.pointerMove({ x: 9, y: 8 }); // the plant
    expect(h.model.overlay()?.preview?.ok).toBe(false);
    expect(h.model.view()).toMatchObject({ status: "That tile is taken by the potted plant.", tone: "bad" });
    h.model.pointerUp();
    expect(h.sent).toEqual([]);
    h.model.pointerMove({ x: 20, y: 20 });
    expect(h.model.view().status).toBe("That is outside the room.");
    expect(h.model.view().carrying).toBe("fern");
  });

  it("a wall piece may stand free in the middle of the floor, and against a wall it must face the room", () => {
    const h = harness();
    h.model.enter();
    h.model.carry("wall_clock");
    h.model.pointerMove({ x: 6, y: 5 });
    expect(h.model.overlay()?.preview?.ok).toBe(true);
    // Against the north wall it faces south (the default direction), and turned east it is refused there.
    h.model.pointerMove({ x: 2, y: 0 });
    expect(h.model.overlay()?.preview?.ok).toBe(true);
    h.model.rotate();
    expect(h.model.overlay()?.preview?.ok).toBe(false);
    expect(h.model.view().status).toBe("Against a wall this piece faces the room. Move it away from the wall to turn it.");
    h.model.rotate();
    h.model.rotate();
    h.model.rotate();
    expect(h.model.overlay()?.preview?.ok).toBe(true);
    h.model.pointerUp();
    h.answer();
    expect(h.model.selectedId).toBe("bought_1");
  });

  it("R turns the carried item before it is placed", () => {
    const h = harness();
    h.model.enter();
    h.model.carry("fern");
    expect(h.model.view().where).toBe("facing south");
    h.model.rotate();
    expect(h.model.view().where).toBe("facing west");
    h.model.pointerMove({ x: 2, y: 1 });
    h.model.rotate();
    expect(h.model.view().where).toBe("tile 2, 1, facing north");
    h.model.pointerUp();
    expect(h.sent).toEqual([{ type: "furni_place", itemId: "fern", x: 2, y: 1, dir: 0 }]);
  });

  it("Esc puts the item back first and leaves arrange mode second", () => {
    const h = harness();
    h.model.enter();
    h.model.carry("fern");
    h.model.escape();
    expect(h.model.view()).toMatchObject({ carrying: null, active: true });
    h.model.escape();
    expect(h.model.isActive).toBe(false);
  });

  it("pressing the same item again puts it back", () => {
    const h = harness();
    h.model.enter();
    h.model.carry("fern");
    expect(h.model.carry("fern")).toBe(false);
    expect(h.model.view().carrying).toBeNull();
  });

  it("an item the user does not have cannot be carried", () => {
    const h = harness({ fern: 1 });
    h.model.enter();
    expect(h.model.carry("armchair")).toBe(false);
    expect(h.model.carry("no_such_item")).toBe(false);
    expect(h.model.view().carrying).toBeNull();
  });

  it("a release after the pointer left the canvas places nothing (the click was on a button)", () => {
    const h = harness();
    h.model.enter();
    h.model.carry("fern");
    h.model.pointerMove({ x: 2, y: 1 });
    h.model.pointerLeave();
    expect(h.model.overlay()?.preview).toBeNull();
    h.model.pointerUp();
    expect(h.sent).toEqual([]);
  });

  it("a release before the pointer was ever over the floor places nothing", () => {
    const h = harness();
    h.model.enter();
    h.model.carry("fern");
    h.model.pointerUp();
    expect(h.sent).toEqual([]);
  });

  it("a refusal from the server is shown in red, the item stays in hand and the room does not change", () => {
    const h = harness();
    h.model.enter();
    h.model.carry("fern");
    h.model.pointerMove({ x: 2, y: 1 });
    h.model.pointerUp();
    h.sent.splice(0);
    h.model.onRefused("Someone is standing there.");
    expect(h.model.view()).toMatchObject({ status: "Someone is standing there.", tone: "bad", carrying: "fern", busy: false });
    expect(h.model.overlay()?.preview).toEqual({ tiles: [{ x: 2, y: 1 }], ok: false });
  });

  it("the item that was the last of its kind leaves the hand when the stock says so", () => {
    const h = harness({ fern: 1 });
    h.model.enter();
    h.model.carry("fern");
    h.model.onShop({ balance: 0, items: [...items], stock: [], stockMax: 200 });
    expect(h.model.view().carrying).toBeNull();
    expect(h.model.tray()).toEqual([]);
  });

  it("leaving or changing room puts the item down", () => {
    const h = harness();
    h.model.enter();
    h.model.carry("fern");
    h.model.leave();
    h.model.enter();
    expect(h.model.view().carrying).toBeNull();
    h.model.carry("fern");
    h.model.setRoom(h.current());
    expect(h.model.view().carrying).toBeNull();
  });
});

describe("bought pieces on the floor", () => {
  function withPiece() {
    const h = harness();
    h.model.enter();
    dropAt(h, "fern", 2, 1);
    h.answer();
    return h;
  }

  it("can be moved like any piece and picked up; the pieces of the template cannot be picked up", () => {
    const h = withPiece();
    h.model.step(1, 0);
    expect(h.sent).toEqual([{ type: "furni_move", itemId: "bought_1", x: 3, y: 1, dir: 4 }]);
    h.answer();
    expect(h.model.view().where).toBe("tile 3, 1, facing south");
    expect(h.model.canUndo).toBe(true);

    h.model.pickUp();
    expect(h.sent).toEqual([{ type: "furni_pickup", itemId: "bought_1" }]);
    expect(ClientMsgSchema.safeParse(h.sent[0]).success).toBe(true);
    h.answer();
    expect(h.model.view()).toMatchObject({ status: "Back in your inventory.", piece: null, canPickUp: false });
    expect(h.model.selectedId).toBeNull();
    expect(h.current().furni.some((p) => p.itemId === "bought_1")).toBe(false);
    expect(h.model.tray().find((t) => t.itemId === "fern")?.count).toBe(2);
    // The move of the piece that is gone is not offered as an undo.
    expect(h.model.canUndo).toBe(false);

    h.model.select("plant_2");
    expect(h.model.view().canPickUp).toBe(false);
    h.model.pickUp();
    expect(h.sent).toEqual([]);
  });

  it("Pick up is not offered while an item is carried or an answer is awaited", () => {
    const h = withPiece();
    expect(h.model.view().canPickUp).toBe(true);
    h.model.step(1, 0);
    expect(h.model.view().canPickUp).toBe(false);
    h.answer();
    h.model.carry("fern");
    expect(h.model.view().canPickUp).toBe(false);
  });

  it("pieces of the template still move after a piece was placed", () => {
    const h = withPiece();
    // Picking a template piece still works as before.
    h.model.select("plant_2");
    h.model.step(-1, 0);
    h.answer();
    expect(h.model.view().where).toBe("tile 8, 8, facing south");
  });
});

describe("the tray and the bar", () => {
  function parts() {
    const doc = new FakeDocument();
    const host = new FakeDocument().createElement("div");
    const carried: string[] = [];
    const tray = createArrangeTray(doc as unknown as Document, host as unknown as HTMLElement, { carry: (id) => carried.push(id) }, { preview: (defId) => (defId === "fern" ? "data:image/png;base64,AA" : undefined) });
    const el = tray.element as unknown as FakeElement;
    const h = harness({ fern: 2, armchair: 1 });
    const buttons = () => findAll(el, (e) => e.tagName === "button");
    return { tray, el, carried, h, buttons };
  }

  it("is hidden until arranging, and lists each item with its count and a picture", () => {
    const { tray, el, h, buttons } = parts();
    tray.update(h.model.view());
    expect(el.hidden).toBe(true);
    h.model.enter();
    tray.update(h.model.view());
    expect(el.hidden).toBe(false);
    expect(buttons().map((b) => textOf(b))).toEqual(["Velvet armchair ×1", "Fern ×2"]);
    expect(buttons().map((b) => b.getAttribute("aria-label"))).toEqual(["Velvet armchair, you have 1", "Fern, you have 2"]);
    expect(findAll(el, (e) => e.tagName === "img")).toHaveLength(1);
  });

  it("says what to do when nothing is left, and points to the shop", () => {
    const { tray, el } = parts();
    const bare = harness({});
    bare.model.enter();
    tray.update(bare.model.view());
    expect(textOf(el)).toContain("Buy furniture at the shop counter in the lobby.");
    expect(findAll(el, (e) => e.tagName === "button")).toEqual([]);
    const full = harness({ fern: 1 });
    full.model.enter();
    tray.update(full.model.view());
    expect(findAll(el, (e) => e.className.startsWith("al-tray-empty"))[0]!.hidden).toBe(true);
  });

  it("a press with the primary button takes the item, a key press (click without a pointer) does too, another button does not", () => {
    const { tray, h, buttons, carried } = parts();
    h.model.enter();
    tray.update(h.model.view());
    const fern = buttons()[1]!;
    fern.fire("pointerdown", { button: 2 });
    expect(carried).toEqual([]);
    fern.fire("pointerdown", { button: 0 });
    fern.fire("click", { detail: 0 });
    fern.fire("click", { detail: 1 });
    expect(carried).toEqual(["fern", "fern"]);
  });

  it("marks the carried item as pressed without rebuilding the list", () => {
    const { tray, h, buttons } = parts();
    h.model.enter();
    tray.update(h.model.view());
    const before = buttons();
    h.model.carry("fern");
    tray.update(h.model.view());
    const after = buttons();
    expect(after[1]).toBe(before[1]);
    expect(after.map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "true"]);
  });

  it("the bar has a Pick up button that is on only for a bought piece", () => {
    const doc = new FakeDocument();
    const host = new FakeDocument().createElement("div");
    const calls: string[] = [];
    const bar = createArrangeBar(doc as unknown as Document, host as unknown as HTMLElement, {
      rotate: () => undefined,
      undo: () => undefined,
      pickUp: () => calls.push("pickUp"),
      reset: () => undefined,
      inventory: () => undefined,
    });
    const el = bar.element as unknown as FakeElement;
    const pick = findAll(el, (e) => e.tagName === "button" && e.textContent === "Pick up")[0]!;
    const h = harness();
    h.model.enter();
    h.model.select("plant_2");
    bar.update(h.model.view());
    expect(pick.disabled).toBe(true);
    dropAt(h, "fern", 2, 1);
    h.answer();
    bar.update(h.model.view());
    expect(pick.disabled).toBe(false);
    pick.click();
    expect(calls).toEqual(["pickUp"]);
  });
});
