import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { ServerMsgSchema } from "@agentlife/shared";
import type { AgentEvent, ClientMsg, MemoryEntry, MemoryProposal, MemoryState, ServerMsg } from "@agentlife/shared";
import { EventQueue } from "../src/engine-link.ts";
import type { EngineLink, MemoryLink } from "../src/engine-link.ts";
import { startGateway } from "../src/gateway.ts";
import type { Gateway } from "../src/gateway.ts";
import { testHotel } from "./helpers.ts";

const gateways: Gateway[] = [];
const sockets: WebSocket[] = [];
afterEach(async () => {
  for (const s of sockets.splice(0)) s.terminate();
  for (const g of gateways.splice(0)) await g.close();
});

const entry = (n: number, text: string): MemoryEntry => ({ id: `mem-00000${n}`, kind: "convention", text, sourceTaskId: "task-1", createdAt: n });
const proposal = (n: number, text: string): MemoryProposal => ({ id: `prop-00000${n}`, kind: "pitfall", text, sourceTaskId: "task-2", createdAt: n });

/** An engine whose Library is a list in memory. `refuse` makes every change fail with that message. */
function engine(opts: { refuse?: string; withMemory?: boolean } = {}) {
  const queue = new EventQueue<AgentEvent>();
  const state: MemoryState = { entries: [entry(1, "Tests sit next to the module.")], proposals: [proposal(2, "Do not skip the empty title check.")], autoRemember: false, learning: [] };
  const calls: string[] = [];
  const change = (what: string, fn: () => void): Promise<void> => {
    calls.push(what);
    if (opts.refuse) return Promise.reject(new Error(opts.refuse));
    fn();
    return Promise.resolve();
  };
  const memory: MemoryLink = {
    state: (projectId) => {
      calls.push(`state:${projectId}`);
      return Promise.resolve(structuredClone(state));
    },
    edit: (p, id, patch) => change(`edit:${p}:${id}:${patch.kind ?? "-"}:${patch.text ?? "-"}`, () => {
      state.entries = state.entries.map((e) => (e.id === id ? { ...e, ...(patch.kind ? { kind: patch.kind } : {}), ...(patch.text ? { text: patch.text } : {}) } : e));
    }),
    remove: (p, id) => change(`remove:${p}:${id}`, () => {
      state.entries = state.entries.filter((e) => e.id !== id);
    }),
    accept: (p, id, edit) => change(`accept:${p}:${id}:${edit.text ?? "-"}`, () => {
      const found = state.proposals.find((x) => x.id === id);
      if (found) state.entries = [{ ...found, id: `mem-00000${state.entries.length + 5}`, text: edit.text ?? found.text }, ...state.entries];
      state.proposals = state.proposals.filter((x) => x.id !== id);
    }),
    dismiss: (p, id) => change(`dismiss:${p}:${id}`, () => {
      state.proposals = state.proposals.filter((x) => x.id !== id);
    }),
    setAutoRemember: (p, on) => change(`auto:${p}:${on}`, () => {
      state.autoRemember = on;
    }),
  };
  const link: EngineLink = {
    listRepos: () => Promise.resolve([]),
    listProjects: () => Promise.resolve([{ id: "alpha", name: "alpha", builtin: true, stack: "node-npm", testCommand: "npm test", registeredAt: 0 }]),
    startJob: () => Promise.reject(new Error("not used")),
    resolveApproval: () => Promise.resolve(),
    getJob: () => Promise.reject(new Error("not used")),
    ...(opts.withMemory === false ? {} : { memory }),
    events: () => queue,
    close: () => queue.close(),
  };
  return { link, calls, state };
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

const memories = (received: ServerMsg[]) => received.flatMap((m) => (m.type === "memory" ? [m] : []));
const errors = (received: ServerMsg[]) => received.flatMap((m) => (m.type === "error" ? [m] : []));

describe("the Library through the gateway", () => {
  it("sends the memory of the floor's project before it opens the library panel", async () => {
    const e = engine();
    const c = await connect(e.link);
    c.send({ type: "use", itemId: "library_shelf_1" });
    await c.waitFor(() => c.received.some((m) => m.type === "open_panel"));
    const types = c.received.map((m) => m.type);
    expect(types.indexOf("memory")).toBeGreaterThan(-1);
    expect(types.indexOf("memory")).toBeLessThan(types.indexOf("open_panel"));
    expect(memories(c.received)[0]).toMatchObject({ projectId: "alpha", state: { autoRemember: false } });
    expect(memories(c.received)[0]!.state.entries.map((x) => x.text)).toEqual(["Tests sit next to the module."]);
  });

  it("answers memory_state with the state of the user's own project", async () => {
    const e = engine();
    const c = await connect(e.link);
    c.send({ type: "memory_state" });
    await c.waitFor(() => memories(c.received).length === 1);
    expect(e.calls).toEqual(["state:alpha"]);
  });

  it("edits, deletes, accepts, dismisses and switches auto-remember, answering each time with the new state", async () => {
    const e = engine();
    const c = await connect(e.link);
    c.send({ type: "memory_do", act: { action: "edit", entryId: "mem-000001", text: "Tests sit beside the module.", kind: "decision" } });
    await c.waitFor(() => memories(c.received).some((m) => m.state.entries[0]?.text === "Tests sit beside the module."));
    c.send({ type: "memory_do", act: { action: "accept", proposalId: "prop-000002", text: "Never skip the empty title check." } });
    await c.waitFor(() => memories(c.received).some((m) => m.state.proposals.length === 0 && m.state.entries.length === 2));
    c.send({ type: "memory_do", act: { action: "auto", autoRemember: true } });
    await c.waitFor(() => memories(c.received).some((m) => m.state.autoRemember));
    c.send({ type: "memory_do", act: { action: "delete", entryId: "mem-000001" } });
    await c.waitFor(() => memories(c.received).some((m) => m.state.autoRemember && !m.state.entries.some((x) => x.id === "mem-000001")));
    c.send({ type: "memory_do", act: { action: "dismiss", proposalId: "prop-000009" } });
    await c.waitFor(() => e.calls.filter((x) => x === "state:alpha").length === 5);
    expect(e.calls).toEqual([
      "edit:alpha:mem-000001:decision:Tests sit beside the module.",
      "state:alpha",
      "accept:alpha:prop-000002:Never skip the empty title check.",
      "state:alpha",
      "auto:alpha:true",
      "state:alpha",
      "remove:alpha:mem-000001",
      "state:alpha",
      "dismiss:alpha:prop-000009",
      "state:alpha",
    ]);
    expect(errors(c.received)).toEqual([]);
  });

  it("shows the engine's refusal as memory_error and still sends the state", async () => {
    const e = engine({ refuse: "The text holds a file path, a token or a NAME=value setting. Write it without them." });
    const c = await connect(e.link);
    c.send({ type: "memory_do", act: { action: "edit", entryId: "mem-000001", text: "see the folder" } });
    await c.waitFor(() => errors(c.received).some((m) => m.code === "memory_error"));
    await c.waitFor(() => memories(c.received).length === 1);
    expect(errors(c.received)[0]!.message).toContain("file path");
  });

  it("refuses an action that is not well formed before the engine sees it", async () => {
    const e = engine();
    const c = await connect(e.link);
    c.send({ type: "memory_do", act: { action: "delete", entryId: "../../etc/passwd" } });
    c.send({ type: "memory_do", act: { action: "explode" } });
    await c.waitFor(() => errors(c.received).length === 2);
    expect(errors(c.received).map((m) => m.code)).toEqual(["bad_message", "bad_message"]);
    expect(e.calls).toEqual([]);
  });

  it("the Library is on a project's floor: in the lobby it answers an error and asks the engine nothing", async () => {
    const e = engine();
    const c = await connect(e.link, "lobby");
    c.send({ type: "memory_state" });
    c.send({ type: "memory_do", act: { action: "auto", autoRemember: true } });
    await c.waitFor(() => errors(c.received).length === 2);
    expect(errors(c.received).map((m) => m.code)).toEqual(["bad_message", "bad_message"]);
    expect(e.calls).toEqual([]);
  });

  it("an engine without a Library says so, and the mailbox opens without an error about it", async () => {
    const e = engine({ withMemory: false });
    const c = await connect(e.link);
    c.send({ type: "memory_state" });
    await c.waitFor(() => errors(c.received).some((m) => m.code === "engine_unavailable"));
    const before = errors(c.received).length;
    c.send({ type: "use", itemId: "mailbox_1" });
    await c.waitFor(() => c.received.some((m) => m.type === "open_panel" && m.panel === "mailbox"));
    expect(errors(c.received)).toHaveLength(before);
  });
});
