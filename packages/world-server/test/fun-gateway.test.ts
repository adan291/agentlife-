import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { EconomyConfigSchema, ServerMsgSchema } from "@agentlife/shared";
import type { AgentEvent, AgentState, ClientMsg, Hotel, ScopedAgentId, ServerMsg } from "@agentlife/shared";
import { Economy } from "../src/economy-store.ts";
import { EventQueue } from "../src/engine-link.ts";
import type { EngineLink } from "../src/engine-link.ts";
import { startGateway } from "../src/gateway.ts";
import type { Gateway } from "../src/gateway.ts";
import { testHotel } from "./helpers.ts";

let dir: string;
const gateways: Gateway[] = [];
const sockets: WebSocket[] = [];
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "agentlife-fun-gw-"));
});
afterEach(async () => {
  for (const s of sockets.splice(0)) s.terminate();
  for (const g of gateways.splice(0)) await g.close();
  rmSync(dir, { recursive: true, force: true });
});

const ROOM = "project:alpha";
const config = EconomyConfigSchema.parse({ version: 1, grants: { job_passed: 15, branch_delivered: 20, review_finished: 10, memory_accepted: 5, night_summary: 25 } });

type NewEvent = AgentEvent extends infer E ? (E extends AgentEvent ? Omit<E, "seq" | "ts"> & { ts?: number } : never) : never;

function engine() {
  const queue = new EventQueue<AgentEvent>();
  const link: EngineLink = {
    listRepos: () => Promise.resolve([]),
    listProjects: () => Promise.resolve([{ id: "alpha", name: "alpha", builtin: true, stack: "node-npm", testCommand: "npm test", registeredAt: 0 }]),
    startJob: () => Promise.reject(new Error("not used")),
    resolveApproval: () => Promise.resolve(),
    getJob: () => Promise.reject(new Error("not used")),
    events: () => queue,
    close: () => queue.close(),
  };
  let seq = 0;
  const push = (e: NewEvent) => queue.push({ seq: seq++, ts: Date.now(), ...e } as AgentEvent);
  /** A job that ends with a verdict and is delivered. `ts` is when it happened. */
  const job = (taskId: string, verdict: "pass" | "fail", ts = Date.now()) => {
    push({ type: "task.created", taskId, repoId: "alpha", goal: "a goal", ts });
    push({ type: "task.state_changed", taskId, state: "report_ready", reason: `verdict:${verdict}`, ts });
    push({ type: "task.state_changed", taskId, state: "delivered", ts });
  };
  const state = (role: string, s: AgentState, ts = Date.now()) => push({ type: "agent.state_changed", taskId: "task-1", agentId: `alpha:${role}` as ScopedAgentId, state: s, ts });
  return { link, push, job, state };
}

interface ConnectOptions {
  economy?: Economy;
  hotel?: Hotel;
  mood?: { busyMs?: number; tiredMs?: number; pollMs?: number };
  start?: "project:alpha" | "lobby";
}

async function connect(link: EngineLink, opts: ConnectOptions = {}) {
  const hotel = opts.hotel ?? testHotel({ start: opts.start ?? ROOM, projects: ["alpha"], ...(opts.economy ? { extras: opts.economy } : {}) });
  const gateway = await startGateway({
    hotel,
    engine: link,
    port: 0,
    tickMs: 5,
    nightPollMs: 60_000,
    ...(opts.economy ? { economy: opts.economy } : {}),
    ...(opts.mood ? { mood: opts.mood } : {}),
  });
  gateways.push(gateway);
  const ws = new WebSocket(`ws://127.0.0.1:${gateway.port}`);
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
        setTimeout(r, left);
      });
    }
  };
  await waitFor(() => received.some((m) => m.type === "welcome"));
  const welcome = received.find((m) => m.type === "welcome")!;
  const you = welcome.type === "welcome" ? welcome.you : 0;
  const send = (msg: ClientMsg | Record<string, unknown>) => ws.send(JSON.stringify(msg));
  const settle = (ms = 200) => new Promise<void>((r) => setTimeout(r, ms));
  return { received, waitFor, send, settle, you, hotel };
}

type Received = ServerMsg[];
const emotes = (r: Received) => r.flatMap((m) => (m.type === "emote" ? [m] : []));
const moods = (r: Received) => r.flatMap((m) => (m.type === "mood" ? [m] : []));
const says = (r: Received) => r.flatMap((m) => (m.type === "say" ? [m] : []));
const errors = (r: Received) => r.flatMap((m) => (m.type === "error" ? [m] : []));

describe("the mood of the desk agents through the gateway", () => {
  it("is sent after the welcome of a project floor, with the three desk roles, and not in the lobby", async () => {
    const e = engine();
    const c = await connect(e.link);
    await c.waitFor(() => moods(c.received).length > 0);
    expect(moods(c.received)[0]).toEqual({ type: "mood", roomId: ROOM, moods: { architect: "rested", developer: "rested", qa: "rested" } });
    expect(c.received.map((m) => m.type).indexOf("mood")).toBeGreaterThan(c.received.map((m) => m.type).indexOf("welcome"));

    const lobby = await connect(e.link, { start: "lobby" });
    await lobby.settle();
    expect(moods(lobby.received)).toEqual([]);
  });

  it("changes with the work of the day, also between two events, and is sent only when it changed", async () => {
    const e = engine();
    const c = await connect(e.link, { mood: { busyMs: 100, tiredMs: 250, pollMs: 20 } });
    e.state("developer", "working");
    await c.waitFor(() => moods(c.received).some((m) => m.moods.developer === "busy"), 4000);
    await c.waitFor(() => moods(c.received).some((m) => m.moods.developer === "tired"), 4000);
    const developer = moods(c.received).map((m) => m.moods.developer);
    expect(developer).toEqual(["rested", "busy", "tired"]);
    // The other desks stayed rested all the time, and nothing is sent while nothing changes.
    expect(moods(c.received).every((m) => m.moods.architect === "rested" && m.moods.qa === "rested")).toBe(true);
    const count = moods(c.received).length;
    await c.settle(150);
    expect(moods(c.received)).toHaveLength(count);
  });
});

describe("cheer and glum", () => {
  it("makes every ghost of the floor cheer when a job was delivered with a pass", async () => {
    const e = engine();
    const c = await connect(e.link);
    e.job("task-1", "pass");
    await c.waitFor(() => emotes(c.received).length >= 3);
    expect(emotes(c.received).map((m) => [m.id, m.emote]).sort()).toEqual([["architect", "cheer"], ["developer", "cheer"], ["qa", "cheer"]]);
  });

  it("makes them look glum after a fail verdict and after a job that failed on the way", async () => {
    const e = engine();
    const c = await connect(e.link);
    e.job("task-1", "fail");
    await c.waitFor(() => emotes(c.received).length >= 3);
    expect(new Set(emotes(c.received).map((m) => m.emote))).toEqual(new Set(["glum"]));

    const seen = emotes(c.received).length;
    e.push({ type: "task.created", taskId: "task-2", repoId: "alpha", goal: "a goal" });
    e.push({ type: "task.state_changed", taskId: "task-2", state: "failed", reason: "boom" });
    e.push({ type: "task.state_changed", taskId: "task-2", state: "report_ready", reason: "verdict:pass" });
    e.push({ type: "task.state_changed", taskId: "task-2", state: "delivered" });
    await c.waitFor(() => emotes(c.received).length >= seen + 3);
    expect(new Set(emotes(c.received).slice(seen).map((m) => m.emote))).toEqual(new Set(["glum"]));
  });

  it("does nothing for a job the gateway did not see start, for old news and for a job on another floor", async () => {
    const e = engine();
    const c = await connect(e.link);
    // The creation of this one was never seen.
    e.push({ type: "task.state_changed", taskId: "ghost-job", state: "delivered" });
    // A replay after a restart: the job is days old.
    e.job("old-job", "pass", Date.now() - 3 * 24 * 3_600_000);
    await c.settle(300);
    expect(emotes(c.received)).toEqual([]);

    const lobby = await connect(e.link, { start: "lobby" });
    e.job("task-5", "pass");
    await lobby.settle(300);
    expect(emotes(lobby.received)).toEqual([]);
  });
});

describe("sitting and emotes through the gateway", () => {
  it("sits on the sofa when it is clicked, and tells the client once the walk is over", async () => {
    const e = engine();
    const c = await connect(e.link);
    c.send({ type: "use", itemId: "sofa_1" });
    await c.waitFor(() => c.received.some((m) => m.type === "sit"));
    expect(c.received.find((m) => m.type === "sit")).toEqual({ type: "sit", id: c.you, sitting: true, dir: 0, itemId: "sofa_1" });
    // Getting up comes before the walk away.
    c.send({ type: "move", x: 5, y: 8 });
    await c.waitFor(() => c.received.some((m) => m.type === "sit" && !m.sitting));
    const types = c.received.map((m) => m.type);
    expect(types.lastIndexOf("sit")).toBeLessThan(types.lastIndexOf("walk"));
  });

  it("refuses a seat somebody sits on with seat_taken, and the user does not move", async () => {
    const e = engine();
    const hotel = testHotel({ start: ROOM, projects: ["alpha"] });
    const c = await connect(e.link, { hotel });
    hotel.sim(ROOM)!.sit("developer", "sofa_1");
    c.send({ type: "use", itemId: "sofa_1" });
    await c.waitFor(() => errors(c.received).some((m) => m.code === "seat_taken"));
    expect(errors(c.received).find((m) => m.code === "seat_taken")?.message).toBe("Somebody is sitting there.");
    expect(c.received.some((m) => m.type === "sit")).toBe(false);
    expect(c.received.some((m) => m.type === "walk" && m.id === c.you)).toBe(false);
  });

  it("sends the emotes of the user back to the room, and rejects the ones it does not know", async () => {
    const e = engine();
    const c = await connect(e.link);
    c.send({ type: "emote", emote: "wave" });
    await c.waitFor(() => emotes(c.received).length === 1);
    expect(emotes(c.received)[0]).toEqual({ type: "emote", id: c.you, emote: "wave" });
    c.send({ type: "emote", emote: "glum" });
    c.send({ type: "emote", emote: "moonwalk" });
    await c.waitFor(() => errors(c.received).filter((m) => m.code === "bad_message").length === 2);
    expect(emotes(c.received)).toHaveLength(1);
  });
});

describe("the coffee machine through the gateway", () => {
  /** A project floor with a bought coffee machine on it, found by trying places on a copy of the floor. */
  function withCoffeeMachine() {
    const probe = testHotel({ start: ROOM, projects: ["alpha"] });
    let found: { x: number; y: number; dir: 0 | 2 | 4 | 6 } | undefined;
    for (const t of probe.sim(ROOM)!.freeTiles()) {
      for (const dir of [0, 2, 4, 6] as const) {
        const piece = { itemId: "bought_1", defId: "coffee_machine", x: t.x, y: t.y, dir };
        if (!found && probe.placeFurniture(ROOM, piece, () => undefined).ok) found = { x: t.x, y: t.y, dir };
      }
    }
    expect(found).toBeDefined();
    writeFileSync(
      join(dir, "inventory.json"),
      JSON.stringify({ version: 1, stock: {}, placed: { alpha: [{ id: "bought_1", itemId: "coffee_machine", ...found }] }, seq: 1 }),
      "utf8",
    );
    return new Economy({ walletFile: join(dir, "wallet.json"), inventoryFile: join(dir, "inventory.json"), config, now: () => 1000 });
  }

  it("serves the most tired agent, who is rested after it, thanks the user and cheers; the panel never opens", async () => {
    const economy = withCoffeeMachine();
    const e = engine();
    const c = await connect(e.link, { economy, mood: { busyMs: 50, tiredMs: 100, pollMs: 60_000 } });
    expect(c.hotel.sim(ROOM)!.room.furni.some((p) => p.itemId === "bought_1")).toBe(true);
    // The Developer has worked for a while: a moment ago it started and the limits are small.
    e.state("developer", "working", Date.now() - 400);
    await c.waitFor(() => moods(c.received).some((m) => m.moods.developer === "tired"));

    c.send({ type: "use", itemId: "bought_1" });
    await c.waitFor(() => says(c.received).length > 0);
    expect(says(c.received)[0]).toEqual({ type: "say", id: "developer", text: "Thanks for the coffee!" });
    await c.waitFor(() => moods(c.received).at(-1)?.moods.developer === "rested");
    expect(emotes(c.received).at(-1)).toEqual({ type: "emote", id: "developer", emote: "cheer" });
    expect(c.received.some((m) => m.type === "open_panel")).toBe(false);
  });

  it("says nobody needs coffee when nobody is tired, and serves nothing", async () => {
    const economy = withCoffeeMachine();
    const e = engine();
    const c = await connect(e.link, { economy });
    c.send({ type: "use", itemId: "bought_1" });
    await c.waitFor(() => says(c.received).length > 0);
    expect(says(c.received)[0]).toEqual({ type: "say", id: c.you, text: "Nobody here needs coffee." });
    expect(emotes(c.received)).toEqual([]);
    expect(c.received.some((m) => m.type === "open_panel")).toBe(false);
  });
});
