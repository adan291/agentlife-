import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { ACTIVITY_BUFFER_SIZE, ServerMsgSchema } from "@agentlife/shared";
import type { AgentEvent, ServerMsg } from "@agentlife/shared";
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

/** An engine that only pushes the events the test gives it. */
function scriptedEngine() {
  const queue = new EventQueue<AgentEvent>();
  const link: EngineLink = {
    listRepos: () => Promise.resolve([]),
    startJob: () => Promise.reject(new Error("not used")),
    resolveApproval: () => Promise.resolve(),
    getJob: () => Promise.reject(new Error("not used")),
    events: () => queue,
    close: () => queue.close(),
  };
  let seq = 0;
  const activity = (n: number): AgentEvent => ({
    seq: seq++,
    ts: 1_000 + n,
    taskId: "task-1",
    type: "agent.activity",
    agentId: n % 2 === 0 ? "r:developer" : "r:qa",
    text: `line ${n}`,
  });
  return { link, queue, activity };
}

/** The user is on the floor of project `r`, where the scripted jobs run. */
async function boot(link: EngineLink) {
  const hotel = testHotel({ start: "project:r", projects: ["r"] });
  const gateway = await startGateway({ hotel, engine: link, port: 0, tickMs: 5 });
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
  const waitFor = async (pred: () => boolean, timeoutMs = 2000): Promise<void> => {
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
  return { ws, received, waitFor };
}

describe("activity buffer and forwarding", () => {
  it("forwards each agent.activity event as an activity message", async () => {
    const { link, queue, activity } = scriptedEngine();
    const g = await boot(link);
    const c = connect(g.port);
    await c.waitFor(() => c.received.some((m) => m.type === "welcome"));
    queue.push(activity(1));
    await c.waitFor(() => c.received.some((m) => m.type === "activity"));
    expect(c.received.find((m) => m.type === "activity")).toEqual({
      type: "activity",
      line: { ts: 1_001, agentId: "qa", text: "line 1", taskId: "task-1", roomId: "project:r" },
    });
  });

  it("tags lines with the step of the job from its latest state change", async () => {
    const { link, queue, activity } = scriptedEngine();
    const g = await boot(link);
    const c = connect(g.port);
    await c.waitFor(() => c.received.some((m) => m.type === "welcome"));
    const base = { seq: 100, ts: 5, taskId: "task-1" } as const;
    queue.push({ ...base, type: "task.created", repoId: "r", goal: "g" });
    queue.push(activity(1)); // no step yet
    queue.push({ ...base, seq: 101, type: "task.state_changed", state: "developing" });
    queue.push(activity(2));
    queue.push({ ...base, seq: 102, type: "task.state_changed", state: "awaiting_plan_approval" });
    queue.push(activity(3));
    queue.push({ ...base, seq: 103, type: "task.state_changed", state: "delivered" });
    queue.push(activity(4));
    await c.waitFor(() => c.received.filter((m) => m.type === "activity").length === 4);
    const steps = c.received.flatMap((m) => (m.type === "activity" ? [m.line.step ?? null] : []));
    expect(steps).toEqual([null, "develop", null, null]);
  });

  it("sends no activity field in welcome while the buffer is empty", async () => {
    const { link } = scriptedEngine();
    const g = await boot(link);
    const c = connect(g.port);
    await c.waitFor(() => c.received.some((m) => m.type === "welcome"));
    const welcome = c.received.find((m) => m.type === "welcome");
    expect(welcome && "activity" in welcome).toBe(false);
  });

  it("puts at most the last 50 lines in welcome, newest last", async () => {
    const { link, queue, activity } = scriptedEngine();
    const g = await boot(link);
    const first = connect(g.port);
    await first.waitFor(() => first.received.some((m) => m.type === "welcome"));
    const total = ACTIVITY_BUFFER_SIZE + 10;
    for (let i = 0; i < total; i++) queue.push(activity(i));
    await first.waitFor(() => first.received.filter((m) => m.type === "activity").length === total);

    const second = connect(g.port);
    await second.waitFor(() => second.received.some((m) => m.type === "welcome"));
    const welcome = second.received.find((m) => m.type === "welcome");
    if (welcome?.type !== "welcome") throw new Error("unreachable");
    expect(welcome.activity).toHaveLength(ACTIVITY_BUFFER_SIZE);
    expect(welcome.activity?.map((l) => l.text)).toEqual(
      Array.from({ length: ACTIVITY_BUFFER_SIZE }, (_, i) => `line ${i + 10}`),
    );
    const times = welcome.activity?.map((l) => l.ts) ?? [];
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });
});
