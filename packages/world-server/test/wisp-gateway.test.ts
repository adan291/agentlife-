import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { EconomyConfigSchema, ServerMsgSchema, WISPS_PER_DAY, WISPS_PER_JOB } from "@agentlife/shared";
import type { AgentEvent, ClientMsg, ServerMsg } from "@agentlife/shared";
import { Economy } from "../src/economy-store.ts";
import { EventQueue } from "../src/engine-link.ts";
import type { EngineLink } from "../src/engine-link.ts";
import { startGateway } from "../src/gateway.ts";
import type { Gateway } from "../src/gateway.ts";
import type { WispOptions } from "../src/wisps.ts";
import { testHotel } from "./helpers.ts";

let dir: string;
let walletFile: string;
const gateways: Gateway[] = [];
const sockets: WebSocket[] = [];
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "agentlife-wisp-gw-"));
  walletFile = join(dir, "wallet.json");
});
afterEach(async () => {
  for (const s of sockets.splice(0)) s.terminate();
  for (const g of gateways.splice(0)) await g.close();
  rmSync(dir, { recursive: true, force: true });
});

const config = EconomyConfigSchema.parse({ version: 1, grants: { job_passed: 15, branch_delivered: 20, review_finished: 10, memory_accepted: 5, night_summary: 25 } });
const economy = () => new Economy({ walletFile, inventoryFile: join(dir, "inventory.json"), config, now: () => 1000 });

/** Wisps every 20 to 30 ms that live 400 ms (plus 100 ms of grace): fast enough for a test. */
const FAST: WispOptions = { minMs: 20, maxMs: 30, lifeMs: 400, graceMs: 100 };

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
  const startJob = (taskId: string) => push({ type: "task.created", taskId, repoId: "alpha", goal: "a goal" });
  const endJob = (taskId: string) => push({ type: "task.state_changed", taskId, state: "cancelled" });
  return { link, push, startJob, endJob };
}

interface ConnectOptions {
  economy?: Economy | undefined;
  wisps?: WispOptions;
  start?: "project:alpha" | "lobby";
}

async function connect(link: EngineLink, opts: ConnectOptions = {}) {
  const gateway = await startGateway({
    hotel: testHotel({ start: opts.start ?? "project:alpha", projects: ["alpha"] }),
    engine: link,
    port: 0,
    tickMs: 5,
    nightPollMs: 60_000,
    ...(opts.economy ? { economy: opts.economy } : {}),
    ...(opts.wisps ? { wisps: opts.wisps } : {}),
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
  const send = (msg: ClientMsg | Record<string, unknown>) => ws.send(JSON.stringify(msg));
  const settle = (ms = 200) => new Promise<void>((r) => setTimeout(r, ms));
  return { received, waitFor, send, settle };
}

type Received = ServerMsg[];
const wispsOf = (r: Received) => r.flatMap((m) => (m.type === "wisp" ? [m] : []));
const gonesOf = (r: Received) => r.flatMap((m) => (m.type === "wisp_gone" ? [m] : []));
const catchesOf = (r: Received) => r.flatMap((m) => (m.type === "wallet" && m.grant?.reason === "wisp_caught" ? [m] : []));
const lastBalance = (r: Received) => r.flatMap((m) => (m.type === "wallet" ? [m.balance] : [])).at(-1);

describe("wisps through the gateway", () => {
  it("appear while a job runs on the user's floor, with a position and a time to live", async () => {
    const e = engine();
    const c = await connect(e.link, { economy: economy(), wisps: FAST });
    e.startJob("task-1");
    await c.waitFor(() => wispsOf(c.received).length > 0);
    const wisp = wispsOf(c.received)[0]!;
    expect(wisp.ttlMs).toBe(400);
    expect(Number.isInteger(wisp.x) && Number.isInteger(wisp.y)).toBe(true);
  });

  it("do not appear when no job runs", async () => {
    const e = engine();
    const c = await connect(e.link, { economy: economy(), wisps: FAST });
    await c.settle(400);
    expect(wispsOf(c.received)).toEqual([]);
  });

  it("do not appear in the lobby, where no job runs, even while a job runs on another floor", async () => {
    const e = engine();
    const c = await connect(e.link, { economy: economy(), wisps: FAST, start: "lobby" });
    e.startJob("task-1");
    await c.settle(400);
    expect(wispsOf(c.received)).toEqual([]);
  });

  it("do not appear in a hotel without an economy", async () => {
    const e = engine();
    const c = await connect(e.link, { wisps: FAST });
    e.startJob("task-1");
    await c.settle(400);
    expect(wispsOf(c.received)).toEqual([]);
  });

  it("are one at a time: the next one comes after the first is over", async () => {
    const e = engine();
    const c = await connect(e.link, { economy: economy(), wisps: FAST });
    e.startJob("task-1");
    await c.waitFor(() => wispsOf(c.received).length >= 2, 4000);
    const [first, second] = wispsOf(c.received);
    expect(second!.wispId).not.toBe(first!.wispId);
    // The first one was reported gone before the second appeared.
    const types = c.received.filter((m) => m.type === "wisp" || m.type === "wisp_gone").map((m) => `${m.type}:${"wispId" in m ? m.wispId : ""}`);
    expect(types.indexOf(`wisp_gone:${first!.wispId}`)).toBeGreaterThan(types.indexOf(`wisp:${first!.wispId}`));
    expect(types.indexOf(`wisp_gone:${first!.wispId}`)).toBeLessThan(types.indexOf(`wisp:${second!.wispId}`));
  });

  it("pay 1 Ecto when caught, through the wallet message the toast uses", async () => {
    const e = engine();
    const c = await connect(e.link, { economy: economy(), wisps: { ...FAST, minMs: 20, maxMs: 20, lifeMs: 2000 } });
    e.startJob("task-1");
    await c.waitFor(() => wispsOf(c.received).length > 0);
    c.send({ type: "wisp_catch", wispId: wispsOf(c.received)[0]!.wispId });
    await c.waitFor(() => catchesOf(c.received).length > 0);
    expect(catchesOf(c.received)[0]).toMatchObject({ balance: 1, grant: { amount: 1, reason: "wisp_caught" } });
    await c.waitFor(() => gonesOf(c.received).some((g) => g.caught));
  });

  it("pay nothing for a second click on the same wisp or for a wisp that is not there", async () => {
    const e = engine();
    const c = await connect(e.link, { economy: economy(), wisps: { ...FAST, lifeMs: 2000 } });
    c.send({ type: "wisp_catch", wispId: "wisp-99" });
    await c.waitFor(() => gonesOf(c.received).length === 1);
    expect(gonesOf(c.received)[0]).toEqual({ type: "wisp_gone", wispId: "wisp-99", caught: false });
    expect(catchesOf(c.received)).toEqual([]);

    e.startJob("task-1");
    await c.waitFor(() => wispsOf(c.received).length > 0);
    const id = wispsOf(c.received)[0]!.wispId;
    c.send({ type: "wisp_catch", wispId: id });
    c.send({ type: "wisp_catch", wispId: id });
    await c.settle(150);
    expect(catchesOf(c.received)).toHaveLength(1);
    expect(gonesOf(c.received).filter((g) => g.wispId === id).map((g) => g.caught).sort()).toEqual([false, true]);
    expect(lastBalance(c.received)).toBe(1);
  });

  it("pay nothing for a click that comes after the wisp faded", async () => {
    const e = engine();
    const c = await connect(e.link, { economy: economy(), wisps: { minMs: 20, maxMs: 20, lifeMs: 100, graceMs: 20 } });
    e.startJob("task-1");
    await c.waitFor(() => wispsOf(c.received).length > 0);
    const id = wispsOf(c.received)[0]!.wispId;
    await c.waitFor(() => gonesOf(c.received).some((g) => g.wispId === id));
    c.send({ type: "wisp_catch", wispId: id });
    await c.waitFor(() => gonesOf(c.received).filter((g) => g.wispId === id).length === 2);
    expect(catchesOf(c.received)).toEqual([]);
  });

  it("go away with the job", async () => {
    const e = engine();
    const c = await connect(e.link, { economy: economy(), wisps: { minMs: 20, maxMs: 20, lifeMs: 5000 } });
    e.startJob("task-1");
    await c.waitFor(() => wispsOf(c.received).length > 0);
    const id = wispsOf(c.received)[0]!.wispId;
    e.endJob("task-1");
    await c.waitFor(() => gonesOf(c.received).some((g) => g.wispId === id));
    expect(gonesOf(c.received).find((g) => g.wispId === id)!.caught).toBe(false);
    // And no new one comes: the job is over.
    const count = wispsOf(c.received).length;
    await c.settle(300);
    expect(wispsOf(c.received)).toHaveLength(count);
  });

  it("cannot be caught from another floor", async () => {
    const e = engine();
    const c = await connect(e.link, { economy: economy(), wisps: { minMs: 20, maxMs: 20, lifeMs: 5000 } });
    e.startJob("task-1");
    await c.waitFor(() => wispsOf(c.received).length > 0);
    const id = wispsOf(c.received)[0]!.wispId;
    c.send({ type: "go_to", roomId: "lobby", via: "list" });
    await c.waitFor(() => c.received.filter((m) => m.type === "welcome").length === 2);
    c.send({ type: "wisp_catch", wispId: id });
    await c.waitFor(() => gonesOf(c.received).some((g) => g.wispId === id));
    expect(catchesOf(c.received)).toEqual([]);
    expect(lastBalance(c.received)).toBe(0);
  });

  it("pay ten catches for a job and then stop appearing", async () => {
    const e = engine();
    const c = await connect(e.link, { economy: economy(), wisps: { minMs: 20, maxMs: 20, lifeMs: 2000 } });
    e.startJob("task-1");
    let caught = 0;
    const used = new Set<string>();
    while (caught < WISPS_PER_JOB) {
      // The next wisp that was not caught yet (one may already be there: they come 20 ms after the last one is gone).
      await c.waitFor(() => wispsOf(c.received).some((w) => !used.has(w.wispId)));
      const wisp = wispsOf(c.received).find((w) => !used.has(w.wispId))!;
      used.add(wisp.wispId);
      c.send({ type: "wisp_catch", wispId: wisp.wispId });
      caught++;
      await c.waitFor(() => catchesOf(c.received).length === caught);
    }
    const shown = wispsOf(c.received).length;
    await c.settle(400);
    expect(wispsOf(c.received)).toHaveLength(shown);
    expect(lastBalance(c.received)).toBe(WISPS_PER_JOB);

    // A new job starts again.
    e.startJob("task-2");
    await c.waitFor(() => wispsOf(c.received).length > shown);
  });

  it("pay 50 catches a day, counted from the wallet, also after a restart", async () => {
    const now = Date.now();
    const catches = Array.from({ length: WISPS_PER_DAY - 1 }, (_, n) => ({ ts: now, amount: 1, reason: "wisp_caught", ref: `old-${Math.floor(n / 10)}.${(n % 10) + 1}` }));
    writeFileSync(
      walletFile,
      JSON.stringify({ version: 1, since: 0, balance: catches.length, ledger: catches, granted: catches.map((x) => `wisp_caught:${x.ref}`) }),
      "utf8",
    );
    const e = engine();
    const c = await connect(e.link, { economy: economy(), wisps: { minMs: 20, maxMs: 20, lifeMs: 2000 } });
    e.startJob("task-1");
    await c.waitFor(() => wispsOf(c.received).length > 0);
    c.send({ type: "wisp_catch", wispId: wispsOf(c.received)[0]!.wispId });
    await c.waitFor(() => catchesOf(c.received).length === 1);
    expect(lastBalance(c.received)).toBe(WISPS_PER_DAY);
    const shown = wispsOf(c.received).length;
    await c.settle(300);
    expect(wispsOf(c.received)).toHaveLength(shown);

    // A restart on the same wallet file still knows the day is full.
    const e2 = engine();
    const d = await connect(e2.link, { economy: economy(), wisps: { minMs: 20, maxMs: 20, lifeMs: 2000 } });
    e2.startJob("task-9");
    await d.settle(300);
    expect(wispsOf(d.received)).toEqual([]);
  });

  it("keep the numbering of a job across a restart: the catches already paid are not paid twice", async () => {
    const e = engine();
    const c = await connect(e.link, { economy: economy(), wisps: { minMs: 20, maxMs: 20, lifeMs: 2000 } });
    e.startJob("task-1");
    await c.waitFor(() => wispsOf(c.received).length > 0);
    c.send({ type: "wisp_catch", wispId: wispsOf(c.received)[0]!.wispId });
    await c.waitFor(() => catchesOf(c.received).length === 1);

    const wallet = economy();
    expect(wallet.hasGranted("wisp_caught", "task-1.1")).toBe(true);
    expect(wallet.hasGranted("wisp_caught", "task-1.2")).toBe(false);
  });
});
