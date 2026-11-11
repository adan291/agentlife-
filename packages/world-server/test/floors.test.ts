import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { ServerMsgSchema } from "@agentlife/shared";
import type { AgentEvent, ClientMsg, FloorStatus, Project, RoomId, ServerMsg } from "@agentlife/shared";
import { EventQueue } from "../src/engine-link.ts";
import type { EngineLink } from "../src/engine-link.ts";
import { startGateway } from "../src/gateway.ts";
import type { Gateway } from "../src/gateway.ts";
import { testHotel } from "./helpers.ts";

const gateways: Gateway[] = [];
const sockets: WebSocket[] = [];
afterEach(async () => {
  for (const s of sockets.splice(0)) s.terminate();
  for (const g of gateways.splice(0)) await g.close();
});

const project = (id: string): Project => ({ id, name: id.toUpperCase(), stack: "node-npm", testCommand: "npm test", builtin: false, registeredAt: 1 });

/** An engine with a list of projects the test can change, and events the test pushes. */
function engineWith(initial: string[]) {
  const queue = new EventQueue<AgentEvent>();
  let projects = initial.map(project);
  const resolved: string[] = [];
  const link: EngineLink = {
    listRepos: () => Promise.resolve(projects.map((p) => ({ id: p.id, name: p.name }))),
    startJob: (repoId) => Promise.resolve({ taskId: `task-${repoId}` }),
    resolveApproval: (id) => (resolved.push(id), Promise.resolve()),
    getJob: (taskId) =>
      Promise.resolve({ taskId, repoId: taskId.replace("task-", ""), goal: "g", state: "analyzing", timeline: [] }),
    listProjects: () => Promise.resolve(projects),
    getJobDetails: () => Promise.reject(new Error("not used")),
    events: () => queue,
    close: () => queue.close(),
  };
  let seq = 0;
  const push = (taskId: string, ev: Record<string, unknown>) => queue.push({ seq: seq++, ts: 1000 + seq, taskId, ...ev } as AgentEvent);
  return { link, push, resolved, setProjects: (ids: string[]) => (projects = ids.map(project)) };
}

async function boot(engine: EngineLink, start: RoomId = "lobby") {
  // No floors are added by hand: the gateway builds them from the engine's projects.
  const hotel = testHotel({ start });
  const gateway = await startGateway({ hotel, engine, port: 0, tickMs: 5 });
  gateways.push(gateway);
  return gateway;
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
  const welcomes = () => received.flatMap((m) => (m.type === "welcome" ? [m] : []));
  const floors = (): FloorStatus[] => received.findLast((m) => m.type === "floors")?.floors ?? [];
  const statusOf = (roomId: string): FloorStatus | undefined => floors().find((f) => f.roomId === roomId);
  const has = (pred: (m: ServerMsg) => boolean) => received.some(pred);
  return { ws, received, waitFor, send, welcomes, floors, statusOf, has };
}
type Client = ReturnType<typeof connect>;

/** Waits until the lobby's floor list shows the given floors. */
const floorsAre = (c: Client, ids: string[]) => c.waitFor(() => ids.every((id) => c.statusOf(id)));
/** A message that arrives after everything queued before it: lets the test assert that something did not arrive. */
const marker = async (c: Client, push: (taskId: string, ev: Record<string, unknown>) => void, project: string, text: string) => {
  push(`task-${project}`, { type: "agent.say", agentId: `${project}:qa`, text });
  await c.waitFor(() => c.has((m) => m.type === "say" && m.text === text), 500).catch(() => undefined);
};

describe("elevator and doors", () => {
  it("takes the user from the lobby to a project floor and back, each time at the elevator", async () => {
    const e = engineWith(["alpha"]);
    const c = connect((await boot(e.link)).port);
    await floorsAre(c, ["project:alpha"]);

    c.send({ type: "use", itemId: "elevator_1" });
    await c.waitFor(() => c.has((m) => m.type === "open_panel" && m.panel === "elevator"));

    c.send({ type: "go_to", roomId: "project:alpha" });
    await c.waitFor(() => c.welcomes().length === 2);
    const there = c.welcomes()[1]!;
    expect(there.room.id).toBe("project:alpha");
    expect(there.room.name).toBe("ALPHA");
    expect(there.agents.map((a) => a.agentId)).toEqual(["architect", "developer", "qa"]);
    const me = there.avatars.find((a) => a.id === there.you)!;
    expect({ x: me.x, y: me.y }).toEqual({ x: there.room.door.x, y: there.room.door.y });

    c.send({ type: "go_to", roomId: "lobby" });
    await c.waitFor(() => c.welcomes().length === 3);
    expect(c.welcomes()[2]!.room.id).toBe("lobby");
    expect(c.welcomes()[2]!.agents.map((a) => a.agentId)).toEqual(["builder"]);
  });

  it("refuses the elevator away from it, and an unknown floor", async () => {
    const e = engineWith(["alpha"]);
    const c = connect((await boot(e.link)).port);
    await floorsAre(c, ["project:alpha"]);

    c.send({ type: "go_to", roomId: "project:nope" });
    await c.waitFor(() => c.has((m) => m.type === "error" && m.message === "unknown floor"));

    c.send({ type: "move", x: 6, y: 5 });
    await c.waitFor(() => c.has((m) => m.type === "walk"));
    await new Promise((r) => setTimeout(r, 120)); // 5 ms per tile
    c.send({ type: "go_to", roomId: "project:alpha" });
    await c.waitFor(() => c.has((m) => m.type === "error" && m.message === "use the elevator first"));
    expect(c.welcomes()).toHaveLength(1);

    c.ws.send(JSON.stringify({ type: "go_to", roomId: "../etc" }));
    await c.waitFor(() => c.received.filter((m) => m.type === "error").length === 3);
  });

  it("the door in the lobby leads to the HR office", async () => {
    const e = engineWith([]);
    const c = connect((await boot(e.link)).port);
    await c.waitFor(() => c.welcomes().length === 1);
    c.send({ type: "use", itemId: "door_hr" });
    await c.waitFor(() => c.welcomes().length === 2);
    const hr = c.welcomes()[1]!;
    expect(hr.room.id).toBe("hr");
    expect(hr.agents).toEqual([]);
    expect(c.has((m) => m.type === "open_panel" && m.panel === "door")).toBe(false);
  });

  it("takes a user standing on a floor whose project was removed to the lobby, and drops the floor from the list", async () => {
    const e = engineWith(["alpha", "beta"]);
    const g = await boot(e.link, "project:alpha");
    const first = connect(g.port);
    await floorsAre(first, ["project:alpha", "project:beta"]);

    e.setProjects(["beta"]);
    const second = connect(g.port);
    await second.waitFor(() => second.welcomes().length === 2);
    expect(second.welcomes()[0]!.room.id).toBe("project:alpha");
    expect(second.welcomes()[1]!.room.id).toBe("lobby");
    await second.waitFor(() => second.floors().length > 0 && !second.statusOf("project:alpha"));
    expect(second.floors().map((f) => f.roomId)).toEqual(["lobby", "hr", "project:beta"]);
  });

  it("gives a project registered later its floor when the next connection arrives", async () => {
    const e = engineWith(["alpha"]);
    const g = await boot(e.link);
    const first = connect(g.port);
    await floorsAre(first, ["project:alpha"]);
    expect(first.statusOf("project:beta")).toBeUndefined();

    e.setProjects(["alpha", "beta"]);
    const second = connect(g.port);
    await floorsAre(second, ["project:alpha", "project:beta"]);
    expect(second.floors().map((f) => f.roomId)).toEqual(["lobby", "hr", "project:alpha", "project:beta"]);
  });
});

describe("messages stay on their floor", () => {
  it("never sends an event of project beta to a user on alpha, and shows it on the floor list", async () => {
    const e = engineWith(["alpha", "beta"]);
    const c = connect((await boot(e.link, "project:alpha")).port);
    await floorsAre(c, ["project:beta"]);

    e.push("task-beta", { type: "task.created", repoId: "beta", goal: "g" });
    e.push("task-beta", { type: "agent.goto", agentId: "beta:architect", anchor: "board" });
    e.push("task-beta", { type: "agent.state_changed", agentId: "beta:architect", state: "thinking", text: "beta thoughts" });
    e.push("task-beta", { type: "agent.activity", agentId: "beta:architect", text: "reading beta" });
    e.push("task-beta", { type: "task.state_changed", state: "awaiting_plan_approval" });
    e.push("task-beta", { type: "approval.requested", agentId: "beta:architect", approvalId: "appr-beta", kind: "plan", summary: "s" });
    await marker(c, e.push, "alpha", "marker 1");

    expect(c.has((m) => m.type === "say" && m.text === "marker 1")).toBe(true);
    for (const type of ["walk", "agent_state", "activity", "approval", "job_update", "work"] as const) {
      expect(c.has((m) => m.type === type), type).toBe(false);
    }
    expect(c.statusOf("project:beta")).toMatchObject({ status: "waiting_approval" });
    expect(c.statusOf("project:alpha")).toMatchObject({ status: "idle" });

    // Events of the user's own floor do arrive, as plain agent ids of the room.
    e.push("task-alpha", { type: "task.created", repoId: "alpha", goal: "g" });
    e.push("task-alpha", { type: "agent.state_changed", agentId: "alpha:architect", state: "thinking" });
    await c.waitFor(() => c.has((m) => m.type === "agent_state" && m.agentId === "architect" && m.state === "thinking"));
    expect(c.has((m) => m.type === "agent_state" && m.text === "beta thoughts")).toBe(false);
  });

  it("a user who goes to beta sees what happened there: the state of its agents and the pending approval", async () => {
    const e = engineWith(["alpha", "beta"]);
    const c = connect((await boot(e.link)).port);
    await floorsAre(c, ["project:beta"]);

    e.push("task-beta", { type: "task.created", repoId: "beta", goal: "g" });
    e.push("task-beta", { type: "agent.state_changed", agentId: "beta:architect", state: "waiting_approval", text: "Plan ready" });
    e.push("task-beta", { type: "task.state_changed", state: "awaiting_plan_approval" });
    e.push("task-beta", { type: "approval.requested", agentId: "beta:architect", approvalId: "appr-beta", kind: "plan", summary: "s" });
    await c.waitFor(() => c.statusOf("project:beta")?.status === "waiting_approval");
    expect(c.has((m) => m.type === "approval")).toBe(false);

    c.send({ type: "go_to", roomId: "project:beta" });
    await c.waitFor(() => c.welcomes().length === 2);
    expect(c.welcomes()[1]!.agents.find((a) => a.agentId === "architect")).toMatchObject({ state: "waiting_approval", text: "Plan ready" });
    await c.waitFor(() => c.has((m) => m.type === "approval" && m.approval.approvalId === "appr-beta"));
    await c.waitFor(() => c.has((m) => m.type === "job_update" && m.job.taskId === "task-beta"));
  });

  it("decides an approval only on the floor where it waits, and starts jobs only for the floor's project", async () => {
    const e = engineWith(["alpha", "beta"]);
    const c = connect((await boot(e.link, "project:alpha")).port);
    await floorsAre(c, ["project:beta"]);
    e.push("task-beta", { type: "task.created", repoId: "beta", goal: "g" });
    e.push("task-beta", { type: "approval.requested", agentId: "beta:architect", approvalId: "appr-beta", kind: "plan", summary: "s" });
    await marker(c, e.push, "alpha", "m");

    c.send({ type: "approve", approvalId: "appr-beta", decision: "approve" });
    await c.waitFor(() => c.has((m) => m.type === "error" && m.message === "unknown or resolved approval"));
    expect(e.resolved).toEqual([]);

    c.send({ type: "start_job", repoId: "beta", goal: "x" });
    await c.waitFor(() => c.has((m) => m.type === "error" && m.code === "bad_message" && m.message.includes("project's floor")));

    c.send({ type: "job_details", taskId: "task-beta" });
    await c.waitFor(() => c.has((m) => m.type === "error" && m.message === "that job is on another floor"));
  });

  it("the Builder lives in the lobby: its events reach only a user there", async () => {
    const e = engineWith(["alpha"]);
    const g = await boot(e.link, "project:alpha");
    const onAlpha = connect(g.port);
    await floorsAre(onAlpha, ["project:alpha"]);
    e.push("build:S1", { type: "agent.state_changed", agentId: "builder", state: "working", text: "Editing" });
    e.push("build:S1", { type: "agent.activity", agentId: "builder", text: "Started S1" });
    await marker(onAlpha, e.push, "alpha", "m");
    expect(onAlpha.has((m) => m.type === "agent_state" && m.agentId === "builder")).toBe(false);
    expect(onAlpha.has((m) => m.type === "activity")).toBe(false);

    onAlpha.send({ type: "use", itemId: "elevator_1" });
    await onAlpha.waitFor(() => onAlpha.has((m) => m.type === "open_panel"));
    onAlpha.send({ type: "go_to", roomId: "lobby" });
    await onAlpha.waitFor(() => onAlpha.welcomes().length === 2);
    const lobby = onAlpha.welcomes()[1]!;
    expect(lobby.agents).toEqual([{ agentId: "builder", state: "working", text: "Editing" }]);
    expect(lobby.activity).toMatchObject([{ agentId: "builder", text: "Started S1" }]);
  });

  it("sends other floors' activity only after the terminal asks for all floors, tagged with its floor", async () => {
    const e = engineWith(["alpha", "beta"]);
    const c = connect((await boot(e.link, "project:alpha")).port);
    await floorsAre(c, ["project:beta"]);
    e.push("task-beta", { type: "task.created", repoId: "beta", goal: "g" });
    e.push("task-beta", { type: "agent.activity", agentId: "beta:architect", text: "before the switch" });
    e.push("task-alpha", { type: "task.created", repoId: "alpha", goal: "g" });
    e.push("task-alpha", { type: "agent.activity", agentId: "alpha:architect", text: "own floor" });
    await c.waitFor(() => c.has((m) => m.type === "activity" && m.line.text === "own floor"));
    expect(c.has((m) => m.type === "activity" && m.line.text === "before the switch")).toBe(false);
    expect(c.received.find((m) => m.type === "activity")).toMatchObject({ line: { roomId: "project:alpha" } });

    // The buffered lines of the other floor arrive at once, then its new lines as they happen.
    c.send({ type: "activity_scope", scope: "all" });
    await c.waitFor(() => c.has((m) => m.type === "activity" && m.line.text === "before the switch"));
    expect(c.received.findLast((m) => m.type === "activity")).toMatchObject({ line: { roomId: "project:beta", agentId: "architect" } });
    e.push("task-beta", { type: "agent.activity", agentId: "beta:architect", text: "after the switch" });
    await c.waitFor(() => c.has((m) => m.type === "activity" && m.line.text === "after the switch"));

    // Back to one floor: nothing more from the others.
    c.send({ type: "activity_scope", scope: "floor" });
    await new Promise((r) => setTimeout(r, 100));
    e.push("task-beta", { type: "agent.activity", agentId: "beta:architect", text: "quiet again" });
    await marker(c, e.push, "alpha", "m");
    expect(c.has((m) => m.type === "activity" && m.line.text === "quiet again")).toBe(false);
  });

  it("the computer of a floor offers only that floor's project", async () => {
    const e = engineWith(["alpha", "beta"]);
    const c = connect((await boot(e.link, "project:alpha")).port);
    await floorsAre(c, ["project:beta"]);
    c.send({ type: "use", itemId: "computer_desk_1" });
    await c.waitFor(() => c.has((m) => m.type === "open_panel" && m.panel === "computer"));
    expect(c.received.find((m) => m.type === "repos")).toEqual({ type: "repos", repos: [{ id: "alpha", name: "ALPHA" }] });
  });
});

describe("floor status", () => {
  const states = ["analyzing", "awaiting_plan_approval", "developing", "testing", "reviewing"] as const;

  it("follows the job: working with who, waiting for approval, report ready until the mailbox is opened", async () => {
    const e = engineWith(["alpha"]);
    const c = connect((await boot(e.link)).port);
    await floorsAre(c, ["project:alpha"]);
    const status = () => c.statusOf("project:alpha")!;

    e.push("task-alpha", { type: "task.created", repoId: "alpha", goal: "g" });
    await c.waitFor(() => status().status === "working");
    expect(status()).toMatchObject({ status: "working", who: "architect" });

    const expected = [
      { status: "working", who: "architect" },
      { status: "waiting_approval" },
      { status: "working", who: "developer" },
      { status: "working", who: "qa" },
      { status: "working", who: "qa" },
    ];
    for (const [i, state] of states.entries()) {
      e.push("task-alpha", { type: "task.state_changed", state });
      await c.waitFor(() => {
        const s = status();
        return s.status === expected[i]!.status && s.who === (expected[i] as { who?: string }).who;
      });
    }

    e.push("task-alpha", { type: "task.state_changed", state: "report_ready", reason: "verdict:pass" });
    e.push("task-alpha", { type: "report.ready", agentId: "alpha:qa", reportId: "r1", title: "Report", markdown: "# ok" });
    e.push("task-alpha", { type: "task.state_changed", state: "delivered" });
    await c.waitFor(() => status().status === "report_ready");

    // Opening the mailbox on that floor reads the report.
    c.send({ type: "go_to", roomId: "project:alpha" });
    await c.waitFor(() => c.welcomes().length === 2);
    c.send({ type: "use", itemId: "mailbox_1" });
    await c.waitFor(() => status().status === "idle");
  });

  it("marks a report with a failed verdict as failed, and a new job clears it", async () => {
    const e = engineWith(["alpha"]);
    const c = connect((await boot(e.link)).port);
    await floorsAre(c, ["project:alpha"]);
    e.push("task-alpha", { type: "task.created", repoId: "alpha", goal: "g" });
    e.push("task-alpha", { type: "task.state_changed", state: "report_ready", reason: "verdict:fail" });
    e.push("task-alpha", { type: "report.ready", agentId: "alpha:qa", reportId: "r1", title: "Report", markdown: "# no" });
    e.push("task-alpha", { type: "task.state_changed", state: "delivered" });
    await c.waitFor(() => c.statusOf("project:alpha")?.status === "failed");

    e.push("task-alpha2", { type: "task.created", repoId: "alpha", goal: "again" });
    await c.waitFor(() => c.statusOf("project:alpha")?.status === "working");
  });

  it("shows a job that waits for a slot as queued with its place", async () => {
    const e = engineWith(["alpha", "beta"]);
    const c = connect((await boot(e.link)).port);
    await floorsAre(c, ["project:beta"]);
    e.push("task-beta", { type: "task.created", repoId: "beta", goal: "g" });
    e.push("task-beta", { type: "task.queued", position: 2 });
    await c.waitFor(() => c.statusOf("project:beta")?.status === "queued");
    expect(c.statusOf("project:beta")).toMatchObject({ status: "queued", queuePosition: 2 });
    e.push("task-beta", { type: "task.queued", position: 1 });
    await c.waitFor(() => c.statusOf("project:beta")?.queuePosition === 1);
    e.push("task-beta", { type: "task.state_changed", state: "analyzing" });
    await c.waitFor(() => c.statusOf("project:beta")?.status === "working");
    expect(c.statusOf("project:beta")?.queuePosition).toBeUndefined();
  });

  it("a cancelled job leaves the floor idle", async () => {
    const e = engineWith(["alpha"]);
    const c = connect((await boot(e.link)).port);
    await floorsAre(c, ["project:alpha"]);
    e.push("task-alpha", { type: "task.created", repoId: "alpha", goal: "g" });
    await c.waitFor(() => c.statusOf("project:alpha")?.status === "working");
    e.push("task-alpha", { type: "task.state_changed", state: "cancelled" });
    await c.waitFor(() => c.statusOf("project:alpha")?.status === "idle");
  });
});
