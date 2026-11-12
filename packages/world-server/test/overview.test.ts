import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { ServerMsgSchema } from "@agentlife/shared";
import type { AgentEvent, ClientMsg, FloorInfo, JobState, OverviewFloor, Project, Report, ServerMsg } from "@agentlife/shared";
import { EventQueue } from "../src/engine-link.ts";
import type { EngineLink } from "../src/engine-link.ts";
import { startGateway } from "../src/gateway.ts";
import type { Gateway } from "../src/gateway.ts";
import { floorStatusOf, overviewOf } from "../src/overview.ts";
import type { FloorSnapshot } from "../src/overview.ts";
import { testHotel } from "./helpers.ts";

const infos: FloorInfo[] = [
  { roomId: "lobby", name: "Lobby", kind: "lobby" },
  { roomId: "hr", name: "HR", kind: "hr" },
  { roomId: "project:alpha", name: "ALPHA", kind: "project" },
  { roomId: "project:beta", name: "BETA", kind: "project" },
];

const snapshot = (over: Partial<FloorSnapshot> = {}): FloorSnapshot => ({
  approvals: new Map(),
  reports: new Map(),
  currentTaskId: null,
  jobState: undefined,
  queuePosition: undefined,
  unread: null,
  ...over,
});

const report = (over: Partial<Report> = {}): Report => ({ reportId: "r1", taskId: "t1", title: "Report", markdown: "# BODY", ...over });

describe("overviewOf", () => {
  it("lists the project floors only, with nothing about a floor that never ran a job", () => {
    const list = overviewOf(infos, new Map());
    expect(list.map((f) => f.roomId)).toEqual(["project:alpha", "project:beta"]);
    expect(list[0]).toEqual({ roomId: "project:alpha", projectId: "alpha", name: "ALPHA", status: "idle", waiting: 0 });
  });

  const walk: { state: JobState; status: string; who?: string }[] = [
    { state: "created", status: "working", who: "architect" },
    { state: "analyzing", status: "working", who: "architect" },
    { state: "awaiting_plan_approval", status: "waiting_approval" },
    { state: "developing", status: "working", who: "developer" },
    { state: "testing", status: "working", who: "qa" },
    { state: "reviewing", status: "working", who: "qa" },
    { state: "report_ready", status: "working", who: "architect" },
    { state: "delivered", status: "idle" },
    { state: "failed", status: "idle" },
    { state: "cancelled", status: "idle" },
  ];
  for (const { state, status, who } of walk) {
    it(`shows a job in ${state} as ${status}${who ? ` (${who})` : ""}`, () => {
      const timeline = [
        { ts: 1000, state: "created" as const },
        { ts: 2000, state },
      ];
      const f = overviewOf(infos, new Map([["project:alpha", snapshot({ currentTaskId: "task-1", jobState: state, timeline })]]))[0]!;
      expect(f.status).toBe(status);
      expect(f.who).toBe(who);
      expect(f.job).toEqual({ taskId: "task-1", state, startedAt: 1000, timeline });
    });
  }

  it("carries the kind and target of a job that is not a change, and leaves them out for a change", () => {
    const base = { currentTaskId: "t", jobState: "analyzing" as const, timeline: [{ ts: 5, state: "created" as const }] };
    const review = overviewOf(infos, new Map([["project:alpha", snapshot({ ...base, jobKind: "review-branch", jobTarget: "feature/x" })]]))[0]!;
    expect(review.job).toMatchObject({ kind: "review-branch", target: "feature/x" });
    const change = overviewOf(infos, new Map([["project:alpha", snapshot({ ...base, jobKind: "change" })]]))[0]!;
    expect(change.job?.kind).toBeUndefined();
  });

  it("counts only the approvals that wait", () => {
    const approvals = new Map([
      ["a1", { approvalId: "a1", taskId: "t", kind: "plan", summary: "PLAN TEXT", status: "pending" as const }],
      ["a2", { approvalId: "a2", taskId: "t", kind: "plan", summary: "old", status: "approved" as const }],
    ]);
    const f = overviewOf(infos, new Map([["project:alpha", snapshot({ approvals })]]))[0]!;
    expect(f.waiting).toBe(1);
  });

  it("reports the newest report with its verdict, time and delivery state, but not its text", () => {
    const reports = new Map([
      ["r1", report({ reportId: "r1", taskId: "t1", ts: 100, verdict: "fail" })],
      ["r2", report({ reportId: "r2", taskId: "t2", ts: 900, verdict: "pass", delivery: { state: "available" }, markdown: "SECRET BODY" })],
    ]);
    const f = overviewOf(infos, new Map([["project:alpha", snapshot({ reports })]]))[0]!;
    expect(f.lastReport).toEqual({ reportId: "r2", taskId: "t2", verdict: "pass", at: 900, delivery: "available" });
    expect(JSON.stringify(f)).not.toContain("SECRET BODY");
    const noVerdict = overviewOf(infos, new Map([["project:alpha", snapshot({ reports: new Map([["r", report({ reportId: "r" })]]) })]]))[0]!;
    expect(noVerdict.lastReport).toEqual({ reportId: "r", taskId: "t1" });
  });

  it("shows a finished job with an unread report or failure, as the elevator does", () => {
    expect(floorStatusOf(snapshot({ jobState: "delivered", unread: "report_ready" }))).toEqual({ status: "report_ready" });
    expect(floorStatusOf(snapshot({ jobState: "delivered", unread: "failed" }))).toEqual({ status: "failed" });
    expect(floorStatusOf(snapshot({ jobState: "created", queuePosition: 2 }))).toEqual({ status: "queued", queuePosition: 2 });
    expect(floorStatusOf(undefined)).toEqual({ status: "idle" });
  });
});

// ---- through the gateway ----

const gateways: Gateway[] = [];
const sockets: WebSocket[] = [];
afterEach(async () => {
  for (const s of sockets.splice(0)) s.terminate();
  for (const g of gateways.splice(0)) await g.close();
});

const project = (id: string): Project => ({ id, name: id.toUpperCase(), stack: "node-npm", testCommand: "npm test", builtin: false, registeredAt: 1 });

function engineWith(ids: string[]) {
  const queue = new EventQueue<AgentEvent>();
  const projects = ids.map(project);
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
  let seq = 0;
  const push = (taskId: string, ev: Record<string, unknown>) => queue.push({ seq: seq++, ts: 1000 + seq, taskId, ...ev } as AgentEvent);
  return { link, push };
}

async function boot(engine: EngineLink, debounceMs = 20) {
  const gateway = await startGateway({ hotel: testHotel(), engine, port: 0, tickMs: 5, overviewDebounceMs: debounceMs });
  gateways.push(gateway);
  return gateway;
}

function connect(port: number) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  sockets.push(ws);
  const received: ServerMsg[] = [];
  ws.on("message", (d) => received.push(ServerMsgSchema.parse(JSON.parse(d.toString()))));
  const waitFor = async (pred: () => boolean, timeoutMs = 3000): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    while (!pred()) {
      if (Date.now() > deadline) throw new Error("timed out");
      await new Promise((r) => setTimeout(r, 10));
    }
  };
  const send = (msg: ClientMsg) => ws.send(JSON.stringify(msg));
  const overviews = () => received.flatMap((m) => (m.type === "overview" ? [m.floors] : []));
  const latest = (roomId: string): OverviewFloor | undefined => overviews().at(-1)?.find((f) => f.roomId === roomId);
  const welcomes = () => received.flatMap((m) => (m.type === "welcome" ? [m] : []));
  const has = (pred: (m: ServerMsg) => boolean) => received.some(pred);
  return { ws, received, waitFor, send, overviews, latest, welcomes, has };
}

/** The user is in the lobby and the floors of the engine's projects exist. */
const ready = async (c: ReturnType<typeof connect>): Promise<void> => {
  await c.waitFor(() => c.welcomes().length === 1);
  await c.waitFor(() => c.received.some((m) => m.type === "floors" && m.floors.some((f) => f.roomId === "project:alpha")));
};

/** Lets the gateway handle everything sent so far: a message that is answered always. */
const settle = (ms = 120) => new Promise((r) => setTimeout(r, ms));

describe("overview_watch", () => {
  it("sends nothing until asked, then the overview at once, then again after a change", async () => {
    const e = engineWith(["alpha", "beta"]);
    const c = connect((await boot(e.link)).port);
    await ready(c);
    e.push("task-alpha", { type: "task.created", repoId: "alpha", goal: "g" });
    await settle();
    expect(c.overviews()).toHaveLength(0);

    c.send({ type: "overview_watch", on: true });
    await c.waitFor(() => c.overviews().length === 1);
    expect(c.overviews()[0]!.map((f) => f.roomId)).toEqual(["project:alpha", "project:beta"]);
    expect(c.latest("project:alpha")).toMatchObject({ status: "working", who: "architect", waiting: 0, job: { taskId: "task-alpha", state: "created" } });

    e.push("task-alpha", { type: "task.state_changed", state: "awaiting_plan_approval" });
    e.push("task-alpha", { type: "approval.requested", agentId: "alpha:architect", approvalId: "ap1", kind: "plan", summary: "PLAN-BODY-TEXT" });
    await c.waitFor(() => c.latest("project:alpha")?.waiting === 1);
    expect(c.latest("project:alpha")).toMatchObject({ status: "waiting_approval", job: { state: "awaiting_plan_approval" } });
    expect(c.latest("project:beta")).toMatchObject({ status: "idle", waiting: 0 });
  });

  it("sends one overview for a burst of changes, and none when nothing changed", async () => {
    const e = engineWith(["alpha"]);
    const c = connect((await boot(e.link, 60)).port);
    await ready(c);
    c.send({ type: "overview_watch", on: true });
    await c.waitFor(() => c.overviews().length === 1);

    e.push("task-alpha", { type: "task.created", repoId: "alpha", goal: "g" });
    for (const state of ["analyzing", "awaiting_plan_approval", "developing"] as const) e.push("task-alpha", { type: "task.state_changed", state });
    await c.waitFor(() => c.latest("project:alpha")?.status === "working" && c.latest("project:alpha")?.who === "developer");
    await settle(200);
    expect(c.overviews()).toHaveLength(2);

    // Activity lines do not change the overview.
    e.push("task-alpha", { type: "agent.activity", agentId: "alpha:developer", text: "Reading: src/secret.ts" });
    await settle(200);
    expect(c.overviews()).toHaveLength(2);
  });

  it("stops when switched off, and a new connection starts switched off", async () => {
    const e = engineWith(["alpha"]);
    const g = await boot(e.link);
    const c = connect(g.port);
    await ready(c);
    c.send({ type: "overview_watch", on: true });
    await c.waitFor(() => c.overviews().length === 1);
    c.send({ type: "overview_watch", on: false });
    await settle();
    e.push("task-alpha", { type: "task.created", repoId: "alpha", goal: "g" });
    await settle(200);
    expect(c.overviews()).toHaveLength(1);

    const second = connect(g.port);
    await ready(second);
    await settle(200);
    expect(second.overviews()).toHaveLength(0);
    second.send({ type: "overview_watch", on: true });
    await second.waitFor(() => second.overviews().length === 1);
    expect(second.latest("project:alpha")).toMatchObject({ status: "working" });
  });

  it("keeps the last report, the verdict and the delivery state, and no text of the job", async () => {
    const e = engineWith(["alpha"]);
    const c = connect((await boot(e.link)).port);
    await ready(c);
    c.send({ type: "overview_watch", on: true });
    await c.waitFor(() => c.overviews().length === 1);
    e.push("task-alpha", { type: "task.created", repoId: "alpha", goal: "GOAL-TEXT" });
    e.push("task-alpha", { type: "agent.activity", agentId: "alpha:architect", text: "ACTIVITY-TEXT" });
    e.push("task-alpha", { type: "approval.requested", agentId: "alpha:architect", approvalId: "ap1", kind: "plan", summary: "PLAN-BODY-TEXT" });
    e.push("task-alpha", { type: "task.state_changed", state: "report_ready", reason: "verdict:pass" });
    e.push("task-alpha", { type: "report.ready", agentId: "alpha:qa", reportId: "r1", title: "TITLE", markdown: "# REPORT-BODY-TEXT" });
    e.push("task-alpha", { type: "task.state_changed", state: "delivered" });
    await c.waitFor(() => c.latest("project:alpha")?.lastReport?.verdict === "pass" && c.latest("project:alpha")?.status === "report_ready");
    const f = c.latest("project:alpha")!;
    expect(f.lastReport).toMatchObject({ reportId: "r1", taskId: "task-alpha", verdict: "pass" });
    expect(f.job?.timeline.map((t) => t.state)).toEqual(["created", "report_ready", "delivered"]);

    const json = JSON.stringify(c.overviews());
    for (const secret of ["GOAL-TEXT", "ACTIVITY-TEXT", "PLAN-BODY-TEXT", "REPORT-BODY-TEXT", "TITLE", "Reading"]) expect(json).not.toContain(secret);
    expect(json).not.toMatch(/[A-Za-z]:\\|\/Users\/|\/home\//);
  });
});

describe("go_to via the list", () => {
  it("moves the user from anywhere in the lobby, while the elevator way still needs the elevator", async () => {
    const e = engineWith(["alpha"]);
    const c = connect((await boot(e.link)).port);
    await ready(c);
    // The user arrives at the elevator; walk away from it first.
    c.send({ type: "move", x: 6, y: 5 });
    await c.waitFor(() => c.has((m) => m.type === "walk"));
    await settle(150);

    c.send({ type: "go_to", roomId: "project:alpha" });
    await c.waitFor(() => c.has((m) => m.type === "error" && m.message === "use the elevator first"));
    expect(c.welcomes()).toHaveLength(1);

    c.send({ type: "go_to", roomId: "project:alpha", via: "elevator" });
    await c.waitFor(() => c.received.filter((m) => m.type === "error").length === 2);

    c.send({ type: "go_to", roomId: "project:alpha", via: "list" });
    await c.waitFor(() => c.welcomes().length === 2);
    const there = c.welcomes()[1]!;
    expect(there.room.id).toBe("project:alpha");
    const me = there.avatars.find((a) => a.id === there.you)!;
    expect({ x: me.x, y: me.y }).toEqual({ x: there.room.door.x, y: there.room.door.y });
  });

  it("refuses an unknown floor, and the same floor does nothing", async () => {
    const e = engineWith(["alpha"]);
    const c = connect((await boot(e.link)).port);
    await ready(c);
    c.send({ type: "go_to", roomId: "project:nope", via: "list" });
    await c.waitFor(() => c.has((m) => m.type === "error" && m.message === "unknown floor"));
    c.send({ type: "go_to", roomId: "lobby", via: "list" });
    c.ws.send(JSON.stringify({ type: "go_to", roomId: "lobby", via: "teleport" }));
    await c.waitFor(() => c.has((m) => m.type === "error" && m.message === "invalid message"));
    expect(c.welcomes()).toHaveLength(1);
  });
});

describe("show_panel", () => {
  it("sends the data of the panel and then opens it, without walking", async () => {
    const e = engineWith(["alpha"]);
    const c = connect((await boot(e.link)).port);
    await ready(c);
    c.send({ type: "go_to", roomId: "project:alpha", via: "list" });
    await c.waitFor(() => c.welcomes().length === 2);

    c.send({ type: "show_panel", panel: "computer" });
    await c.waitFor(() => c.has((m) => m.type === "open_panel" && m.panel === "computer"));
    const repos = c.received.findIndex((m) => m.type === "repos");
    const open = c.received.findIndex((m) => m.type === "open_panel");
    expect(repos).toBeGreaterThan(-1);
    expect(repos).toBeLessThan(open);
    expect(c.has((m) => m.type === "walk")).toBe(false);
  });

  it("sends the approvals and reports of the floor with the mailbox, and marks the report read", async () => {
    const e = engineWith(["alpha"]);
    const c = connect((await boot(e.link)).port);
    await ready(c);
    e.push("task-alpha", { type: "task.created", repoId: "alpha", goal: "g" });
    e.push("task-alpha", { type: "approval.requested", agentId: "alpha:architect", approvalId: "ap1", kind: "plan", summary: "s" });
    e.push("task-alpha", { type: "report.ready", agentId: "alpha:qa", reportId: "r1", title: "Report", markdown: "# ok" });
    e.push("task-alpha", { type: "task.state_changed", state: "delivered" });
    await c.waitFor(() => c.received.some((m) => m.type === "floors" && m.floors.some((f) => f.roomId === "project:alpha" && f.status === "report_ready")));

    c.send({ type: "go_to", roomId: "project:alpha", via: "list" });
    await c.waitFor(() => c.welcomes().length === 2);
    c.send({ type: "show_panel", panel: "mailbox" });
    await c.waitFor(() => c.has((m) => m.type === "open_panel" && m.panel === "mailbox"));
    expect(c.has((m) => m.type === "report" && m.report.reportId === "r1" && m.resend === true)).toBe(true);
    await c.waitFor(() => c.received.findLast((m) => m.type === "floors")?.type === "floors" && c.received.findLast((m) => m.type === "floors")!.floors.find((f) => f.roomId === "project:alpha")!.status === "idle");
  });

  it("refuses a panel the floor has no furniture for, and a panel that is not showable", async () => {
    const e = engineWith(["alpha"]);
    const c = connect((await boot(e.link)).port);
    await ready(c);
    // The lobby has no computer.
    c.send({ type: "show_panel", panel: "computer" });
    await c.waitFor(() => c.has((m) => m.type === "error" && m.message === "this floor has no such desk"));
    c.ws.send(JSON.stringify({ type: "show_panel", panel: "hr" }));
    c.ws.send(JSON.stringify({ type: "show_panel", panel: "door" }));
    await c.waitFor(() => c.received.filter((m) => m.type === "error" && m.message === "invalid message").length === 2);
    expect(c.has((m) => m.type === "open_panel")).toBe(false);
  });

  it("opens the night board in the lobby from a project floor", async () => {
    const e = engineWith(["alpha"]);
    const c = connect((await boot(e.link)).port);
    await ready(c);
    c.send({ type: "go_to", roomId: "project:alpha", via: "list" });
    await c.waitFor(() => c.welcomes().length === 2);
    c.send({ type: "show_panel", panel: "night" });
    await c.waitFor(() => c.has((m) => m.type === "error" && m.message === "this floor has no such desk"));
    c.send({ type: "go_to", roomId: "lobby", via: "list" });
    await c.waitFor(() => c.welcomes().length === 3);
    c.send({ type: "show_panel", panel: "night" });
    await c.waitFor(() => c.has((m) => m.type === "open_panel" && m.panel === "night"));
  });
});
