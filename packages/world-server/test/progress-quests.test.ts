import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { EconomyConfigSchema, QUESTS_PER_DAY, ServerMsgSchema, evaluateBadges, localDay, newEntity, payoutRef, pickQuests } from "@agentlife/shared";
import type { AgentEvent, BadgeDef, ClientMsg, MemoryProposal, MemoryState, MorningSummary, NightJob, NightState, ProgressFact, QuestDef, ServerMsg } from "@agentlife/shared";
import { Economy } from "../src/economy-store.ts";
import { EventQueue } from "../src/engine-link.ts";
import type { EngineLink, MemoryLink } from "../src/engine-link.ts";
import { startGateway } from "../src/gateway.ts";
import type { Gateway } from "../src/gateway.ts";
import { ProgressStore, loadBadges, loadProgressConfig, loadQuests } from "../src/progress-store.ts";
import { testHotel } from "./helpers.ts";

let dir: string;
const gateways: Gateway[] = [];
const sockets: WebSocket[] = [];
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "agentlife-quests-"));
});
afterEach(async () => {
  for (const s of sockets.splice(0)) s.terminate();
  for (const g of gateways.splice(0)) await g.close();
  rmSync(dir, { recursive: true, force: true });
});

const config = loadProgressConfig();
const BADGES = loadBadges();
const QUESTS = loadQuests();
const DEV = "alpha/developer";
const DAY0 = new Date(2026, 10, 13, 12, 0).getTime();

describe("the shipped badges (config/badges.json)", () => {
  it("has at least twelve, for the user and for members, each with an icon of the allowed shapes", () => {
    expect(BADGES.length).toBeGreaterThanOrEqual(12);
    expect(BADGES.some((b) => b.scope === "user")).toBe(true);
    expect(BADGES.some((b) => b.scope === "member")).toBe(true);
    expect(new Set(BADGES.map((b) => b.id)).size).toBe(BADGES.length);
  });

  it.each(BADGES.map((b) => [b.id, b] as const))("%s is earned exactly when its rule is met", (_id, def: BadgeDef) => {
    const at = (n: number) => {
      // The counter `level` comes from XP; the others are counters of the entity.
      if (def.rule.counter === "level") return { ...newEntity(), xp: (25 * n * (n + 1)) };
      return { ...newEntity(), counts: { [def.rule.counter]: n } };
    };
    expect(evaluateBadges(at(def.rule.atLeast - 1), def.scope, [def], 1).earned).toEqual([]);
    expect(evaluateBadges(at(def.rule.atLeast), def.scope, [def], 1).earned.map((b) => b.id)).toEqual([def.id]);
    // It is not earned by the other scope.
    expect(evaluateBadges(at(def.rule.atLeast), def.scope === "user" ? "member" : "user", [def], 1).earned).toEqual([]);
  });
});

describe("the shipped quests (config/quests.json)", () => {
  it("has a pool of at least six that includes the examples of the spec", () => {
    expect(QUESTS.length).toBeGreaterThanOrEqual(6);
    for (const title of ["Deliver a branch", "Run a branch review", "Accept a memory note", "Schedule a night job"]) {
      expect(QUESTS.map((q) => q.title)).toContain(title);
    }
  });

  /** A day on which the pool picks this quest. */
  const dayWith = (q: QuestDef): number => {
    for (let d = 0; d < 400; d++) {
      const ts = DAY0 + d * 86_400_000;
      if (pickQuests(localDay(ts), QUESTS).some((p) => p.id === q.id)) return ts;
    }
    throw new Error(`no day picks ${q.id}`);
  };

  it.each(QUESTS.map((q) => [q.id, q] as const))("%s completes after %s facts of its counter and pays once", (_id, q: QuestDef) => {
    const now = dayWith(q);
    const file = join(dir, `${q.id}.json`);
    const open = () => new ProgressStore({ file, config, badges: BADGES, quests: QUESTS, now: () => now });
    // The file was made a day before, so today's facts count.
    writeFileSync(file, JSON.stringify({ version: 1, since: now - 86_400_000, user: { xp: 0, counts: {}, stepMs: 0, streak: 0 }, members: {}, counted: [] }));
    const store = open();
    const fact = (i: number): ProgressFact => ({ source: q.counter, ref: `${q.id}-${i}`, ts: now });
    for (let i = 0; i < q.target - 1; i++) expect(store.record(fact(i), [DEV]).questsDone.map((d) => d.id)).not.toContain(q.id);
    const last = store.record(fact(q.target), [DEV]);
    expect(last.questsDone.filter((d) => d.id === q.id)).toEqual([{ id: q.id, title: q.title, reward: q.reward, ref: payoutRef(localDay(now), q.id) }]);
    expect(store.payouts()).toContainEqual({ ref: payoutRef(localDay(now), q.id), reward: q.reward });
    // More of the same pays nothing more.
    expect(store.record(fact(q.target + 1), [DEV]).questsDone.filter((d) => d.id === q.id)).toEqual([]);
    // Settled, and a new run of the program on the same file keeps it done, owes nothing, and counts the same facts as nothing.
    expect(store.settle(payoutRef(localDay(now), q.id))).toBe(true);
    const again = open();
    expect(again.payouts().map((p) => p.ref)).not.toContain(payoutRef(localDay(now), q.id));
    expect(again.view().quests.items.find((i) => i.id === q.id)).toMatchObject({ done: true });
    expect(again.record(fact(q.target + 1), [DEV]).changed).toBe(false);
  });
});

describe("ProgressStore payouts", () => {
  it("keeps an unpaid payout across a restart and forgets it when settled", () => {
    const file = join(dir, "p.json");
    const pool: QuestDef[] = ["a", "b", "c", "d", "e", "f"].map((id) => ({ id, title: id, counter: "plan_approved", target: 1, reward: 10 }));
    const mk = () => new ProgressStore({ file, config, quests: pool, now: () => DAY0 });
    writeFileSync(file, JSON.stringify({ version: 1, since: 0, user: { xp: 0, counts: {}, stepMs: 0, streak: 0 }, members: {}, counted: [] }));
    const a = mk();
    a.record({ source: "plan_approved", ref: "appr-1", ts: DAY0 }, []);
    expect(a.payouts()).toHaveLength(QUESTS_PER_DAY);
    const b = mk();
    expect(b.payouts()).toHaveLength(QUESTS_PER_DAY);
    for (const p of b.payouts()) expect(b.settle(p.ref)).toBe(true);
    expect(mk().payouts()).toEqual([]);
    expect(b.settle("2026-11-13.zzz")).toBe(false);
  });

  it("keeps a payout when the file cannot be written, so it is tried again", () => {
    const sub = join(dir, "sub");
    const file = join(sub, "p.json");
    const pool: QuestDef[] = ["a", "b", "c", "d", "e", "f"].map((id) => ({ id, title: id, counter: "plan_approved", target: 1, reward: 10 }));
    const logs: string[] = [];
    // Created before the folder is spoiled.
    const s = new ProgressStore({ file, config, quests: pool, now: () => DAY0, onLog: (m) => logs.push(m) });
    s.record({ source: "plan_approved", ref: "appr-1", ts: DAY0 }, []);
    expect(s.payouts()).toHaveLength(QUESTS_PER_DAY);
    // The folder is replaced by a file: every later write fails.
    rmSync(sub, { recursive: true });
    writeFileSync(sub, "");
    const ref = s.payouts()[0]!.ref;
    expect(s.settle(ref)).toBe(false);
    expect(s.payouts()).toHaveLength(QUESTS_PER_DAY);
    expect(logs.some((m) => m.includes("cannot write"))).toBe(true);
  });
});

// ---- through the gateway ----

type NewEvent = AgentEvent extends infer E ? (E extends AgentEvent ? Omit<E, "seq" | "ts"> & { ts?: number } : never) : never;

const poolOf = (counter: QuestDef["counter"], n = 6): QuestDef[] =>
  Array.from({ length: n }, (_, i) => ({ id: `q${i + 1}`, title: `Quest ${i + 1}`, counter, target: 1, reward: 10 * (i + 1) }));
const econConfig = EconomyConfigSchema.parse({ version: 1, grants: { job_passed: 15, branch_delivered: 20, review_finished: 10, memory_accepted: 5, night_summary: 25 } });
const walletFile = () => join(dir, "wallet.json");
const economy = () => new Economy({ walletFile: walletFile(), inventoryFile: join(dir, "inventory.json"), config: econConfig, now: () => 1000 });
const store = (quests: QuestDef[]) => new ProgressStore({ file: join(dir, "progress.json"), config, badges: BADGES, quests, now: Date.now });

const proposal = (n: number, sourceTaskId: string): MemoryProposal => ({ id: `prop-00000${n}`, kind: "pitfall", text: `Remember ${n}`, sourceTaskId, createdAt: n });
const summary = (nightKey: string): MorningSummary => ({
  nightKey,
  writtenAt: Date.now(),
  counts: { total: 1, done: 1, failed: 0, waiting: 0, timedOut: 0, cancelled: 0, skipped: 0, delivered: 0 },
  jobs: [],
  markdown: `# Night ${nightKey}`,
});

function engine(opts: { proposals?: MemoryProposal[]; summaries?: MorningSummary[]; night?: boolean } = {}) {
  const queue = new EventQueue<AgentEvent>();
  const mem: MemoryState = { entries: [], proposals: opts.proposals ?? [], autoRemember: false, learning: [] };
  const memory: MemoryLink = {
    state: () => Promise.resolve(structuredClone(mem)),
    edit: () => Promise.resolve(),
    remove: () => Promise.resolve(),
    accept: (_p, id) => {
      mem.proposals = mem.proposals.filter((x) => x.id !== id);
      return Promise.resolve();
    },
    dismiss: () => Promise.resolve(),
    setAutoRemember: () => Promise.resolve(),
  };
  const jobs: NightJob[] = [];
  const nightState = (): NightState => ({ config: { start: "01:00", end: "07:00", maxJobsPerNight: 4, maxJobMinutes: 20 }, open: false, jobs: [...jobs] });
  const link: EngineLink = {
    listRepos: () => Promise.resolve([]),
    listProjects: () => Promise.resolve([{ id: "alpha", name: "alpha", builtin: true, stack: "node-npm", testCommand: "npm test", registeredAt: 0 }]),
    startJob: () => Promise.reject(new Error("not used")),
    resolveApproval: () => Promise.resolve(),
    getJob: () => Promise.reject(new Error("not used")),
    memory,
    ...(opts.summaries ? { getNightSummaries: () => Promise.resolve(opts.summaries!) } : {}),
    ...(opts.night
      ? {
          getNight: () => Promise.resolve(nightState()),
          addNightJob: () => {
            const job = { id: `n${jobs.length + 1}`, repoId: "alpha", kind: "audit-deps", goal: "Audit", tier: "normal", preApprove: false, deliver: false, status: "scheduled", addedAt: 1 } as NightJob;
            jobs.push(job);
            return Promise.resolve(job);
          },
        }
      : {}),
    events: () => queue,
    close: () => queue.close(),
  };
  let seq = 0;
  const push = (e: NewEvent) => queue.push({ seq: seq++, ts: Date.now(), ...e } as AgentEvent);
  return { link, push };
}

async function connect(link: EngineLink, progress: ProgressStore, withEconomy: Economy | undefined, start: "project:alpha" | "lobby" = "project:alpha") {
  const gateway = await startGateway({
    hotel: testHotel({ start, projects: ["alpha"] }),
    engine: link,
    port: 0,
    tickMs: 5,
    nightPollMs: 60_000,
    progress,
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
  const settle = (ms = 200) => new Promise<void>((r) => setTimeout(r, ms));
  return { received, waitFor, send, settle };
}

type WalletMsg = Extract<ServerMsg, { type: "wallet" }>;
const questGrants = (received: ServerMsg[]) =>
  received.flatMap((m): WalletMsg[] => (m.type === "wallet" && m.grant?.reason === "quest_done" ? [m] : [])).map((m) => m.grant!.amount);
const lastProgress = (received: ServerMsg[]) => received.filter((m): m is Extract<ServerMsg, { type: "progress" }> => m.type === "progress").at(-1)?.state;
const planApproved = (e: ReturnType<typeof engine>, taskId = "t1") => {
  e.push({ type: "task.created", taskId, repoId: "alpha", goal: "g" });
  e.push({ type: "approval.requested", taskId, approvalId: `appr-${taskId}`, kind: "plan", summary: "Plan" } as NewEvent);
  e.push({ type: "approval.resolved", taskId, approvalId: `appr-${taskId}`, decision: "approve" } as NewEvent);
};

describe("quests and badges through the gateway", () => {
  it("pays each of today's quests once into the wallet, and announces the badge", async () => {
    const pool = poolOf("plan_approved");
    const e = engine();
    const c = await connect(e.link, store(pool), economy());
    planApproved(e);
    await c.waitFor(() => questGrants(c.received).length === QUESTS_PER_DAY);
    const picked = pickQuests(localDay(Date.now()), pool);
    expect(questGrants(c.received).sort((a, b) => a - b)).toEqual(picked.map((q) => q.reward).sort((a, b) => a - b));
    expect(lastProgress(c.received)?.quests.items.every((q) => q.done)).toBe(true);
    expect(c.received.find((m) => m.type === "badge_earned")).toEqual({ type: "badge_earned", who: "user", owner: "You", badge: "Plan approver" });
    // Ecto is the sum of the three rewards, counted once.
    const wallet = c.received.filter((m): m is WalletMsg => m.type === "wallet").at(-1);
    expect(wallet?.balance).toBe(picked.reduce((s, q) => s + q.reward, 0));
  });

  it("pays nothing twice when a new gateway on the same files sees the same events", async () => {
    const pool = poolOf("plan_approved");
    const first = engine();
    const a = await connect(first.link, store(pool), economy());
    planApproved(first);
    await a.waitFor(() => questGrants(a.received).length === QUESTS_PER_DAY);
    const balance = a.received.filter((m): m is WalletMsg => m.type === "wallet").at(-1)!.balance;

    const second = engine();
    const b = await connect(second.link, store(pool), economy());
    planApproved(second);
    await b.settle(300);
    expect(questGrants(b.received)).toEqual([]);
    expect(b.received.filter((m): m is WalletMsg => m.type === "wallet")[0]?.balance).toBe(balance);
    expect(lastProgress(b.received)?.quests.items.every((q) => q.done)).toBe(true);
  });

  it("pays a payout that was left unpaid when the program stopped, at start, once", async () => {
    const pool = poolOf("plan_approved");
    const s = store(pool);
    s.record({ source: "plan_approved", ref: "appr-old", ts: Date.now() }, []);
    expect(s.payouts()).toHaveLength(QUESTS_PER_DAY);
    const wallet = economy();
    // Nobody is connected at start: the Ecto is simply in the balance the user finds on arrival.
    const c = await connect(engine().link, s, wallet);
    const sum = pickQuests(localDay(Date.now()), pool).reduce((total, q) => total + q.reward, 0);
    await c.waitFor(() => s.payouts().length === 0);
    expect(wallet.balance).toBe(sum);
    // Another start does not pay again.
    const d = await connect(engine().link, store(pool), economy());
    await d.settle(300);
    expect(questGrants(d.received)).toEqual([]);
    expect(economy().balance).toBe(sum);
  });

  it("only takes a payout off the list when the wallet already holds it (a crash between the two files)", async () => {
    const pool = poolOf("plan_approved");
    const s = store(pool);
    s.record({ source: "plan_approved", ref: "appr-old", ts: Date.now() }, []);
    const wallet = economy();
    // The wallet was written, the progress file was not: the grants are already in the wallet.
    for (const p of s.payouts()) wallet.grant("quest_done", p.ref, Date.now(), p.reward);
    const before = wallet.balance;
    const c = await connect(engine().link, s, wallet);
    await c.settle(300);
    expect(s.payouts()).toEqual([]);
    expect(wallet.balance).toBe(before);
    expect(questGrants(c.received)).toEqual([]);
  });

  it("completes quests without paying when the hotel has no economy", async () => {
    const pool = poolOf("plan_approved");
    const s = store(pool);
    const e = engine();
    const c = await connect(e.link, s, undefined);
    planApproved(e);
    await c.waitFor(() => lastProgress(c.received)?.quests.items.every((q) => q.done) === true);
    expect(s.payouts()).toEqual([]);
    expect(c.received.some((m) => m.type === "wallet")).toBe(false);
  });

  it("counts a note kept in the Library for a quest", async () => {
    const e = engine({ proposals: [proposal(1, "task-7")] });
    const c = await connect(e.link, store(poolOf("memory_accepted")), economy());
    c.send({ type: "memory_do", act: { action: "accept", proposalId: "prop-000001" } });
    await c.waitFor(() => questGrants(c.received).length === QUESTS_PER_DAY);
    expect(c.received.find((m) => m.type === "badge_earned")).toMatchObject({ badge: "Librarian" });
  });

  it("counts a morning report in which a job finished, once", async () => {
    // The report is read when the gateway starts, before anybody is connected: the user finds the quests done and the Ecto in the balance.
    const pool = poolOf("night_summary");
    const wallet = economy();
    const s = store(pool);
    const c = await connect(engine({ summaries: [summary("2026-11-12")] }).link, s, wallet);
    await c.waitFor(() => lastProgress(c.received)?.quests.items.every((q) => q.done) === true);
    expect(lastProgress(c.received)?.user.badges.map((b) => b.id)).toContain("night_shift");
    await c.waitFor(() => s.payouts().length === 0);
    // The morning report itself pays 25 Ecto, and the three quests pay their rewards.
    expect(wallet.balance).toBe(25 + pickQuests(localDay(Date.now()), pool).reduce((total, q) => total + q.reward, 0));
    const again = await connect(engine({ summaries: [summary("2026-11-12")] }).link, store(pool), economy());
    await again.settle(300);
    expect(economy().balance).toBe(wallet.balance);
  });

  it("counts a night job the user scheduled, and not one the engine refused", async () => {
    const e = engine({ night: true });
    const c = await connect(e.link, store(poolOf("night_scheduled")), economy(), "lobby");
    c.send({ type: "night_add", job: { repoId: "alpha", kind: "audit-deps", tier: "normal", preApprove: false, deliver: false } });
    await c.waitFor(() => questGrants(c.received).length === QUESTS_PER_DAY);
    expect(c.received.find((m) => m.type === "badge_earned")).toMatchObject({ badge: "Night planner" });
  });

  it("lets no client message complete a quest or earn a badge", async () => {
    const e = engine();
    const c = await connect(e.link, store(poolOf("plan_approved")), economy());
    c.send({ type: "badge_earned", who: "user", owner: "You", badge: "Hotel veteran" });
    c.send({ type: "quest_done", id: "q1" });
    await c.waitFor(() => c.received.filter((m) => m.type === "error").length === 2);
    await c.settle();
    expect(questGrants(c.received)).toEqual([]);
    expect(lastProgress(c.received)?.quests.items.some((q) => q.done)).toBe(false);
  });
});
