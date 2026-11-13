import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientMsgSchema, checkMove, layoutProblem, validateRoom } from "@agentlife/shared";
import type { ClientMsg, Placement, RoomDef } from "@agentlife/shared";
import { ANSWER_TIMEOUT_MS, ArrangeModel, QUEUE_MAX, arrangeKey } from "../src/ui/arrange.ts";
import { createArrangeBar } from "../src/ui/arrange-bar.ts";
import { FakeDocument, findAll, textOf } from "./fake-dom.ts";
import type { FakeElement } from "./fake-dom.ts";

const here = dirname(fileURLToPath(import.meta.url));
const read = (name: string): RoomDef => validateRoom(JSON.parse(readFileSync(join(here, "..", "..", "world-server", "rooms", name), "utf8")));
const template = read("project-template.json");
const lobby = read("lobby.json");

type Move = Extract<ClientMsg, { type: "furni_move" }>;

/** A model with a stand-in for the world-server: `answer()` replies to the messages sent so far, as the server would. */
function harness(start: RoomDef = template) {
  const sent: ClientMsg[] = [];
  const model = new ArrangeModel((m) => sent.push(m));
  let room = start;
  model.setRoom(room);
  const answer = (): void => {
    for (const msg of sent.splice(0)) {
      if (msg.type === "furni_reset") room = template;
      else if (msg.type === "furni_move") {
        const r = checkMove(room, msg.itemId, { x: msg.x, y: msg.y, dir: msg.dir });
        if (!r.ok) {
          model.onRefused(r.reason);
          continue;
        }
        room = r.room;
      }
      model.onLayout(room.furni, room.anchors);
    }
  };
  return { model, sent, answer, room: () => room };
}

const at = (room: RoomDef, id: string): Placement => {
  const p = room.furni.find((f) => f.itemId === id)!;
  return { x: p.x, y: p.y, dir: p.dir };
};

describe("arrangeKey", () => {
  it("maps the arrows to the floor axes, R to a turn, Esc to leave and Ctrl+Z to undo", () => {
    expect(arrangeKey({ key: "ArrowLeft" })).toEqual({ kind: "step", dx: -1, dy: 0 });
    expect(arrangeKey({ key: "ArrowRight" })).toEqual({ kind: "step", dx: 1, dy: 0 });
    expect(arrangeKey({ key: "ArrowUp" })).toEqual({ kind: "step", dx: 0, dy: -1 });
    expect(arrangeKey({ key: "ArrowDown" })).toEqual({ kind: "step", dx: 0, dy: 1 });
    expect(arrangeKey({ key: "r" })).toEqual({ kind: "rotate" });
    expect(arrangeKey({ key: "R" })).toEqual({ kind: "rotate" });
    expect(arrangeKey({ key: "Escape" })).toEqual({ kind: "leave" });
    expect(arrangeKey({ key: "z", ctrlKey: true })).toEqual({ kind: "undo" });
    expect(arrangeKey({ key: "Z", metaKey: true })).toEqual({ kind: "undo" });
  });

  it("ignores other keys, shortcuts with Ctrl or Alt, and typing in a field", () => {
    expect(arrangeKey({ key: "a" })).toBeNull();
    expect(arrangeKey({ key: "r", ctrlKey: true })).toBeNull();
    expect(arrangeKey({ key: "ArrowUp", altKey: true })).toBeNull();
    for (const tagName of ["INPUT", "TEXTAREA", "SELECT"]) expect(arrangeKey({ key: "ArrowUp", target: { tagName } })).toBeNull();
    expect(arrangeKey({ key: "Escape", target: { tagName: "INPUT" } })).toBeNull();
    expect(arrangeKey({ key: "ArrowUp", target: { tagName: "BUTTON" } })).toEqual({ kind: "step", dx: 0, dy: -1 });
  });
});

describe("entering and leaving", () => {
  it("only a project floor can be arranged", () => {
    const h = harness(lobby);
    expect(h.model.available).toBe(false);
    expect(h.model.enter()).toBe(false);
    expect(h.model.isActive).toBe(false);
    const p = harness();
    expect(p.model.available).toBe(true);
    expect(p.model.enter()).toBe(true);
    expect(p.model.isActive).toBe(true);
  });

  it("does nothing until arranging, and a new room stops it", () => {
    const h = harness();
    h.model.select("plant_2");
    h.model.step(-1, 0);
    expect(h.model.selectedId).toBeNull();
    expect(h.sent).toEqual([]);
    h.model.enter();
    h.model.select("plant_2");
    expect(h.model.selectedId).toBe("plant_2");
    h.model.setRoom(template);
    expect(h.model.isActive).toBe(false);
    expect(h.model.selectedId).toBeNull();
    expect(h.model.overlay()).toBeNull();
  });

  it("leaving forgets the selection and the undo list", () => {
    const h = harness();
    h.model.enter();
    h.model.select("plant_2");
    h.model.step(-1, 0);
    h.answer();
    expect(h.model.canUndo).toBe(true);
    h.model.leave();
    h.model.enter();
    expect(h.model.selectedId).toBeNull();
    expect(h.model.canUndo).toBe(false);
  });
});

describe("selecting", () => {
  it("selects a piece and says what to do", () => {
    const h = harness();
    h.model.enter();
    expect(h.model.view().piece).toBeNull();
    expect(h.model.view().status).toMatch(/Click a piece/);
    expect(h.model.select("plant_2")).toBe(true);
    const v = h.model.view();
    expect(v.piece).toBe("Potted plant");
    expect(v.where).toBe("tile 9, 8, facing south");
    expect(v.canRotate).toBe(true);
  });

  it("refuses the elevator with its reason and unknown pieces quietly", () => {
    const h = harness();
    h.model.enter();
    expect(h.model.select("elevator_1")).toBe(false);
    expect(h.model.selectedId).toBeNull();
    expect(h.model.view()).toMatchObject({ status: "The elevator stays where it is.", tone: "bad" });
    expect(h.model.select("nope")).toBe(false);
  });

  it("clicking empty floor clears the selection", () => {
    const h = harness();
    h.model.enter();
    h.model.pointerDown("plant_2", { x: 9, y: 8 });
    h.model.pointerUp();
    expect(h.model.selectedId).toBe("plant_2");
    h.model.pointerDown(null, { x: 5, y: 5 });
    expect(h.model.selectedId).toBeNull();
  });
});

describe("moving with the keys", () => {
  it("sends a valid move, then keeps it after the answer and offers Undo", () => {
    const h = harness();
    h.model.enter();
    h.model.select("plant_2");
    h.model.step(-1, 0);
    expect(h.sent).toEqual([{ type: "furni_move", itemId: "plant_2", x: 8, y: 8, dir: 4 }]);
    expect(ClientMsgSchema.safeParse(h.sent[0]).success).toBe(true);
    expect(h.model.view()).toMatchObject({ busy: true, canUndo: false });
    h.answer();
    expect(at(h.room(), "plant_2")).toEqual({ x: 8, y: 8, dir: 4 });
    expect(h.model.view()).toMatchObject({ busy: false, canUndo: true, status: "Saved.", tone: "ok", where: "tile 8, 8, facing south" });
    expect(h.model.overlay()?.preview).toBeNull();
  });

  it("explains a refused move with red tiles and sends nothing", () => {
    const h = harness();
    h.model.enter();
    h.model.select("plant_1");
    h.model.step(0, -1);
    expect(h.sent).toEqual([]);
    expect(h.model.view()).toMatchObject({ status: "That is outside the room.", tone: "bad", busy: false });
    expect(h.model.overlay()?.preview).toEqual({ tiles: [{ x: 11, y: -1 }], ok: false });
  });

  it("shows the reason of a move that blocks the path, and sends nothing", () => {
    const h = harness();
    h.model.enter();
    // The Developer's desk stands in front of the way to the computer desk.
    h.model.select("desk_developer");
    h.model.step(0, 1);
    expect(h.sent).toEqual([]);
    expect(h.model.view()).toMatchObject({ status: "Blocks the path to the computer desk.", tone: "bad", busy: false });
    expect(h.model.overlay()?.preview?.ok).toBe(false);
    expect(h.model.canUndo).toBe(false);
    expect(layoutProblem(h.room())).toBeUndefined();
  });

  it("queues key presses while a move is on its way and sends them one at a time", () => {
    const h = harness();
    h.model.enter();
    h.model.select("plant_2");
    h.model.step(-1, 0);
    h.model.step(-1, 0);
    h.model.step(0, -1);
    expect(h.sent).toHaveLength(1);
    h.answer();
    // The answer to the first move released the second, which is sent from the new position.
    expect(h.sent).toEqual([{ type: "furni_move", itemId: "plant_2", x: 7, y: 8, dir: 4 }]);
    h.answer();
    expect(h.sent).toEqual([{ type: "furni_move", itemId: "plant_2", x: 7, y: 7, dir: 4 }]);
    h.answer();
    expect(at(h.room(), "plant_2")).toEqual({ x: 7, y: 7, dir: 4 });
  });

  it("never queues more than the limit", () => {
    const h = harness();
    h.model.enter();
    h.model.select("plant_2");
    for (let i = 0; i < QUEUE_MAX + 20; i++) h.model.step(-1, 0);
    let moves = 0;
    while (h.sent.length > 0) {
      moves += 1;
      h.answer();
    }
    expect(moves).toBeLessThanOrEqual(QUEUE_MAX + 1);
  });

  it("a refusal from the server drops the queue and shows the reason", () => {
    const h = harness();
    h.model.enter();
    h.model.select("plant_2");
    h.model.step(-1, 0);
    h.model.step(-1, 0);
    h.sent.length = 0;
    h.model.onRefused("Someone is standing there.");
    expect(h.model.view()).toMatchObject({ status: "Someone is standing there.", tone: "bad", busy: false, canUndo: false });
    expect(h.model.overlay()?.preview).toEqual({ tiles: [{ x: 8, y: 8 }], ok: false });
    expect(h.sent).toEqual([]);
  });
});

describe("turning", () => {
  it("turns a quarter turn", () => {
    const h = harness();
    h.model.enter();
    h.model.select("plant_2");
    h.model.rotate();
    expect(h.sent).toEqual([{ type: "furni_move", itemId: "plant_2", x: 9, y: 8, dir: 6 }]);
    h.answer();
    expect(h.model.view().where).toBe("tile 9, 8, facing west");
  });

  it("a wall piece that cannot turn says it goes on a wall", () => {
    const h = harness();
    h.model.enter();
    h.model.select("test_lab_1");
    h.model.rotate();
    expect(h.sent).toEqual([]);
    expect(h.model.view()).toMatchObject({ status: "This piece goes on a wall.", tone: "bad" });
  });
});

describe("dragging", () => {
  it("previews green on a free tile, sends on release and keeps the grab point", () => {
    const h = harness();
    h.model.enter();
    h.model.pointerDown("plant_2", { x: 9, y: 8 });
    h.model.pointerMove({ x: 7, y: 8 });
    expect(h.model.overlay()?.preview).toEqual({ tiles: [{ x: 7, y: 8 }], ok: true });
    expect(h.model.view().tone).toBe("ok");
    expect(h.sent).toEqual([]);
    h.model.pointerUp();
    expect(h.sent).toEqual([{ type: "furni_move", itemId: "plant_2", x: 7, y: 8, dir: 4 }]);
    h.answer();
    expect(at(h.room(), "plant_2")).toEqual({ x: 7, y: 8, dir: 4 });
  });

  it("a tall piece grabbed away from its corner lands relative to where it was grabbed", () => {
    const h = harness();
    h.model.enter();
    const desk = at(template, "desk_developer");
    h.model.pointerDown("desk_developer", { x: desk.x + 1, y: desk.y });
    h.model.pointerMove({ x: desk.x + 1, y: desk.y + 1 });
    const preview = h.model.overlay()?.preview;
    expect(preview?.tiles.some((t) => t.x === desk.x && t.y === desk.y + 1)).toBe(true);
  });

  it("previews red with the reason on a taken tile and sends nothing on release", () => {
    const h = harness();
    h.model.enter();
    h.model.pointerDown("plant_2", { x: 9, y: 8 });
    const sofa = at(template, "sofa_1");
    h.model.pointerMove({ x: sofa.x, y: sofa.y });
    expect(h.model.overlay()?.preview?.ok).toBe(false);
    expect(h.model.view()).toMatchObject({ status: "That tile is taken.", tone: "bad" });
    h.model.pointerUp();
    expect(h.sent).toEqual([]);
    expect(h.model.overlay()?.preview?.ok).toBe(false);
  });

  it("releasing where it started changes nothing", () => {
    const h = harness();
    h.model.enter();
    h.model.pointerDown("plant_2", { x: 9, y: 8 });
    h.model.pointerMove({ x: 8, y: 8 });
    h.model.pointerMove({ x: 9, y: 8 });
    h.model.pointerUp();
    expect(h.sent).toEqual([]);
    expect(h.model.overlay()?.preview).toBeNull();
  });

  it("draws the team's standing spots, the selected piece and not the elevator", () => {
    const h = harness();
    h.model.enter();
    h.model.select("plant_2");
    const o = h.model.overlay()!;
    expect(o.selected).toEqual([{ x: 9, y: 8 }]);
    expect(o.spots).toContainEqual({ x: 6, y: 3 });
    expect(o.spots).toHaveLength(template.anchors.filter((a) => a.name.startsWith("home_")).length);
    expect(o.spots).not.toContainEqual({ x: template.door.x, y: template.door.y });
  });
});

describe("undo and reset", () => {
  it("undo puts the piece back, one move at a time", () => {
    const h = harness();
    h.model.enter();
    h.model.select("plant_2");
    h.model.step(-1, 0);
    h.answer();
    h.model.step(-1, 0);
    h.answer();
    expect(at(h.room(), "plant_2")).toEqual({ x: 7, y: 8, dir: 4 });
    h.model.undo();
    expect(h.sent).toEqual([{ type: "furni_move", itemId: "plant_2", x: 8, y: 8, dir: 4 }]);
    h.answer();
    expect(h.model.view().status).toBe("Undone.");
    h.model.undo();
    h.answer();
    expect(at(h.room(), "plant_2")).toEqual({ x: 9, y: 8, dir: 4 });
    expect(h.model.canUndo).toBe(false);
  });

  it("undo does not add to the undo list, and a refused undo stays available", () => {
    const h = harness();
    h.model.enter();
    h.model.select("plant_2");
    h.model.step(-1, 0);
    h.answer();
    h.model.undo();
    h.sent.length = 0;
    h.model.onRefused("Someone is standing there.");
    expect(h.model.canUndo).toBe(true);
    h.model.undo();
    h.answer();
    expect(h.model.canUndo).toBe(false);
  });

  it("undo is off while a move is on its way", () => {
    const h = harness();
    h.model.enter();
    h.model.select("plant_2");
    h.model.step(-1, 0);
    h.answer();
    h.model.step(-1, 0);
    expect(h.model.canUndo).toBe(false);
    h.model.undo();
    expect(h.sent).toHaveLength(1);
  });

  it("reset sends furni_reset, clears the undo list and the selection", () => {
    const h = harness();
    h.model.enter();
    h.model.select("plant_2");
    h.model.step(-1, 0);
    h.answer();
    h.model.resetLayout();
    expect(h.sent).toEqual([{ type: "furni_reset" }]);
    expect(ClientMsgSchema.safeParse(h.sent[0]).success).toBe(true);
    h.answer();
    expect(h.model.view()).toMatchObject({ status: "Layout reset.", tone: "ok", canUndo: false, piece: null });
    expect(at(h.room(), "plant_2")).toEqual(at(template, "plant_2"));
  });
});

describe("a server that does not answer", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("stops blocking the bar after a while and keeps the undo entry of an undo", () => {
    const h = harness();
    h.model.enter();
    h.model.select("plant_2");
    h.model.step(-1, 0);
    h.answer();
    h.model.undo();
    expect(h.model.view().busy).toBe(true);
    vi.advanceTimersByTime(ANSWER_TIMEOUT_MS + 1);
    expect(h.model.view()).toMatchObject({ busy: false, tone: "bad", canUndo: true });
    expect(h.model.view().status).toMatch(/did not answer/);
  });

  it("the timer is cancelled by an answer", () => {
    const h = harness();
    h.model.enter();
    h.model.select("plant_2");
    h.model.step(-1, 0);
    h.answer();
    vi.advanceTimersByTime(ANSWER_TIMEOUT_MS * 2);
    expect(h.model.view().status).toBe("Saved.");
  });
});

describe("any sequence of arrange actions leaves a valid room", () => {
  const ids = template.furni.map((f) => f.itemId);
  const action = fc.oneof(
    fc.record({ kind: fc.constant("select" as const), id: fc.constantFrom(...ids) }),
    fc.record({ kind: fc.constant("step" as const), dx: fc.integer({ min: -1, max: 1 }), dy: fc.integer({ min: -1, max: 1 }) }),
    fc.record({ kind: fc.constant("rotate" as const) }),
    fc.record({ kind: fc.constant("undo" as const) }),
    fc.record({ kind: fc.constant("reset" as const) }),
    fc.record({ kind: fc.constant("drag" as const), id: fc.constantFrom(...ids), x: fc.integer({ min: -2, max: 13 }), y: fc.integer({ min: -2, max: 11 }) }),
  );

  it("every move the model sends passes the shared rules, so every room it reaches is valid (requirement 4.1)", () => {
    fc.assert(
      fc.property(fc.array(action, { maxLength: 60 }), (actions) => {
        const h = harness();
        h.model.enter();
        for (const a of actions) {
          if (a.kind === "select") h.model.select(a.id);
          else if (a.kind === "step") h.model.step(a.dx, a.dy);
          else if (a.kind === "rotate") h.model.rotate();
          else if (a.kind === "undo") h.model.undo();
          else if (a.kind === "reset") h.model.resetLayout();
          else {
            const p = at(h.room(), a.id);
            h.model.pointerDown(a.id, { x: p.x, y: p.y });
            h.model.pointerMove({ x: a.x, y: a.y });
            h.model.pointerUp();
          }
          // Every message sent by the model is a move the shared rules accept.
          for (const m of h.sent) {
            if (m.type === "furni_move") {
              const r = checkMove(h.room(), m.itemId, { x: (m as Move).x, y: (m as Move).y, dir: (m as Move).dir });
              if (!r.ok && !a.kind.startsWith("undo")) throw new Error(`the model sent a move the rules refuse: ${r.reason}`);
            }
          }
          h.answer();
          if (layoutProblem(h.room()) !== undefined) return false;
        }
        return true;
      }),
      { numRuns: 150 },
    );
  });
});

describe("the arrange bar", () => {
  function bar() {
    const doc = new FakeDocument();
    const host = new FakeDocument().createElement("div");
    const calls: string[] = [];
    const b = createArrangeBar(doc as unknown as Document, host as unknown as HTMLElement, {
      rotate: () => calls.push("rotate"),
      undo: () => calls.push("undo"),
      pickUp: () => calls.push("pickUp"),
      reset: () => calls.push("reset"),
      done: () => calls.push("done"),
    });
    const el = b.element as unknown as FakeElement;
    const button = (label: string): FakeElement => findAll(el, (e) => e.tagName === "button" && e.textContent === label)[0]!;
    const model = harness();
    return { b, el, calls, button, model };
  }

  it("is hidden until arranging, and shows the piece, the answer and the buttons", () => {
    const { b, el, model, button } = bar();
    b.update(model.model.view());
    expect(el.hidden).toBe(true);
    model.model.enter();
    model.model.select("plant_2");
    b.update(model.model.view());
    expect(el.hidden).toBe(false);
    expect(textOf(el)).toContain("Potted plant: tile 9, 8, facing south");
    expect(button("Rotate (R)").disabled).toBe(false);
    expect(button("Undo").disabled).toBe(true);
    model.model.step(0, -1);
    model.model.step(0, -1);
    model.model.step(0, -1);
    b.update(model.model.view());
    expect(findAll(el, (e) => e.className === "al-arrange-status")[0]!.dataset["tone"]).toBeDefined();
  });

  it("red answers carry the reason as text", () => {
    const { b, el, model } = bar();
    model.model.enter();
    model.model.select("plant_1");
    model.model.step(0, -1);
    b.update(model.model.view());
    const status = findAll(el, (e) => e.className === "al-arrange-status")[0]!;
    expect(status.dataset["tone"]).toBe("bad");
    expect(textOf(status)).toBe("That is outside the room.");
  });

  it("Reset layout asks first: nothing happens until the user confirms", () => {
    const { b, el, calls, button, model } = bar();
    model.model.enter();
    b.update(model.model.view());
    button("Reset layout").click();
    const confirm = findAll(el, (e) => e.className === "al-arrange-confirm")[0]!;
    expect(confirm.hidden).toBe(false);
    expect(calls).toEqual([]);
    button("Keep my layout").click();
    expect(confirm.hidden).toBe(true);
    expect(calls).toEqual([]);
    button("Reset layout").click();
    button("Yes, reset").click();
    expect(calls).toEqual(["reset"]);
    expect(confirm.hidden).toBe(true);
  });

  it("Rotate, Undo and Done call the actions", () => {
    const { b, calls, button, model } = bar();
    model.model.enter();
    model.model.select("plant_2");
    model.model.step(-1, 0);
    model.answer();
    b.update(model.model.view());
    button("Rotate (R)").click();
    button("Undo").click();
    button("Done").click();
    expect(calls).toEqual(["rotate", "undo", "done"]);
  });
});
