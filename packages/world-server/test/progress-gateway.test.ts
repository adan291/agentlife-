import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { ProgressConfigSchema, ServerMsgSchema } from "@agentlife/shared";
import type { AgentEvent, ClientMsg, ServerMsg, TeamMember } from "@agentlife/shared";
import { EventQueue } from "../src/engine-link.ts";
import type { EngineLink, HrLink } from "../src/engine-link.ts";
import { startGateway } from "../src/gateway.ts";
import type { Gateway } from "../src/gateway.ts";
import { ProgressStore } from "../src/progress-store.ts";
import { testHotel } from "./helpers.ts";

let dir: string;
let file: string;
const gateways: Gateway[] = [];
const sockets: WebSocket[] = [];
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "agentlife-progress-gw-"));
  file = join(dir, "progress.json");
});
afterEach(async () => {
  for (const s of sockets.splice(0)) s.terminate();
  for (const g of gateways.splice(0)) await g.close();
  rmSync(dir, { recursive: true, force: true });
});

const SINCE = 1000;
const amounts = (step: number, branch = 20) =>
  ProgressConfigSchema.parse({
    version: 1,
    xp: { step_done: { member: step }, job_passed: { member: 25, user: 15 }, review_passed: { member: 20, user: 10 }, branch_delivered: { user: branch }, plan_approved: { user: 5 } },
  });
const progressStore = (step = 10, branch = 20) => new ProgressStore({ file, config: amounts(step, branch), now: () => SINCE });

const ADA: TeamMember = { id: "ada", displayName: "Ada", templateId: "developer", role: "developer", model: "m" };

type NewEvent = AgentEvent extends infer E ? (E extends AgentEvent ? Omit<E, "seq" | "ts"> & { ts?: number } : never) : never;

/** A scripted engine; with `team`, the HR office answers with these members for every project. */
function engine(team?: TeamMember[]) {
  const queue = new EventQueue<AgentEvent>();
  const hr = team
    ? ({ team: (projectId: string) => Promise.resolve({ projectId, customised: true, members: team }) } as unknown as HrLink)
    : undefined;
  const link: EngineLink = {
    listRepos: () => Promise.resolve([]),
    listProjects: () => Promise.resolve([{ id: "alpha", name: "alpha", builtin: true, stack: "node-npm", testCommand: "npm test", registeredAt: 0 }]),
    startJob: () => Promise.reject(new Error("not used")),
    resolveApproval: () => Promise.resolve(),
    getJob: () => Promise.reject(new Error("not used")),
    ...(hr ? { hr } : {}),
    events: () => queue,
    close: () => queue.close(),
  };
  let seq = 0;
  const push = (e: NewEvent) => queue.push({ seq: seq++, ts: SINCE + 100, ...e } as AgentEvent);
  return { link, push };
}

async function connect(link: EngineLink, store: ProgressStore | undefined, start: "project:alpha" | "lobby" = "project:alpha") {
  const gateway = await startGateway({
    hotel: testHotel({ start, projects: ["alpha"] }),
    engine: link,
    port: 0,
    tickMs: 5,
    nightPollMs: 60_000,
    ...(store ? { progress: store } : {}),
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
  const settle = (ms = 150) => new Promise<void>((r) => setTimeout(r, ms));
  return { received, waitFor, send, settle };
}

type ProgressMsg = Extract<ServerMsg, { type: "progress" }>;
type LevelUpMsg = Extract<ServerMsg, { type: "level_up" }>;
const progresses = (received: ServerMsg[]): ProgressMsg[] => received.flatMap((m) => (m.type === "progress" ? [m] : []));
const levelUps = (received: ServerMsg[]): LevelUpMsg[] => received.flatMap((m) => (m.type === "level_up" ? [m] : []));

const stepDone = (e: ReturnType<typeof engine>, taskId: string, role = "developer") => {
  e.push({ type: "agent.state_changed", taskId, agentId: `alpha:${role}`, state: "done" } as NewEvent);
};

describe("progress through the gateway", () => {
  it("sends the numbers right after the welcome, empty at first", async () => {
    const c = await connect(engine().link, progressStore());
    await c.waitFor(() => progresses(c.received).length > 0);
    const types = c.received.map((m) => m.type);
    expect(types.indexOf("progress")).toBeGreaterThan(types.indexOf("welcome"));
    expect(progresses(c.received)[0]?.state.user).toMatchObject({ xp: 0, level: 0, jobs: 0 });
    expect(progresses(c.received)[0]?.state.members).toEqual([]);
  });

  it("sends nothing when the hotel has no progress store", async () => {
    const e = engine();
    const c = await connect(e.link, undefined);
    e.push({ type: "task.created", taskId: "t1", repoId: "alpha", goal: "g" });
    stepDone(e, "t1");
    await c.settle();
    expect(progresses(c.received)).toEqual([]);
    expect(levelUps(c.received)).toEqual([]);
  });

  it("pays the member who holds the desk for a finished step, and tells the client", async () => {
    const e = engine([ADA]);
    const c = await connect(e.link, progressStore());
    e.push({ type: "task.created", taskId: "t1", repoId: "alpha", goal: "g" });
    stepDone(e, "t1");
    await c.waitFor(() => progresses(c.received).some((p) => p.state.members.length > 0));
    const member = progresses(c.received).at(-1)?.state.members[0];
    expect(member).toMatchObject({ projectId: "alpha", memberId: "ada", xp: 10, steps: 1, level: 0 });
    expect(progresses(c.received).at(-1)?.state.user.xp).toBe(0);
  });

  it("falls back to the role name when the team cannot be read", async () => {
    const e = engine();
    const c = await connect(e.link, progressStore());
    e.push({ type: "task.created", taskId: "t1", repoId: "alpha", goal: "g" });
    stepDone(e, "t1", "qa");
    await c.waitFor(() => progresses(c.received).some((p) => p.state.members.length > 0));
    expect(progresses(c.received).at(-1)?.state.members[0]).toMatchObject({ memberId: "qa", xp: 10 });
  });

  it("announces a level-up with the ghost to play the effect over, when the user is on that floor", async () => {
    const e = engine([ADA]);
    const c = await connect(e.link, progressStore(60));
    e.push({ type: "task.created", taskId: "t1", repoId: "alpha", goal: "g" });
    stepDone(e, "t1");
    await c.waitFor(() => levelUps(c.received).length > 0);
    expect(levelUps(c.received)).toEqual([{ type: "level_up", who: "member", name: "Ada", level: 1, slot: "developer" }]);
  });

  it("announces a level-up without a ghost when the user is on another floor", async () => {
    const e = engine([ADA]);
    const c = await connect(e.link, progressStore(60), "lobby");
    e.push({ type: "task.created", taskId: "t1", repoId: "alpha", goal: "g" });
    stepDone(e, "t1");
    await c.waitFor(() => levelUps(c.received).length > 0);
    expect(levelUps(c.received)).toEqual([{ type: "level_up", who: "member", name: "Ada", level: 1 }]);
  });

  it("pays the user for an approved plan, a passed job and a delivered branch, and announces the user's level-up", async () => {
    const e = engine([ADA]);
    const c = await connect(e.link, progressStore(10, 30));
    e.push({ type: "task.created", taskId: "t1", repoId: "alpha", goal: "g" });
    e.push({ type: "approval.requested", taskId: "t1", approvalId: "appr-t1", kind: "plan", summary: "Plan" } as NewEvent);
    e.push({ type: "approval.resolved", taskId: "t1", approvalId: "appr-t1", decision: "approve" } as NewEvent);
    stepDone(e, "t1");
    e.push({ type: "task.state_changed", taskId: "t1", state: "report_ready", reason: "verdict:pass" });
    e.push({ type: "task.state_changed", taskId: "t1", state: "delivered" });
    e.push({ type: "delivery.done", taskId: "t1", branch: "agentlife/t1", commit: "abc123" });
    await c.waitFor(() => progresses(c.received).at(-1)?.state.user.xp === 50);
    expect(levelUps(c.received)).toEqual([{ type: "level_up", who: "user", name: "You", level: 1 }]);
    expect(progresses(c.received).at(-1)?.state.user).toMatchObject({ xp: 50, level: 1, jobs: 1, passed: 1, passRate: 1 });
    expect(progresses(c.received).at(-1)?.state.members[0]).toMatchObject({ memberId: "ada", xp: 35, jobs: 1, passed: 1 });
  });

  it("counts nothing again when a new gateway on the same file sees the same events", async () => {
    const first = engine([ADA]);
    const a = await connect(first.link, progressStore());
    first.push({ type: "task.created", taskId: "t1", repoId: "alpha", goal: "g" });
    stepDone(first, "t1");
    await a.waitFor(() => progresses(a.received).some((p) => p.state.members.length > 0));

    const second = engine([ADA]);
    const b = await connect(second.link, progressStore());
    second.push({ type: "task.created", taskId: "t1", repoId: "alpha", goal: "g" });
    stepDone(second, "t1");
    await b.settle(300);
    expect(progresses(b.received)).toHaveLength(1);
    expect(progresses(b.received)[0]?.state.members[0]).toMatchObject({ memberId: "ada", xp: 10 });
  });

  it("counts nothing for events older than the file", async () => {
    const e = engine([ADA]);
    const c = await connect(e.link, progressStore());
    e.push({ type: "task.created", taskId: "old", repoId: "alpha", goal: "g", ts: SINCE - 1 });
    e.push({ type: "agent.state_changed", taskId: "old", agentId: "alpha:developer", state: "done", ts: SINCE - 1 } as NewEvent);
    await c.settle();
    expect(progresses(c.received)).toHaveLength(1);
  });

  it("lets no client message change progress", async () => {
    const c = await connect(engine().link, progressStore());
    await c.waitFor(() => progresses(c.received).length > 0);
    c.send({ type: "progress", state: { user: { xp: 99999 }, members: [] } });
    c.send({ type: "level_up", who: "user", name: "You", level: 50 });
    await c.waitFor(() => c.received.filter((m) => m.type === "error").length === 2);
    expect(c.received.filter((m) => m.type === "error").every((m) => m.type === "error" && m.code === "bad_message")).toBe(true);
    expect(progresses(c.received)).toHaveLength(1);
  });

  it("tells the client who stands where, with the member ids, so it can look the levels up", async () => {
    const e = engine([ADA]);
    const c = await connect(e.link, progressStore());
    await c.waitFor(() => c.received.some((m) => m.type === "team_view"));
    const view = c.received.find((m): m is Extract<ServerMsg, { type: "team_view" }> => m.type === "team_view");
    expect(view?.members.find((m) => m.agentId === "developer")?.memberId).toBe("ada");
    expect(view?.members.find((m) => m.agentId === "qa")?.memberId).toBe("qa");
  });
});
