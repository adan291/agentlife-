import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { EconomyConfigSchema, ServerMsgSchema } from "@agentlife/shared";
import type { AgentEvent, ClientMsg, Project, RoomDef, ServerMsg } from "@agentlife/shared";
import { Economy } from "../src/economy-store.ts";
import { EventQueue } from "../src/engine-link.ts";
import type { EngineLink } from "../src/engine-link.ts";
import { startGateway } from "../src/gateway.ts";
import type { Gateway } from "../src/gateway.ts";
import { LayoutStore } from "../src/layout-store.ts";
import { testHotel } from "./helpers.ts";

let dir: string;
const gateways: Gateway[] = [];
const sockets: WebSocket[] = [];
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "agentlife-placing-"));
});
afterEach(async () => {
  for (const s of sockets.splice(0)) s.terminate();
  for (const g of gateways.splice(0)) await g.close();
  rmSync(dir, { recursive: true, force: true });
});

const config = EconomyConfigSchema.parse({ version: 1, grants: { job_passed: 15, branch_delivered: 20, review_finished: 10, memory_accepted: 5, night_summary: 25 } });
const SINCE = 1000;
const walletFile = () => join(dir, "wallet.json");
const inventoryFile = () => join(dir, "inventory.json");
const layoutsFile = () => join(dir, "layouts.json");
const inventoryOnDisk = () => JSON.parse(readFileSync(inventoryFile(), "utf8")) as { stock: Record<string, number>; placed: Record<string, { id: string; itemId: string; x: number; y: number; dir: number }[]>; seq: number };

/** An economy in the scratch folder with `nights` times 25 Ecto and the items bought. */
function economy(nights: number, buy: string[] = []): Economy {
  const e = new Economy({ walletFile: walletFile(), inventoryFile: inventoryFile(), config, now: () => SINCE });
  for (let i = 0; i < nights; i++) e.grant("night_summary", `2026-11-${String(10 + i).padStart(2, "0")}`, SINCE + 10);
  for (const id of buy) {
    const r = e.buy(id);
    if (!r.ok) throw new Error(r.reason);
  }
  return e;
}

const project = (id: string): Project => ({ id, name: id, stack: "node-npm", testCommand: "npm test", builtin: false, registeredAt: 1 });
/** An engine that lists the projects the test sets: the gateway builds and removes floors to match. */
function engineWith(initial: string[]) {
  const queue = new EventQueue<AgentEvent>();
  let projects = initial.map(project);
  const link: EngineLink = {
    listRepos: () => Promise.resolve(projects.map((p) => ({ id: p.id, name: p.name }))),
    startJob: (repoId) => Promise.resolve({ taskId: `task-${repoId}` }),
    resolveApproval: () => Promise.resolve(),
    getJob: (taskId) => Promise.resolve({ taskId, repoId: taskId.replace("task-", ""), goal: "g", state: "analyzing", timeline: [] }),
    listProjects: () => Promise.resolve(projects),
    getJobDetails: () => Promise.reject(new Error("not used")),
    events: () => queue,
    close: () => queue.close(),
  };
  return { link, setProjects: (ids: string[]) => (projects = ids.map(project)) };
}

interface BootOptions {
  eco?: Economy | undefined;
  engine?: EngineLink;
  projects?: string[];
  start?: "lobby" | "project:alpha";
}

/** A gateway on a floor, with the stores of the scratch folder; the floors are built with the bought pieces, as `main.ts` does. */
async function boot(o: BootOptions = {}) {
  const eco = "eco" in o ? o.eco : economy(8);
  const layouts = new LayoutStore({ file: layoutsFile() });
  const hotel = testHotel({ start: o.start ?? "project:alpha", projects: o.engine ? [] : (o.projects ?? ["alpha"]), layouts, ...(eco ? { extras: eco } : {}) });
  const gateway = await startGateway({ hotel, port: 0, tickMs: 5, layouts, ...(eco ? { economy: eco } : {}), ...(o.engine ? { engine: o.engine } : {}) });
  gateways.push(gateway);
  return { gateway, hotel, eco, layouts };
}

function connect(port: number) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  sockets.push(ws);
  const received: ServerMsg[] = [];
  const waiters: (() => void)[] = [];
  ws.on("message", (d) => {
    received.push(ServerMsgSchema.parse(JSON.parse(d.toString())));
    waiters.splice(0).forEach((w) => w());
  });
  const waitFor = async (pred: () => boolean, timeoutMs = 3000): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    while (!pred()) {
      const left = deadline - Date.now();
      if (left <= 0) throw new Error("timed out");
      await new Promise<void>((r) => {
        waiters.push(r);
        setTimeout(r, Math.min(left, 25));
      });
    }
  };
  const send = (msg: ClientMsg) => ws.send(JSON.stringify(msg));
  const layoutErrors = () => received.flatMap((m) => (m.type === "error" && m.code === "layout_error" ? [m.message] : []));
  const layouts = () => received.flatMap((m) => (m.type === "room_layout" ? [m] : []));
  const shops = () => received.flatMap((m) => (m.type === "shop" ? [m.state] : []));
  const welcome = (): RoomDef => (received.find((m) => m.type === "welcome") as Extract<ServerMsg, { type: "welcome" }>).room;
  /** Sends and waits for the next room_layout or layout error; says which one came. */
  const ask = async (msg: ClientMsg): Promise<"layout" | "error"> => {
    const l = layouts().length;
    const e = layoutErrors().length;
    send(msg);
    await waitFor(() => layouts().length > l || layoutErrors().length > e);
    return layouts().length > l ? "layout" : "error";
  };
  const ready = () => waitFor(() => received.some((m) => m.type === "welcome"));
  return { ws, received, waitFor, send, layoutErrors, layouts, shops, welcome, ask, ready };
}
type Conn = ReturnType<typeof connect>;

const place = (itemId: string, x: number, y: number, dir: 0 | 2 | 4 | 6 = 4): ClientMsg => ({ type: "furni_place", itemId, x, y, dir });
const lastRoom = (c: Conn) => c.layouts().at(-1)!;
const boughtIds = (c: Conn) => lastRoom(c).furni.filter((p) => p.itemId.startsWith("bought_")).map((p) => p.itemId);

describe("furni_place and furni_pickup through the gateway", () => {
  it("places an item from the stock: the room and the stock change together and both files are written", async () => {
    const { gateway } = await boot({ eco: economy(8, ["fern", "fern", "wall_clock"]) });
    const c = connect(gateway.port);
    await c.ready();
    expect(await c.ask(place("fern", 2, 1))).toBe("layout");
    expect(lastRoom(c).furni.find((p) => p.itemId === "bought_1")).toMatchObject({ defId: "fern", x: 2, y: 1, dir: 4 });
    await c.waitFor(() => c.shops().length === 1);
    expect(c.shops()[0]!.stock).toEqual([
      { itemId: "fern", count: 1 },
      { itemId: "wall_clock", count: 1 },
    ]);
    expect(inventoryOnDisk()).toMatchObject({ stock: { fern: 1, wall_clock: 1 }, seq: 1, placed: { alpha: [{ id: "bought_1", itemId: "fern", x: 2, y: 1, dir: 4 }] } });
    // The template layout file is not touched by a bought piece (it is not even created).
    expect(existsSync(layoutsFile())).toBe(false);
    expect(await c.ask(place("wall_clock", 2, 0))).toBe("layout");
    expect(boughtIds(c)).toEqual(["bought_1", "bought_2"]);
  });

  it("refuses with the reason and changes nothing", async () => {
    const { gateway } = await boot({ eco: economy(8, ["fern"]) });
    const c = connect(gateway.port);
    await c.ready();
    const refused: [ClientMsg, string][] = [
      [place("fern", 9, 8), "That tile is taken."],
      [place("fern", 30, 30), "That is outside the room."],
      [place("fern", 5, 3), "A standing spot of the team is on that tile."],
      [place("wall_clock", 6, 5), "You do not have that item."],
      [place("armchair", 2, 1), "You do not have that item."],
    ];
    for (const [msg, reason] of refused) {
      const before = c.layoutErrors().length;
      c.send(msg);
      await c.waitFor(() => c.layoutErrors().length > before);
      expect(c.layoutErrors().at(-1), JSON.stringify(msg)).toBe(reason);
    }
    expect(c.layouts()).toEqual([]);
    expect(inventoryOnDisk().stock).toEqual({ fern: 1 });
    expect(inventoryOnDisk().placed).toEqual({});
  });

  it("a wall piece goes on a wall only, and a piece that blocks the way is refused", async () => {
    const { gateway } = await boot({ eco: economy(8, ["wall_clock", "fern"]) });
    const c = connect(gateway.port);
    await c.ready();
    expect(await c.ask(place("wall_clock", 6, 5))).toBe("error");
    expect(c.layoutErrors().at(-1)).toBe("This piece goes on a wall.");
    expect(await c.ask(place("fern", 4, 7))).toBe("error");
    expect(c.layoutErrors().at(-1)).toMatch(/^(Blocks the path|Nobody could reach)/);
    expect(inventoryOnDisk().stock).toEqual({ fern: 1, wall_clock: 1 });
  });

  it("is refused in the lobby and when the hotel has no economy", async () => {
    const lobby = await boot({ eco: economy(8, ["fern"]), start: "lobby" });
    const a = connect(lobby.gateway.port);
    await a.ready();
    a.send(place("fern", 2, 1));
    await a.waitFor(() => a.layoutErrors().length === 1);
    expect(a.layoutErrors()).toEqual(["Only project floors can be arranged."]);

    const none = await boot({ eco: undefined });
    const b = connect(none.gateway.port);
    await b.ready();
    b.send(place("fern", 2, 1));
    await b.waitFor(() => b.layoutErrors().length === 1);
    expect(b.layoutErrors()).toEqual(["You have nothing to place: the shop is closed."]);
  });

  it("picks a bought piece up into the stock, and refuses every piece of the template", async () => {
    const { gateway } = await boot({ eco: economy(8, ["fern"]) });
    const c = connect(gateway.port);
    await c.ready();
    await c.ask(place("fern", 2, 1));
    expect(await c.ask({ type: "furni_pickup", itemId: "bought_1" })).toBe("layout");
    expect(boughtIds(c)).toEqual([]);
    await c.waitFor(() => c.shops().length === 2);
    expect(c.shops()[1]!.stock).toEqual([{ itemId: "fern", count: 1 }]);
    expect(inventoryOnDisk()).toMatchObject({ stock: { fern: 1 }, placed: {} });

    const template = ["desk_architect", "computer_desk_1", "mailbox_1", "board_1", "review_desk_1", "test_lab_1", "library_shelf_1", "elevator_1", "plant_2"];
    expect(template.every((id) => c.welcome().furni.some((p) => p.itemId === id))).toBe(true);
    for (const id of template) {
      const before = c.layoutErrors().length;
      c.send({ type: "furni_pickup", itemId: id });
      await c.waitFor(() => c.layoutErrors().length > before);
      expect(c.layoutErrors().at(-1), id).toBe("That piece belongs to the room. You can move it, not pick it up.");
    }
    c.send({ type: "furni_pickup", itemId: "bought_77" });
    await c.waitFor(() => c.layoutErrors().length === template.length + 1);
    expect(c.layoutErrors().at(-1)).toBe("That piece is not in this room.");
    expect(inventoryOnDisk().stock).toEqual({ fern: 1 });
  });

  it("moves a bought piece (kept in the inventory file) and a template piece (kept in the layout file)", async () => {
    const { gateway } = await boot({ eco: economy(8, ["fern"]) });
    const c = connect(gateway.port);
    await c.ready();
    await c.ask(place("fern", 2, 1));
    expect(await c.ask({ type: "furni_move", itemId: "bought_1", x: 3, y: 1, dir: 6 })).toBe("layout");
    expect(inventoryOnDisk().placed["alpha"]).toEqual([{ id: "bought_1", itemId: "fern", x: 3, y: 1, dir: 6 }]);
    expect(existsSync(layoutsFile())).toBe(false);
    expect(await c.ask({ type: "furni_move", itemId: "plant_2", x: 8, y: 8, dir: 4 })).toBe("layout");
    expect(JSON.parse(readFileSync(layoutsFile(), "utf8"))).toEqual({ alpha: { plant_2: { x: 8, y: 8, dir: 4 } } });
    expect(inventoryOnDisk().placed["alpha"]).toEqual([{ id: "bought_1", itemId: "fern", x: 3, y: 1, dir: 6 }]);

    // A refused move of a bought piece changes neither file.
    expect(await c.ask({ type: "furni_move", itemId: "bought_1", x: 8, y: 8, dir: 4 })).toBe("error");
    expect(c.layoutErrors().at(-1)).toBe("That tile is taken.");
    expect(inventoryOnDisk().placed["alpha"]).toEqual([{ id: "bought_1", itemId: "fern", x: 3, y: 1, dir: 6 }]);
  });

  it("Reset layout puts the template back and leaves the bought pieces where they are", async () => {
    const { gateway } = await boot({ eco: economy(8, ["fern"]) });
    const c = connect(gateway.port);
    await c.ready();
    await c.ask(place("fern", 2, 1));
    await c.ask({ type: "furni_move", itemId: "plant_2", x: 8, y: 8, dir: 4 });
    expect(await c.ask({ type: "furni_reset" })).toBe("layout");
    expect(lastRoom(c).furni.find((p) => p.itemId === "plant_2")).toMatchObject({ x: 9, y: 8 });
    expect(boughtIds(c)).toEqual(["bought_1"]);
    expect(inventoryOnDisk().placed["alpha"]).toHaveLength(1);
  });

  it("refuses to place when the inventory cannot be written, and changes nothing", async () => {
    const eco = economy(8, ["fern"]);
    const { gateway } = await boot({ eco });
    const c = connect(gateway.port);
    await c.ready();
    rmSync(inventoryFile());
    // A folder where the file should be: the rename fails.
    const { mkdirSync } = await import("node:fs");
    mkdirSync(inventoryFile());
    expect(await c.ask(place("fern", 2, 1))).toBe("error");
    expect(c.layoutErrors().at(-1)).toBe("The layout could not be saved.");
    expect(c.layouts()).toEqual([]);
    expect(eco.shop().stock).toEqual([{ itemId: "fern", count: 1 }]);
  });
});

describe("what the files remember", () => {
  it("a restart builds the floor with the pieces and the stock the user left", async () => {
    const first = await boot({ eco: economy(8, ["fern", "armchair"]) });
    const a = connect(first.gateway.port);
    await a.ready();
    await a.ask(place("fern", 2, 1));
    await a.ask({ type: "furni_move", itemId: "bought_1", x: 3, y: 1, dir: 2 });
    await first.gateway.close();
    gateways.splice(0);

    const second = await boot({ eco: economy(0) });
    const b = connect(second.gateway.port);
    await b.ready();
    expect(b.welcome().furni.find((p) => p.itemId === "bought_1")).toMatchObject({ defId: "fern", x: 3, y: 1, dir: 2 });
    b.send({ type: "shop_state" });
    await b.waitFor(() => b.shops().length === 1);
    expect(b.shops()[0]!.stock).toEqual([{ itemId: "armchair", count: 1 }]);
    // The next piece does not reuse the number.
    expect(await b.ask(place("armchair", 6, 1))).toBe("layout");
    expect(boughtIds(b)).toEqual(["bought_1", "bought_2"]);
  });
});

describe("pieces that come back to the inventory", () => {
  const stockOf = async (c: Conn): Promise<Record<string, number>> => {
    const before = c.shops().length;
    c.send({ type: "shop_state" });
    await c.waitFor(() => c.shops().length > before);
    return Object.fromEntries(c.shops().at(-1)!.stock.map((s) => [s.itemId, s.count]));
  };

  it("a removed project gives its placed pieces back, also when it was removed while the world-server was off", async () => {
    const e = engineWith(["alpha", "beta"]);
    const eco = economy(8, ["fern", "fern", "cactus"]);
    const { gateway } = await boot({ eco, engine: e.link });
    const c = connect(gateway.port);
    await c.ready();
    expect(c.welcome().id).toBe("project:alpha");
    expect(await c.ask(place("fern", 2, 1))).toBe("layout");
    expect(inventoryOnDisk().placed["alpha"]).toHaveLength(1);

    // The engine no longer lists alpha: a new look at the projects (a new connection) removes the floor.
    e.setProjects(["beta"]);
    const d = connect(gateway.port);
    await d.ready();
    await d.waitFor(() => d.received.some((m) => m.type === "floors" && !m.floors.some((f) => f.roomId === "project:alpha")));
    expect(await stockOf(d)).toEqual({ fern: 2, cactus: 1 });
    expect(inventoryOnDisk()).toMatchObject({ stock: { fern: 2, cactus: 1 }, placed: {} });
  });

  it("a project that vanished while the world-server was off returns its pieces on the first look at the engine", async () => {
    const eco = economy(8, ["fern"]);
    const first = await boot({ eco });
    const a = connect(first.gateway.port);
    await a.ready();
    await a.ask(place("fern", 2, 1));
    await first.gateway.close();
    gateways.splice(0);

    const e = engineWith(["beta"]);
    const second = await boot({ eco: economy(0), engine: e.link, start: "lobby" });
    const b = connect(second.gateway.port);
    await b.ready();
    await b.waitFor(() => Object.keys(inventoryOnDisk().placed).length === 0);
    expect(await stockOf(b)).toEqual({ fern: 1 });
    expect(inventoryOnDisk()).toMatchObject({ stock: { fern: 1 }, placed: {} });
  });

  it("a piece the floor cannot take (the template changed under it) goes back to the stock", async () => {
    const eco = economy(8, ["fern"]);
    const first = await boot({ eco });
    const a = connect(first.gateway.port);
    await a.ready();
    await a.ask(place("fern", 2, 1));
    await first.gateway.close();
    gateways.splice(0);

    // The file now says the fern stands on the plant of the template.
    const onDisk = inventoryOnDisk();
    const { writeFileSync } = await import("node:fs");
    writeFileSync(inventoryFile(), JSON.stringify({ version: 1, stock: onDisk.stock, placed: { alpha: [{ id: "bought_1", itemId: "fern", x: 9, y: 8, dir: 4 }] }, seq: 1 }), "utf8");

    const e = engineWith(["alpha"]);
    const second = await boot({ eco: economy(0), engine: e.link, start: "lobby" });
    const b = connect(second.gateway.port);
    await b.ready();
    // The first look at the engine puts the piece back (nobody was connected when it was read, so the answer is the stock).
    await b.waitFor(() => Object.keys(inventoryOnDisk().placed).length === 0);
    expect(await stockOf(b)).toEqual({ fern: 1 });
    expect(inventoryOnDisk()).toMatchObject({ stock: { fern: 1 }, placed: {} });
  });
});
