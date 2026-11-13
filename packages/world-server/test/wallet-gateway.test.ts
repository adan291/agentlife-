import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { EconomyConfigSchema, ServerMsgSchema } from "@agentlife/shared";
import type { AgentEvent, ClientMsg, JobKind, JobState, MemoryProposal, MemoryState, MorningSummary, ServerMsg } from "@agentlife/shared";
import { Economy } from "../src/economy-store.ts";
import { EventQueue } from "../src/engine-link.ts";
import type { EngineLink, MemoryLink } from "../src/engine-link.ts";
import { startGateway } from "../src/gateway.ts";
import type { Gateway } from "../src/gateway.ts";
import { testHotel } from "./helpers.ts";

let dir: string;
let walletFile: string;
const gateways: Gateway[] = [];
const sockets: WebSocket[] = [];
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "agentlife-wallet-gw-"));
  walletFile = join(dir, "wallet.json");
});
afterEach(async () => {
  for (const s of sockets.splice(0)) s.terminate();
  for (const g of gateways.splice(0)) await g.close();
  rmSync(dir, { recursive: true, force: true });
});

const config = EconomyConfigSchema.parse({ version: 1, grants: { job_passed: 15, branch_delivered: 20, review_finished: 10, memory_accepted: 5, night_summary: 25 } });
const SINCE = 1000;
const economy = () => new Economy({ walletFile, config, now: () => SINCE });

const proposal = (n: number, sourceTaskId: string): MemoryProposal => ({ id: `prop-00000${n}`, kind: "pitfall", text: `Remember ${n}`, sourceTaskId, createdAt: n });
const summary = (nightKey: string, done: number): MorningSummary => ({
  nightKey,
  writtenAt: SINCE + 500,
  counts: { total: 1, done, failed: 0, waiting: 0, timedOut: 0, cancelled: 0, skipped: 0, delivered: 0 },
  jobs: [],
  markdown: `# Night ${nightKey}`,
});

/** An engine event without its sequence number; `ts` defaults to a time after the wallet was made. */
type NewEvent = AgentEvent extends infer E ? (E extends AgentEvent ? Omit<E, "seq" | "ts"> & { ts?: number } : never) : never;

interface EngineOptions {
  summaries?: MorningSummary[];
  proposals?: MemoryProposal[];
}

/** A scripted engine: events are pushed by the test; the Library and the night summaries are lists. */
function engine(opts: EngineOptions = {}) {
  const queue = new EventQueue<AgentEvent>();
  const state: MemoryState = { entries: [], proposals: opts.proposals ?? [], autoRemember: false, learning: [] };
  const memory: MemoryLink = {
    state: () => Promise.resolve(structuredClone(state)),
    edit: () => Promise.resolve(),
    remove: () => Promise.resolve(),
    accept: (_p, id) => {
      state.proposals = state.proposals.filter((x) => x.id !== id);
      return Promise.resolve();
    },
    dismiss: () => Promise.resolve(),
    setAutoRemember: () => Promise.resolve(),
  };
  const link: EngineLink = {
    listRepos: () => Promise.resolve([]),
    listProjects: () => Promise.resolve([{ id: "alpha", name: "alpha", builtin: true, stack: "node-npm", testCommand: "npm test", registeredAt: 0 }]),
    startJob: () => Promise.reject(new Error("not used")),
    resolveApproval: () => Promise.resolve(),
    getJob: () => Promise.reject(new Error("not used")),
    memory,
    ...(opts.summaries ? { getNightSummaries: () => Promise.resolve(opts.summaries!) } : {}),
    events: () => queue,
    close: () => queue.close(),
  };
  let seq = 0;
  const push = (e: NewEvent) => queue.push({ seq: seq++, ts: SINCE + 100, ...e } as AgentEvent);
  const job = (taskId: string, kind: JobKind | undefined, verdict: "pass" | "fail", end: JobState = "delivered") => {
    push({ type: "task.created", taskId, repoId: "alpha", goal: "a goal", ...(kind ? { kind } : {}) });
    push({ type: "task.state_changed", taskId, state: "report_ready", reason: `verdict:${verdict}` });
    push({ type: "task.state_changed", taskId, state: end });
  };
  return { link, push, job };
}

async function connect(link: EngineLink, withEconomy: Economy | undefined, start: "project:alpha" | "lobby" = "project:alpha") {
  const gateway = await startGateway({
    hotel: testHotel({ start, projects: ["alpha"] }),
    engine: link,
    port: 0,
    tickMs: 5,
    nightPollMs: 60_000,
    ...(withEconomy ? { economy: withEconomy } : {}),
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
  /** Lets the gateway handle what was sent or pushed, then checks nothing more arrived. */
  const settle = (ms = 150) => new Promise<void>((r) => setTimeout(r, ms));
  return { received, waitFor, send, settle };
}

type WalletMsg = Extract<ServerMsg, { type: "wallet" }>;
const wallets = (received: ServerMsg[]): WalletMsg[] => received.flatMap((m) => (m.type === "wallet" ? [m] : []));
const grants = (received: ServerMsg[]) => wallets(received).flatMap((m) => (m.grant ? [{ ...m.grant, balance: m.balance }] : []));

describe("the wallet through the gateway", () => {
  it("sends the balance right after the welcome", async () => {
    const e = engine();
    const c = await connect(e.link, economy());
    await c.waitFor(() => wallets(c.received).length > 0);
    const types = c.received.map((m) => m.type);
    expect(types.indexOf("wallet")).toBeGreaterThan(types.indexOf("welcome"));
    expect(wallets(c.received)[0]).toEqual({ type: "wallet", balance: 0 });
  });

  it("sends no wallet at all when the hotel has no economy", async () => {
    const e = engine();
    e.job("t1", undefined, "pass");
    const c = await connect(e.link, undefined);
    await c.settle();
    expect(wallets(c.received)).toEqual([]);
  });

  it("pays a delivered job with a pass verdict once, with what it earned for the toast", async () => {
    const e = engine();
    const c = await connect(e.link, economy());
    e.job("t1", undefined, "pass");
    await c.waitFor(() => grants(c.received).length > 0);
    expect(grants(c.received)).toEqual([{ amount: 15, reason: "job_passed", balance: 15 }]);
  });

  it("pays nothing for a failed verdict or a job that failed", async () => {
    const e = engine();
    const c = await connect(e.link, economy());
    e.job("t1", undefined, "fail");
    e.push({ type: "task.created", taskId: "t2", repoId: "alpha", goal: "a goal" });
    e.push({ type: "task.state_changed", taskId: "t2", state: "failed", reason: "boom" });
    e.push({ type: "task.state_changed", taskId: "t2", state: "report_ready", reason: "verdict:pass" });
    e.push({ type: "task.state_changed", taskId: "t2", state: "delivered" });
    await c.settle();
    expect(grants(c.received)).toEqual([]);
  });

  it("pays a branch review that asked for changes, and the delivery of a branch", async () => {
    const e = engine();
    const c = await connect(e.link, economy());
    e.job("r1", "review-branch", "fail");
    e.push({ type: "delivery.done", taskId: "t9", branch: "agentlife/t9", commit: "abc123" });
    await c.waitFor(() => grants(c.received).length === 2);
    expect(grants(c.received).map((g) => [g.reason, g.amount, g.balance])).toEqual([
      ["review_finished", 10, 10],
      ["branch_delivered", 20, 30],
    ]);
  });

  it("adds nothing when the same events come again, also after a restart of the gateway", async () => {
    const first = engine();
    const a = await connect(first.link, economy());
    first.job("t1", undefined, "pass");
    await a.waitFor(() => grants(a.received).length === 1);

    // A new gateway on the same wallet file sees the same events replayed.
    const second = engine();
    second.job("t1", undefined, "pass");
    const b = await connect(second.link, economy());
    await b.settle(300);
    expect(grants(b.received)).toEqual([]);
    expect(wallets(b.received)[0]).toEqual({ type: "wallet", balance: 15 });
  });

  it("does not pay for events older than the wallet", async () => {
    const e = engine();
    const c = await connect(e.link, economy());
    e.push({ type: "task.created", taskId: "old", repoId: "alpha", goal: "a goal", ts: SINCE - 1 });
    e.push({ type: "task.state_changed", taskId: "old", state: "report_ready", reason: "verdict:pass", ts: SINCE - 1 });
    e.push({ type: "task.state_changed", taskId: "old", state: "delivered", ts: SINCE - 1 });
    await c.settle();
    expect(grants(c.received)).toEqual([]);
  });

  it("pays a morning summary in which a job finished, and not one in which none did", async () => {
    // The summary is read when the gateway starts, before anybody is connected: the user finds it in the balance.
    const e = engine({ summaries: [summary("2026-11-12", 1), summary("2026-11-11", 0)] });
    const c = await connect(e.link, economy());
    await c.waitFor(() => wallets(c.received).length > 0);
    await c.settle();
    expect(wallets(c.received).at(-1)).toMatchObject({ type: "wallet", balance: 25 });
    expect(Math.max(...wallets(c.received).map((m) => m.balance))).toBe(25);
  });

  it("announces a night grant that arrives while the user is connected", async () => {
    const summaries: MorningSummary[] = [];
    const e = engine({ summaries });
    const c = await connect(e.link, economy(), "lobby");
    await c.waitFor(() => wallets(c.received).length > 0);
    summaries.push(summary("2026-11-12", 2));
    // Opening the lobby mailbox asks the engine again; the poll does the same every minute.
    c.send({ type: "use", itemId: "mailbox_lobby" });
    await c.waitFor(() => grants(c.received).length > 0);
    expect(grants(c.received)).toEqual([{ amount: 25, reason: "night_summary", balance: 25 }]);
  });

  it("pays an accepted note once per job", async () => {
    const e = engine({ proposals: [proposal(1, "task-7"), proposal(2, "task-7"), proposal(3, "task-8")] });
    const c = await connect(e.link, economy());
    c.send({ type: "memory_do", act: { action: "accept", proposalId: "prop-000001" } });
    await c.waitFor(() => grants(c.received).length === 1);
    c.send({ type: "memory_do", act: { action: "accept", proposalId: "prop-000002" } });
    c.send({ type: "memory_do", act: { action: "accept", proposalId: "prop-000003" } });
    await c.waitFor(() => grants(c.received).length === 2);
    await c.settle();
    expect(grants(c.received).map((g) => [g.reason, g.amount, g.balance])).toEqual([
      ["memory_accepted", 5, 5],
      ["memory_accepted", 5, 10],
    ]);
  });

  it("pays nothing for a dismissed note or an unknown proposal", async () => {
    const e = engine({ proposals: [proposal(1, "task-7")] });
    const c = await connect(e.link, economy());
    c.send({ type: "memory_do", act: { action: "dismiss", proposalId: "prop-000001" } });
    c.send({ type: "memory_do", act: { action: "accept", proposalId: "prop-000009" } });
    await c.settle();
    expect(grants(c.received)).toEqual([]);
  });

  it("lets no client message add Ecto", async () => {
    const e = engine();
    const c = await connect(e.link, economy());
    await c.waitFor(() => wallets(c.received).length > 0);
    c.send({ type: "wallet", balance: 9999 });
    c.send({ type: "grant", reason: "job_passed", ref: "task-1" });
    c.send({ type: "wallet", balance: 9999, grant: { amount: 9999, reason: "job_passed" } });
    await c.waitFor(() => c.received.filter((m) => m.type === "error").length === 3);
    expect(c.received.filter((m) => m.type === "error").every((m) => m.type === "error" && m.code === "bad_message")).toBe(true);
    expect(wallets(c.received).every((m) => m.balance === 0)).toBe(true);
  });
});
