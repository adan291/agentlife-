import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { ServerMsgSchema } from "@agentlife/shared";
import type { ClientMsg, RoomDef, ServerMsg } from "@agentlife/shared";
import { startGateway } from "../src/gateway.ts";
import type { Gateway } from "../src/gateway.ts";
import { LayoutStore, defaultLayoutsFile } from "../src/layout-store.ts";
import { testHotel } from "./helpers.ts";

let dir: string;
let file: string;
const gateways: Gateway[] = [];
const sockets: WebSocket[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "agentlife-layouts-"));
  file = join(dir, "layouts.json");
});
afterEach(async () => {
  for (const s of sockets.splice(0)) s.terminate();
  for (const g of gateways.splice(0)) await g.close();
  rmSync(dir, { recursive: true, force: true });
});

/** A gateway on a project floor (or the lobby), backed by a layout store in a scratch folder. */
async function boot(start: "lobby" | "project:demo" = "project:demo", store = new LayoutStore({ file })) {
  const hotel = testHotel({ start, projects: ["demo"], layouts: store });
  const gateway = await startGateway({ hotel, port: 0, tickMs: 5, layouts: store });
  gateways.push(gateway);
  return { gateway, hotel, store };
}

function connect(port: number) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  sockets.push(ws);
  const received: ServerMsg[] = [];
  ws.on("message", (d) => received.push(ServerMsgSchema.parse(JSON.parse(d.toString()))));
  const open = new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  const waitFor = async <T extends ServerMsg>(pred: (m: ServerMsg) => m is T, from = 0, timeoutMs = 3000): Promise<T> => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = received.slice(from).find(pred);
      if (found) return found;
      if (Date.now() > deadline) throw new Error("timed out");
      await new Promise((r) => setTimeout(r, 10));
    }
  };
  const send = (msg: ClientMsg) => ws.send(JSON.stringify(msg));
  /** Sends and waits for the answer to this message only. */
  const ask = async (msg: ClientMsg): Promise<ServerMsg> => {
    const from = received.length;
    send(msg);
    return waitFor((m): m is ServerMsg => m.type === "room_layout" || (m.type === "error" && m.code === "layout_error"), from);
  };
  return { ws, received, open, send, ask, waitFor };
}

const welcomeRoom = async (c: ReturnType<typeof connect>): Promise<RoomDef> => (await c.waitFor((m): m is Extract<ServerMsg, { type: "welcome" }> => m.type === "welcome")).room;
const at = (room: RoomDef, id: string) => room.furni.find((p) => p.itemId === id)!;
const saved = () => JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;

describe("furni_move through the gateway", () => {
  it("moves a piece, answers with the new pieces and anchors, and saves the layout", async () => {
    const { gateway } = await boot();
    const c = connect(gateway.port);
    await c.open;
    const before = await welcomeRoom(c);
    expect(at(before, "plant_2")).toMatchObject({ x: 9, y: 8 });

    const reply = await c.ask({ type: "furni_move", itemId: "plant_2", x: 8, y: 8, dir: 4 });
    expect(reply).toMatchObject({ type: "room_layout", roomId: "project:demo" });
    if (reply.type !== "room_layout") return;
    expect(reply.furni.find((p) => p.itemId === "plant_2")).toMatchObject({ x: 8, y: 8, dir: 4 });
    expect(reply.furni).toHaveLength(before.furni.length);
    expect(reply.anchors).toHaveLength(before.anchors.length);
    expect(saved()).toEqual({ "project:demo": { plant_2: { x: 8, y: 8, dir: 4 } } });
  });

  it("a desk that moves sends its seat along in the answer", async () => {
    const { gateway } = await boot();
    const c = connect(gateway.port);
    await c.open;
    await welcomeRoom(c);
    const reply = await c.ask({ type: "furni_move", itemId: "desk_architect", x: 8, y: 7, dir: 2 });
    if (reply.type !== "room_layout") throw new Error(JSON.stringify(reply));
    expect(reply.anchors.find((a) => a.name === "desk" && a.agent === "architect")).toMatchObject({ x: 9, y: 7, dir: 6 });
  });

  it.each([
    ["outside the room", { itemId: "plant_2", x: 20, y: 3, dir: 4 }, "That is outside the room."],
    ["on a taken tile", { itemId: "plant_2", x: 4, y: 2, dir: 4 }, "That tile is taken by the agent desk."],
    ["on the way to the mailbox", { itemId: "plant_2", x: 1, y: 6, dir: 4 }, "Blocks the path to the mailbox."],
    ["the elevator", { itemId: "elevator_1", x: 0, y: 4, dir: 2 }, "The elevator stays where it is."],
    ["a piece that is not in the room", { itemId: "plant_99", x: 3, y: 3, dir: 4 }, "That piece is not in this room."],
  ] as const)("refuses a move %s with a reason, and changes and saves nothing", async (_name, body, reason) => {
    const { gateway } = await boot();
    const c = connect(gateway.port);
    await c.open;
    await welcomeRoom(c);
    const from = c.received.length;
    const reply = await c.ask({ type: "furni_move", ...body });
    expect(reply).toEqual({ type: "error", code: "layout_error", message: reason });
    expect(c.received.slice(from).some((m) => m.type === "room_layout")).toBe(false);
    expect(existsSync(file)).toBe(false);
  });

  it("arranges the lobby and the HR office too, and saves each under its own room id", async () => {
    const { gateway, hotel } = await boot("lobby");
    const c = connect(gateway.port);
    await c.open;
    const room = await welcomeRoom(c);
    const lobbyPlant = room.furni.find((p) => p.itemId === "plant_1")!;
    const reply = await c.ask({ type: "furni_move", itemId: lobbyPlant.itemId, x: 9, y: 3, dir: 4 });
    expect(reply).toMatchObject({ type: "room_layout", roomId: "lobby" });
    expect(hotel.sim("lobby")!.room.furni.find((p) => p.itemId === "plant_1")).toMatchObject({ x: 9, y: 3 });
    expect(saved()).toEqual({ lobby: { plant_1: { x: 9, y: 3, dir: 4 } } });
    // A turn in place, and the reset.
    expect(await c.ask({ type: "furni_move", itemId: "plant_1", x: 9, y: 3, dir: 6 })).toMatchObject({ type: "room_layout" });
    expect(await c.ask({ type: "furni_reset" })).toMatchObject({ type: "room_layout", roomId: "lobby" });
    expect(saved()).toEqual({});
  });

  it("the elevator and the doors of the lobby stay where they are", async () => {
    const { gateway } = await boot("lobby");
    const c = connect(gateway.port);
    await c.open;
    await welcomeRoom(c);
    expect(await c.ask({ type: "furni_move", itemId: "elevator_1", x: 3, y: 3, dir: 2 })).toEqual({ type: "error", code: "layout_error", message: "The elevator stays where it is." });
    expect(await c.ask({ type: "furni_move", itemId: "door_hr", x: 3, y: 3, dir: 4 })).toMatchObject({ type: "error", code: "layout_error" });
    expect(existsSync(file)).toBe(false);
  });

  it("the HR office is arranged and the arrangement is there after a restart", async () => {
    const first = await boot("lobby");
    const c1 = connect(first.gateway.port);
    await c1.open;
    await welcomeRoom(c1);
    // Go to the HR office by the list route (no walking), then move its plant.
    c1.send({ type: "go_to", roomId: "hr", via: "list" });
    await c1.waitFor((m): m is Extract<ServerMsg, { type: "welcome" }> => m.type === "welcome" && m.room.id === "hr");
    expect(await c1.ask({ type: "furni_move", itemId: "plant_2", x: 8, y: 3, dir: 4 })).toMatchObject({ type: "room_layout", roomId: "hr" });
    expect(saved()).toEqual({ hr: { plant_2: { x: 8, y: 3, dir: 4 } } });
    c1.ws.terminate();
    await first.gateway.close();
    gateways.splice(gateways.indexOf(first.gateway), 1);

    const second = await boot("lobby", new LayoutStore({ file }));
    expect(at(second.hotel.sim("hr")!.room, "plant_2")).toMatchObject({ x: 8, y: 3 });
  });

  it("bought furniture is refused outside project floors", async () => {
    const { gateway } = await boot("lobby");
    const c = connect(gateway.port);
    await c.open;
    await welcomeRoom(c);
    const refusal = { type: "error", code: "layout_error", message: "Bought furniture can only stand on project floors." };
    expect(await c.ask({ type: "furni_place", itemId: "fern", x: 3, y: 3, dir: 4 })).toEqual(refusal);
    expect(await c.ask({ type: "furni_pickup", itemId: "bought_1" })).toEqual(refusal);
  });

  it("a piece cannot be dropped on somebody who is walking there", async () => {
    const { gateway } = await boot();
    const c = connect(gateway.port);
    await c.open;
    await welcomeRoom(c);
    c.send({ type: "move", x: 8, y: 8 });
    await c.waitFor((m): m is Extract<ServerMsg, { type: "walk" }> => m.type === "walk");
    const reply = await c.ask({ type: "furni_move", itemId: "plant_1", x: 8, y: 8, dir: 4 });
    expect(reply).toEqual({ type: "error", code: "layout_error", message: "Someone is standing there." });
  });

  it("furni_reset puts every piece back and removes the saved layout", async () => {
    const { gateway } = await boot();
    const c = connect(gateway.port);
    await c.open;
    await welcomeRoom(c);
    await c.ask({ type: "furni_move", itemId: "plant_2", x: 8, y: 8, dir: 4 });
    await c.ask({ type: "furni_move", itemId: "sofa_1", x: 2, y: 4, dir: 4 });
    expect(Object.keys((saved()["project:demo"] ?? {}) as object).sort()).toEqual(["plant_2", "sofa_1"]);
    const reply = await c.ask({ type: "furni_reset" });
    if (reply.type !== "room_layout") throw new Error(JSON.stringify(reply));
    expect(reply.furni.find((p) => p.itemId === "plant_2")).toMatchObject({ x: 9, y: 8 });
    expect(reply.furni.find((p) => p.itemId === "sofa_1")).toMatchObject({ x: 6, y: 9 });
    expect(saved()).toEqual({});
  });

  it("when the layout cannot be written the room does not change", async () => {
    // The file's parent is a regular file, so the store cannot create it.
    const blocker = join(dir, "blocker");
    writeFileSync(blocker, "x");
    const store = new LayoutStore({ file: join(blocker, "layouts.json") });
    const { gateway, hotel } = await boot("project:demo", store);
    const c = connect(gateway.port);
    await c.open;
    await welcomeRoom(c);
    const reply = await c.ask({ type: "furni_move", itemId: "plant_2", x: 8, y: 8, dir: 4 });
    expect(reply).toEqual({ type: "error", code: "layout_error", message: "The layout could not be saved." });
    expect(at(hotel.sim("project:demo")!.room, "plant_2")).toMatchObject({ x: 9, y: 8 });
    expect(store.get("project:demo")).toBeUndefined();
  });

  it("the move works without a store, it is just not kept", async () => {
    const hotel = testHotel({ start: "project:demo", projects: ["demo"] });
    const gateway = await startGateway({ hotel, port: 0, tickMs: 5 });
    gateways.push(gateway);
    const c = connect(gateway.port);
    await c.open;
    await welcomeRoom(c);
    expect(await c.ask({ type: "furni_move", itemId: "plant_2", x: 8, y: 8, dir: 4 })).toMatchObject({ type: "room_layout" });
  });
});

describe("a saved layout survives a restart", () => {
  it("a new gateway on the same file builds the floor with the arrangement", async () => {
    const first = await boot();
    const c1 = connect(first.gateway.port);
    await c1.open;
    await welcomeRoom(c1);
    await c1.ask({ type: "furni_move", itemId: "plant_2", x: 8, y: 8, dir: 4 });
    await c1.ask({ type: "furni_move", itemId: "desk_qa", x: 10, y: 6, dir: 6 });
    c1.ws.terminate();
    await first.gateway.close();
    gateways.splice(gateways.indexOf(first.gateway), 1);

    const second = await boot("project:demo", new LayoutStore({ file }));
    const c2 = connect(second.gateway.port);
    await c2.open;
    const room = await welcomeRoom(c2);
    expect(at(room, "plant_2")).toMatchObject({ x: 8, y: 8 });
    expect(at(room, "desk_qa")).toMatchObject({ x: 10, y: 6 });
    expect(room.anchors.find((a) => a.name === "desk" && a.agent === "qa")).toMatchObject({ x: 9, y: 6 });
    expect(at(room, "plant_1")).toMatchObject({ x: 11, y: 0 });
  });

  it("a piece that no longer fits (the template changed) goes back to the template position, the rest stays", async () => {
    // plant_1 and plant_2 on one tile cannot both be there; sofa_1 on its own is fine.
    writeFileSync(
      file,
      JSON.stringify({
        demo: { plant_2: { x: 8, y: 8, dir: 4 }, plant_1: { x: 8, y: 8, dir: 4 }, sofa_1: { x: 2, y: 4, dir: 4 }, gone_9: { x: 2, y: 2, dir: 4 } },
      }),
    );
    const { gateway } = await boot();
    const c = connect(gateway.port);
    await c.open;
    const room = await welcomeRoom(c);
    expect(at(room, "plant_2")).toMatchObject({ x: 8, y: 8 });
    expect(at(room, "plant_1")).toMatchObject({ x: 11, y: 0 });
    expect(at(room, "sofa_1")).toMatchObject({ x: 2, y: 4 });
  });
});

describe("LayoutStore", () => {
  it("keeps what was set, across instances, and writes through a temporary file that does not stay", () => {
    const a = new LayoutStore({ file });
    a.set("project:demo", { plant_2: { x: 8, y: 8, dir: 4 } });
    a.set("lobby", { sofa_1: { x: 3, y: 1, dir: 0 } });
    expect(readdirSync(dir)).toEqual(["layouts.json"]);
    const b = new LayoutStore({ file });
    expect(b.get("project:demo")).toEqual({ plant_2: { x: 8, y: 8, dir: 4 } });
    expect(b.get("lobby")).toEqual({ sofa_1: { x: 3, y: 1, dir: 0 } });
    expect(b.get("hr")).toBeUndefined();
    expect(b.get("project:nobody")).toBeUndefined();
  });

  it("reads a file written before every room could be arranged (bare project ids) and writes it back with room ids", () => {
    writeFileSync(file, JSON.stringify({ demo: { plant_2: { x: 8, y: 8, dir: 4 } } }));
    const s = new LayoutStore({ file });
    expect(s.get("project:demo")).toEqual({ plant_2: { x: 8, y: 8, dir: 4 } });
    expect(s.get("demo")).toBeUndefined();
    // Nothing is rewritten until something changes; then the whole file is in the new form.
    expect(saved()).toEqual({ demo: { plant_2: { x: 8, y: 8, dir: 4 } } });
    s.set("lobby", { plant_1: { x: 9, y: 3, dir: 4 } });
    expect(saved()).toEqual({ "project:demo": { plant_2: { x: 8, y: 8, dir: 4 } }, lobby: { plant_1: { x: 9, y: 3, dir: 4 } } });
  });

  it("an empty layout removes the entry; removing what is not there writes nothing", () => {
    const s = new LayoutStore({ file });
    s.set("project:demo", {});
    expect(existsSync(file)).toBe(false);
    s.set("project:demo", { plant_2: { x: 8, y: 8, dir: 4 } });
    s.set("project:demo", {});
    expect(saved()).toEqual({});
    expect(new LayoutStore({ file }).get("project:demo")).toBeUndefined();
  });

  it.each([
    ["not JSON", "{ this is not json"],
    ["the wrong shape", JSON.stringify({ demo: { plant_2: { x: "left", y: 1, dir: 4 } } })],
    ["a direction that does not exist", JSON.stringify({ demo: { plant_2: { x: 1, y: 1, dir: 3 } } })],
    ["a room id that does not exist", JSON.stringify({ "Not A Room": { plant_2: { x: 1, y: 1, dir: 4 } } })],
    ["a list", "[]"],
  ])("moves a file with %s aside, starts empty, and never overwrites the original", (_name, content) => {
    writeFileSync(file, content);
    const logs: string[] = [];
    const s = new LayoutStore({ file, now: () => 12345, onLog: (m) => logs.push(m) });
    expect(s.get("project:demo")).toBeUndefined();
    const aside = join(dir, "layouts.json.bad-12345");
    expect(readFileSync(aside, "utf8")).toBe(content);
    expect(existsSync(file)).toBe(false);
    expect(logs).toHaveLength(1);
    // New work goes to a fresh file; the one set aside stays as it was.
    s.set("project:demo", { plant_2: { x: 8, y: 8, dir: 4 } });
    expect(readFileSync(aside, "utf8")).toBe(content);
    expect(new LayoutStore({ file }).get("project:demo")).toEqual({ plant_2: { x: 8, y: 8, dir: 4 } });
  });

  it("a failed write throws and keeps the old state", () => {
    const blocker = join(dir, "blocker");
    writeFileSync(blocker, "x");
    const s = new LayoutStore({ file: join(blocker, "layouts.json") });
    expect(() => s.set("project:demo", { plant_2: { x: 8, y: 8, dir: 4 } })).toThrow();
    expect(s.get("project:demo")).toBeUndefined();
  });

  it("uses data/layouts.json at the repository root, or AGENTLIFE_LAYOUTS_FILE", () => {
    expect(defaultLayoutsFile({})).toMatch(/data[\\/]layouts\.json$/);
    expect(defaultLayoutsFile({ AGENTLIFE_LAYOUTS_FILE: "elsewhere.json" })).toBe("elsewhere.json");
  });
});
