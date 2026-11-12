import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { DEFAULT_PIPELINE, ServerMsgSchema, validatePipeline } from "@agentlife/shared";
import type { AgentEvent, ClientMsg, PipelineResponse, PipelineStep, ServerMsg } from "@agentlife/shared";
import { EventQueue } from "../src/engine-link.ts";
import type { EngineLink, PipelineLink } from "../src/engine-link.ts";
import { startGateway } from "../src/gateway.ts";
import type { Gateway } from "../src/gateway.ts";
import { testHotel } from "./helpers.ts";

const gateways: Gateway[] = [];
const sockets: WebSocket[] = [];
afterEach(async () => {
  for (const s of sockets.splice(0)) s.terminate();
  for (const g of gateways.splice(0)) await g.close();
});

const MEMBERS = [
  { id: "architect", displayName: "Architect", role: "architect" as const, model: "m-a" },
  { id: "developer", displayName: "Developer", role: "developer" as const, model: "m-d" },
  { id: "qa", displayName: "QA", role: "qa" as const, model: "m-q" },
];

/** An engine whose pipeline is a list in memory, checked with the shared rules like the real one. */
function engine(opts: { withPipeline?: boolean; failState?: string } = {}) {
  const queue = new EventQueue<AgentEvent>();
  let steps: PipelineStep[] = DEFAULT_PIPELINE.map((s) => ({ ...s }));
  let customised = false;
  const calls: string[] = [];
  const view = (projectId: string): PipelineResponse => ({ projectId, customised, steps: steps.map((s) => ({ ...s })), members: MEMBERS });
  const pipeline: PipelineLink = {
    state: (projectId) => {
      calls.push(`state:${projectId}`);
      return opts.failState ? Promise.reject(new Error(opts.failState)) : Promise.resolve(view(projectId));
    },
    save: (projectId, next) => {
      calls.push(`save:${projectId}:${next.map((s) => s.kind).join(",")}`);
      const check = validatePipeline(next, MEMBERS);
      if (!check.ok) return Promise.reject(new Error(check.errors[0]!.rule));
      steps = next.map((s) => ({ ...s }));
      customised = true;
      return Promise.resolve(view(projectId));
    },
    reset: (projectId) => {
      calls.push(`reset:${projectId}`);
      steps = DEFAULT_PIPELINE.map((s) => ({ ...s }));
      customised = false;
      return Promise.resolve(view(projectId));
    },
  };
  const link: EngineLink = {
    listRepos: () => Promise.resolve([]),
    listProjects: () => Promise.resolve([{ id: "alpha", name: "alpha", builtin: true, stack: "node-npm", testCommand: "npm test", registeredAt: 0 }]),
    startJob: () => Promise.reject(new Error("not used")),
    resolveApproval: () => Promise.resolve(),
    getJob: () => Promise.reject(new Error("not used")),
    ...(opts.withPipeline === false ? {} : { pipeline }),
    events: () => queue,
    close: () => queue.close(),
  };
  return { link, calls };
}

async function connect(link: EngineLink, start: "project:alpha" | "lobby" = "project:alpha") {
  const gateway = await startGateway({ hotel: testHotel({ start, projects: ["alpha"] }), engine: link, port: 0, tickMs: 5 });
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
  const send = (msg: ClientMsg | Record<string, unknown>) => ws.send(JSON.stringify(msg));
  await waitFor(() => received.some((m) => m.type === "welcome"));
  return { received, waitFor, send };
}

const pipelines = (received: ServerMsg[]) => received.flatMap((m) => (m.type === "pipeline" ? [m] : []));
const errors = (received: ServerMsg[]) => received.flatMap((m) => (m.type === "error" ? [m] : []));

describe("the pipeline through the gateway", () => {
  it("sends the pipeline of the floor's project before it opens the board", async () => {
    const e = engine();
    const c = await connect(e.link);
    c.send({ type: "use", itemId: "board_1" });
    await c.waitFor(() => c.received.some((m) => m.type === "open_panel"));
    const types = c.received.map((m) => m.type);
    expect(types.indexOf("pipeline")).toBeGreaterThan(-1);
    expect(types.indexOf("pipeline")).toBeLessThan(types.indexOf("open_panel"));
    expect(pipelines(c.received)[0]!.state).toMatchObject({ projectId: "alpha", customised: false, steps: DEFAULT_PIPELINE });
    expect(pipelines(c.received)[0]!.state.members.map((m) => m.role)).toEqual(["architect", "developer", "qa"]);
  });

  it("answers pipeline_state with the pipeline of the user's own project", async () => {
    const e = engine();
    const c = await connect(e.link);
    c.send({ type: "pipeline_state" });
    await c.waitFor(() => pipelines(c.received).length === 1);
    expect(e.calls).toEqual(["state:alpha"]);
  });

  it("saves a pipeline and answers with the new one, then resets it", async () => {
    const e = engine();
    const c = await connect(e.link);
    const steps = [{ kind: "plan" }, { kind: "approve" }, { kind: "develop" }, { kind: "test" }, { kind: "review" }, { kind: "report" }];
    c.send({ type: "pipeline_save", steps: [{ kind: "plan", memberId: "architect" }, ...steps.slice(1)] });
    await c.waitFor(() => pipelines(c.received).some((m) => m.state.customised));
    expect(pipelines(c.received).at(-1)!.state.steps[0]).toEqual({ kind: "plan", memberId: "architect" });
    c.send({ type: "pipeline_reset" });
    await c.waitFor(() => pipelines(c.received).some((m) => !m.state.customised && m.state.steps[0]?.memberId === undefined && pipelines(c.received).length >= 2));
    expect(e.calls).toEqual(["save:alpha:plan,approve,develop,test,review,report", "reset:alpha"]);
    expect(errors(c.received)).toEqual([]);
  });

  it("shows the rule the engine refused with as a pipeline_error and sends the pipeline again", async () => {
    const e = engine();
    const c = await connect(e.link);
    c.send({ type: "pipeline_save", steps: [{ kind: "plan" }, { kind: "develop" }, { kind: "approve" }, { kind: "test" }, { kind: "review" }, { kind: "report" }] });
    await c.waitFor(() => errors(c.received).length === 1 && pipelines(c.received).length === 1);
    expect(errors(c.received)[0]).toMatchObject({ code: "pipeline_error", message: "Approval must come before Develop: nothing is built without your approval." });
    expect(pipelines(c.received)[0]!.state.customised).toBe(false);
  });

  it("refuses a pipeline that is not valid shape before it reaches the engine", async () => {
    const e = engine();
    const c = await connect(e.link);
    c.send({ type: "pipeline_save", steps: [{ kind: "deploy" }] });
    c.send({ type: "pipeline_save", steps: [{ kind: "plan", tools: ["shell"] }] });
    c.send({ type: "pipeline_state" });
    await c.waitFor(() => pipelines(c.received).length === 1);
    expect(e.calls).toEqual(["state:alpha"]);
  });

  it("says the editor needs the real engine when there is no pipeline link, and that the lobby has no pipeline", async () => {
    const none = await connect(engine({ withPipeline: false }).link);
    none.send({ type: "pipeline_state" });
    await none.waitFor(() => errors(none.received).length === 1);
    expect(errors(none.received)[0]).toMatchObject({ code: "pipeline_error", message: "The pipeline editor needs the real engine." });
    const lobby = await connect(engine().link, "lobby");
    lobby.send({ type: "pipeline_state" });
    await lobby.waitFor(() => errors(lobby.received).length === 1);
    expect(errors(lobby.received)[0]).toMatchObject({ code: "bad_message" });
  });

  it("reports an engine that cannot be read", async () => {
    const c = await connect(engine({ failState: "engine is down" }).link);
    c.send({ type: "pipeline_state" });
    await c.waitFor(() => errors(c.received).length === 1);
    expect(errors(c.received)[0]).toMatchObject({ code: "pipeline_error", message: "engine is down" });
  });
});
