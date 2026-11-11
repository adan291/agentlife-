import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { AgentEventSchema, ServerMsgSchema } from "@agentlife/shared";
import type { AgentEvent, ServerMsg } from "@agentlife/shared";
import { FakeEngineLink } from "../src/fake-engine.ts";
import { startGateway } from "../src/gateway.ts";
import type { Gateway } from "../src/gateway.ts";
import { testHotel } from "./helpers.ts";

/** Collect events from the engine into an array until closed. */
function collect(engine: FakeEngineLink) {
  const events: AgentEvent[] = [];
  const done = (async () => {
    for await (const ev of engine.events()) events.push(ev);
  })();
  return { events, done };
}

const tick = () => new Promise<void>((r) => setTimeout(r, 20));

describe("FakeEngineLink", () => {
  it("lists the fake repo and rejects other repos", async () => {
    const engine = new FakeEngineLink({ stepMs: 0 });
    expect((await engine.listRepos()).map((r) => r.id)).toEqual(["haunted-todo"]);
    await expect(engine.startJob("evil", "x")).rejects.toThrow(/allowlisted/);
    engine.close();
  });

  it("reaches report.ready only after an approve", async () => {
    const engine = new FakeEngineLink({ stepMs: 0 });
    const { events, done } = collect(engine);
    const { taskId } = await engine.startJob("haunted-todo", "fix the failing test");
    await tick();

    const request = events.find((e) => e.type === "approval.requested");
    expect(request).toBeDefined();
    expect(events.some((e) => e.type === "report.ready")).toBe(false);
    expect((await engine.getJob(taskId)).state).toBe("awaiting_plan_approval");

    // Still waiting after more time passes.
    await tick();
    expect(events.some((e) => e.type === "report.ready")).toBe(false);

    if (request?.type !== "approval.requested") throw new Error("unreachable");
    await engine.resolveApproval(request.approvalId, "approve");
    await tick();

    const types = events.map((e) => e.type);
    expect(types).toContain("report.ready");
    expect(types.indexOf("report.ready")).toBeGreaterThan(types.indexOf("approval.resolved"));
    expect((await engine.getJob(taskId)).state).toBe("delivered");
    // Every event is a valid AgentEvent with increasing seq.
    for (const e of events) AgentEventSchema.parse(e);
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i));
    engine.close();
    await done;
  });

  it("stops without a report when the plan is rejected", async () => {
    const engine = new FakeEngineLink({ stepMs: 0 });
    const { events } = collect(engine);
    const { taskId } = await engine.startJob("haunted-todo", "g");
    await tick();
    await engine.resolveApproval(`appr-${taskId}`, "reject");
    await tick();
    expect(events.some((e) => e.type === "report.ready")).toBe(false);
    expect(events.some((e) => e.type === "task.failed")).toBe(true);
    expect((await engine.getJob(taskId)).state).toBe("cancelled");
    engine.close();
  });

  it("rejects an unknown approval", async () => {
    const engine = new FakeEngineLink({ stepMs: 0 });
    await expect(engine.resolveApproval("nope", "approve")).rejects.toThrow();
    engine.close();
  });
});

describe("gateway with the fake engine", () => {
  const gateways: Gateway[] = [];
  const sockets: WebSocket[] = [];
  afterEach(async () => {
    for (const s of sockets.splice(0)) s.terminate();
    for (const g of gateways.splice(0)) await g.close();
  });

  async function setup() {
    // The user starts on the floor of the project the fake engine works on.
    const hotel = testHotel({ start: "project:haunted-todo", projects: ["haunted-todo"] });
    const engine = new FakeEngineLink({ stepMs: 0 });
    const gateway = await startGateway({ hotel, engine, port: 0, tickMs: 5 });
    gateways.push(gateway);
    const ws = new WebSocket(`ws://127.0.0.1:${gateway.port}`);
    sockets.push(ws);
    const received: ServerMsg[] = [];
    const waiters: (() => void)[] = [];
    ws.on("message", (d) => {
      received.push(ServerMsgSchema.parse(JSON.parse(d.toString())));
      waiters.splice(0).forEach((w) => w());
    });
    const next = async (pred: (m: ServerMsg) => boolean, timeoutMs = 2000): Promise<ServerMsg> => {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const i = received.findIndex(pred);
        if (i >= 0) return received.splice(i, 1)[0]!;
        const left = deadline - Date.now();
        if (left <= 0) throw new Error("timed out waiting for message");
        await new Promise<void>((r) => {
          waiters.push(r);
          setTimeout(r, left);
        });
      }
    };
    await new Promise<void>((r) => ws.once("open", () => r()));
    const send = (m: unknown) => ws.send(JSON.stringify(m));
    return { ws, received, next, send, port: gateway.port };
  }

  it("sends the running job to a client that connects later (stepper after a reload)", async () => {
    const c = await setup();
    c.send({ type: "start_job", repoId: "haunted-todo", goal: "fix it" });
    await c.next((m) => m.type === "approval" && m.approval.status === "pending");

    const late = new WebSocket(`ws://127.0.0.1:${c.port}`);
    sockets.push(late);
    const seen: ServerMsg[] = [];
    late.on("message", (d) => seen.push(ServerMsgSchema.parse(JSON.parse(d.toString()))));
    const deadline = Date.now() + 2000;
    while (!seen.some((m) => m.type === "job_update") && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
    const types = seen.map((m) => m.type);
    expect(types[0]).toBe("welcome");
    expect(seen.find((m) => m.type === "job_update")).toMatchObject({ job: { goal: "fix it", state: "awaiting_plan_approval" } });
  });

  it("sends repos before open_panel for the computer", async () => {
    const c = await setup();
    c.send({ type: "use", itemId: "computer_desk_1" });
    const repos = await c.next((m) => m.type === "repos");
    expect(repos).toMatchObject({ repos: [{ id: "haunted-todo" }] });
    expect(await c.next((m) => m.type === "open_panel")).toMatchObject({ panel: "computer" });
  });

  it("runs a job: approval arrives, report only after approve", async () => {
    const c = await setup();
    c.send({ type: "start_job", repoId: "haunted-todo", goal: "fix it" });

    const approval = await c.next((m) => m.type === "approval" && m.approval.status === "pending");
    if (approval.type !== "approval") throw new Error("unreachable");
    expect(await c.next((m) => m.type === "job_update")).toMatchObject({ job: { goal: "fix it" } });
    expect(await c.next((m) => m.type === "walk" && m.id === "architect")).toBeDefined();
    expect(await c.next((m) => m.type === "agent_state" && m.agentId === "architect")).toBeDefined();
    expect(c.received.some((m) => m.type === "report")).toBe(false);

    // A second job is refused while this one runs.
    c.send({ type: "start_job", repoId: "haunted-todo", goal: "another" });
    expect(await c.next((m) => m.type === "error")).toMatchObject({ code: "busy" });

    c.send({ type: "approve", approvalId: approval.approval.approvalId, decision: "approve" });
    expect(await c.next((m) => m.type === "report")).toMatchObject({ report: { taskId: approval.approval.taskId } });
    expect(await c.next((m) => m.type === "approval" && m.approval.status === "approved")).toBeDefined();
  });

  it("rejects an approve for an unknown approval", async () => {
    const c = await setup();
    c.send({ type: "approve", approvalId: "nope", decision: "approve" });
    expect(await c.next((m) => m.type === "error")).toMatchObject({ code: "bad_message" });
  });

  it("sends work messages and puts the latest work of each agent in the welcome of a later client", async () => {
    const c = await setup();
    c.send({ type: "start_job", repoId: "haunted-todo", goal: "fix it" });
    await c.next((m) => m.type === "approval" && m.approval.status === "pending");
    const work = await c.next((m) => m.type === "work" && m.agentId === "architect" && m.work.filesRead === 2);
    expect(work).toMatchObject({ work: { taskId: "task-1", step: "analyze", title: "Analysing haunted-todo", model: "fake", contextPct: 18.5, filesEdited: 0 } });

    const late = new WebSocket(`ws://127.0.0.1:${c.port}`);
    sockets.push(late);
    const welcome = await new Promise<ServerMsg>((resolve) => {
      late.once("message", (d) => resolve(ServerMsgSchema.parse(JSON.parse(d.toString()))));
    });
    if (welcome.type !== "welcome") throw new Error("unreachable");
    expect(welcome.agents.find((a) => a.agentId === "architect")?.work).toMatchObject({ step: "analyze", filesRead: 2, startedAt: expect.any(Number) });
    expect(welcome.agents.find((a) => a.agentId === "developer")?.work).toBeUndefined();
  });

  it("forgets the work when the job ends", async () => {
    const c = await setup();
    c.send({ type: "start_job", repoId: "haunted-todo", goal: "fix it" });
    const approval = await c.next((m) => m.type === "approval" && m.approval.status === "pending");
    if (approval.type !== "approval") throw new Error("unreachable");
    c.send({ type: "approve", approvalId: approval.approval.approvalId, decision: "approve" });
    await c.next((m) => m.type === "report");
    await new Promise((r) => setTimeout(r, 30));
    const late = new WebSocket(`ws://127.0.0.1:${c.port}`);
    sockets.push(late);
    const welcome = await new Promise<ServerMsg>((resolve) => {
      late.once("message", (d) => resolve(ServerMsgSchema.parse(JSON.parse(d.toString()))));
    });
    if (welcome.type !== "welcome") throw new Error("unreachable");
    expect(welcome.agents.every((a) => a.work === undefined)).toBe(true);
  });

  it("tags a delivered report with the verdict and time, and marks it as a resend when the mailbox is opened", async () => {
    const c = await setup();
    c.send({ type: "start_job", repoId: "haunted-todo", goal: "fix it" });
    const approval = await c.next((m) => m.type === "approval" && m.approval.status === "pending");
    if (approval.type !== "approval") throw new Error("unreachable");
    c.send({ type: "approve", approvalId: approval.approval.approvalId, decision: "approve" });
    const live = await c.next((m) => m.type === "report");
    if (live.type !== "report") throw new Error("unreachable");
    expect(live.report).toMatchObject({ taskId: "task-1", verdict: "pass", ts: expect.any(Number) });
    expect(live.resend).toBeUndefined();

    c.send({ type: "use", itemId: "mailbox_1" });
    const again = await c.next((m) => m.type === "report");
    if (again.type !== "report") throw new Error("unreachable");
    expect(again.report.reportId).toBe(live.report.reportId);
    expect(again.resend).toBe(true);
  });

  it("answers job_details with the steps and the artifact contents", async () => {
    const c = await setup();
    c.send({ type: "start_job", repoId: "haunted-todo", goal: "fix it" });
    const approval = await c.next((m) => m.type === "approval" && m.approval.status === "pending");
    if (approval.type !== "approval") throw new Error("unreachable");
    c.send({ type: "approve", approvalId: approval.approval.approvalId, decision: "approve" });
    await c.next((m) => m.type === "report");
    c.send({ type: "job_details", taskId: approval.approval.taskId });
    const msg = await c.next((m) => m.type === "job_details");
    if (msg.type !== "job_details") throw new Error("unreachable");
    const { job, artifacts } = msg.details;
    expect(job).toMatchObject({ taskId: "task-1", repoId: "haunted-todo", goal: "fix it", branch: "agentlife/task-1" });
    expect(job.steps.map((s) => s.step)).toEqual(["analyze", "develop", "test", "review", "report"]);
    expect(job.steps[0]).toMatchObject({ model: "fake", contextPeak: 18.5, filesRead: 2, filesEdited: 0 });
    expect(job.steps[1]).toMatchObject({ filesRead: 1, filesEdited: 1 });
    expect(artifacts.map((a) => a.kind)).toEqual(["plan", "diff", "test_log", "review", "report"]);
    expect(artifacts[0]?.content).toContain("Fix the failing test");
  });

  it("answers an unknown task with engine_unavailable and a malformed id with bad_message", async () => {
    const c = await setup();
    c.send({ type: "job_details", taskId: "task-99" });
    expect(await c.next((m) => m.type === "error")).toMatchObject({ code: "engine_unavailable" });
    c.send({ type: "job_details", taskId: "../etc/passwd" });
    expect(await c.next((m) => m.type === "error")).toMatchObject({ code: "bad_message" });
  });

  it("refuses a job for another project than the floor's, and a repo the engine does not know", async () => {
    const c = await setup();
    c.send({ type: "start_job", repoId: "evil", goal: "x" });
    expect(await c.next((m) => m.type === "error")).toMatchObject({ code: "bad_message" });
    c.send({ type: "start_job", repoId: "other", goal: "x" });
    expect(await c.next((m) => m.type === "error")).toMatchObject({ code: "bad_message" });
  });
});
