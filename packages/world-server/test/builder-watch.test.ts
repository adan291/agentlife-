import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { ServerMsgSchema } from "@agentlife/shared";
import type { AgentEvent, AgentState, ScopedAgentId, ServerMsg } from "@agentlife/shared";
import { BUILDER_STALE_MS, BuilderWatch } from "../src/builder-watch.ts";
import { EventQueue } from "../src/engine-link.ts";
import type { EngineLink } from "../src/engine-link.ts";
import { startGateway } from "../src/gateway.ts";
import type { Gateway } from "../src/gateway.ts";
import { testHotel } from "./helpers.ts";

const state = (agentId: string, s: AgentState, ts: number): AgentEvent => ({ type: "agent.state_changed", seq: 0, ts, taskId: "t", agentId: agentId as ScopedAgentId, state: s });
const say = (agentId: string, ts: number): AgentEvent => ({ type: "agent.say", seq: 0, ts, taskId: "t", agentId: agentId as ScopedAgentId, text: "hi" });

describe("BuilderWatch", () => {
  it("is 10 minutes by default", () => {
    expect(BUILDER_STALE_MS).toBe(10 * 60_000);
  });

  it("says nothing while the Builder has never been busy", () => {
    const w = new BuilderWatch();
    expect(w.expired(10 * BUILDER_STALE_MS)).toBe(false);
  });

  it("expires once a busy Builder has been silent for the stale time, and not before", () => {
    const w = new BuilderWatch();
    w.observe(state("builder", "thinking", 1000));
    expect(w.expired(1000 + BUILDER_STALE_MS - 1)).toBe(false);
    expect(w.expired(1000 + BUILDER_STALE_MS)).toBe(true);
    // Once: the Builder counts as idle until its next busy state.
    expect(w.expired(1000 + 5 * BUILDER_STALE_MS)).toBe(false);
  });

  it("is kept alive by any event of the Builder, also a line of speech or a walk", () => {
    const w = new BuilderWatch();
    w.observe(state("builder", "working", 0));
    w.observe(say("builder", BUILDER_STALE_MS - 1000));
    expect(w.expired(BUILDER_STALE_MS + 1)).toBe(false);
    expect(w.expired(2 * BUILDER_STALE_MS - 1000)).toBe(true);
  });

  it("does not expire after the Builder went idle by itself", () => {
    const w = new BuilderWatch();
    w.observe(state("builder", "thinking", 0));
    w.observe(state("builder", "idle", 5000));
    expect(w.expired(100 * BUILDER_STALE_MS)).toBe(false);
  });

  it("ignores the other agents, also with a project in their id", () => {
    const w = new BuilderWatch();
    w.observe(state("alpha:developer", "working", 0));
    w.observe(state("developer", "working", 0));
    expect(w.expired(100 * BUILDER_STALE_MS)).toBe(false);
  });

  it("treats a replayed event that is hours old as stale at once, and a busy state after it as new", () => {
    const w = new BuilderWatch();
    const now = 10 * 3_600_000;
    w.observe(state("builder", "thinking", now - 3 * 3_600_000));
    expect(w.expired(now)).toBe(true);
    w.observe(state("builder", "working", now));
    expect(w.expired(now + 1000)).toBe(false);
    expect(w.expired(now + BUILDER_STALE_MS)).toBe(true);
  });

  it("uses the time given to the constructor", () => {
    const w = new BuilderWatch(50);
    w.observe(state("builder", "thinking", 100));
    expect(w.expired(149)).toBe(false);
    expect(w.expired(150)).toBe(true);
  });
});

const gateways: Gateway[] = [];
const sockets: WebSocket[] = [];
afterEach(async () => {
  for (const s of sockets.splice(0)) s.terminate();
  for (const g of gateways.splice(0)) await g.close();
});

async function connect(port: number) {
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
        setTimeout(r, left);
      });
    }
  };
  await waitFor(() => received.some((m) => m.type === "welcome"));
  return { received, waitFor };
}

const builderStates = (r: ServerMsg[]) => r.flatMap((m) => (m.type === "agent_state" && m.agentId === "builder" ? [m.state] : []));

describe("the Builder through the gateway", () => {
  function setup() {
    const queue = new EventQueue<AgentEvent>();
    const link: EngineLink = {
      listRepos: () => Promise.resolve([]),
      listProjects: () => Promise.resolve([]),
      startJob: () => Promise.reject(new Error("not used")),
      resolveApproval: () => Promise.resolve(),
      getJob: () => Promise.reject(new Error("not used")),
      events: () => queue,
      close: () => queue.close(),
    };
    let seq = 0;
    const push = (s: AgentState, ts = Date.now()) => queue.push({ ...state("builder", s, ts), seq: seq++ });
    return { link, push };
  }

  it("goes back to idle after the stale time without an event, for the user in the lobby and for a later welcome", async () => {
    const { link, push } = setup();
    const gateway = await startGateway({ hotel: testHotel(), engine: link, port: 0, tickMs: 5, nightPollMs: 60_000, builder: { staleMs: 150, pollMs: 20 } });
    gateways.push(gateway);
    const c = await connect(gateway.port);
    push("thinking");
    await c.waitFor(() => builderStates(c.received).includes("thinking"));
    await c.waitFor(() => builderStates(c.received).at(-1) === "idle", 4000);
    expect(builderStates(c.received)).toEqual(["thinking", "idle"]);

    // A new connection (a reload) sees the Builder idle in its welcome.
    const again = await connect(gateway.port);
    const welcome = again.received.find((m) => m.type === "welcome");
    expect(welcome?.type === "welcome" ? welcome.agents.find((a) => a.agentId === "builder")?.state : undefined).toBe("idle");
  });

  it("keeps a busy Builder that goes on reporting", async () => {
    const { link, push } = setup();
    const gateway = await startGateway({ hotel: testHotel(), engine: link, port: 0, tickMs: 5, nightPollMs: 60_000, builder: { staleMs: 300, pollMs: 20 } });
    gateways.push(gateway);
    const c = await connect(gateway.port);
    for (let i = 0; i < 6; i++) {
      push(i % 2 === 0 ? "thinking" : "working");
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(builderStates(c.received)).not.toContain("idle");
  });

  it("an event from hours ago (the replay after a restart) does not leave the Builder busy", async () => {
    const { link, push } = setup();
    const gateway = await startGateway({ hotel: testHotel(), engine: link, port: 0, tickMs: 5, nightPollMs: 60_000, builder: { pollMs: 20 } });
    gateways.push(gateway);
    const c = await connect(gateway.port);
    push("thinking", Date.now() - 3 * 3_600_000);
    await c.waitFor(() => builderStates(c.received).at(-1) === "idle", 4000);
  });
});
