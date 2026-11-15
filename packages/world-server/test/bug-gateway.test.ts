import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { BUG_RATE_PER_MINUTE, BUG_REPORT_BYTES, ServerMsgSchema } from "@agentlife/shared";
import type { ClientMsg, ServerMsg } from "@agentlife/shared";
import { bugFiles } from "@agentlife/shared/bugs-node";
import { BugStore } from "../src/bug-store.ts";
import { SlidingWindow, startGateway } from "../src/gateway.ts";
import type { Gateway, GatewayOptions } from "../src/gateway.ts";
import { testHotel } from "./helpers.ts";

let dir: string;
const gateways: Gateway[] = [];
const sockets: WebSocket[] = [];
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "agentlife-bug-gw-"));
});
afterEach(async () => {
  for (const s of sockets.splice(0)) s.terminate();
  for (const g of gateways.splice(0)) await g.close();
  rmSync(dir, { recursive: true, force: true });
});

const mask = { secrets: [] as string[], repoRoot: "D:\\Kiroween", projectRoots: ["D:\\AgentHotel"], home: "C:\\Users\\someone" };
const makeStore = () => new BugStore({ files: bugFiles({ AGENTLIFE_BUGS_FILE: join(dir, "bugs.jsonl") }), debounceMs: 0, mask });

async function connect(opts: Partial<GatewayOptions> & { start?: "lobby" | "project:alpha" } = {}) {
  const { start = "lobby", ...rest } = opts;
  const hotel = testHotel({ start, projects: ["alpha"] });
  const gateway = await startGateway({ hotel, port: 0, tickMs: 5, ...rest });
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
  /** Sends and waits for the next message of `type` after it. */
  const ask = async <T extends ServerMsg["type"]>(msg: ClientMsg | Record<string, unknown>, type: T): Promise<Extract<ServerMsg, { type: T }>> => {
    const before = received.length;
    send(msg);
    await waitFor(() => received.slice(before).some((m) => m.type === type || (m.type === "error" && m.code === "bug_error")));
    const hit = received.slice(before).find((m) => m.type === type);
    if (!hit) throw new Error(`got ${JSON.stringify(received.slice(before))}`);
    return hit as Extract<ServerMsg, { type: T }>;
  };
  const bugErrors = () => received.flatMap((m) => (m.type === "error" && m.code === "bug_error" ? [m.message] : []));
  return { received, waitFor, send, ask, bugErrors, hotel };
}

describe("bug_report", () => {
  it("keeps the report as a game bug from the client, whatever the message claims", async () => {
    const store = makeStore();
    const c = await connect({ bugs: store, start: "project:alpha" });
    const saved = await c.ask({ type: "bug_report", kind: "uncaught", message: "Cannot read x at tile 4,5", stack: "TypeError\n    at draw (http://localhost:5173/src/a.ts:1:2)", panel: "shop", view: "hotel", clientTime: 99, component: "code", process: "agent-engine" }, "bug_saved");
    expect(saved.count).toBe(1);
    const group = store.get(saved.id)!;
    expect(group).toMatchObject({ component: "game", process: "client", kind: "uncaught", status: "open", last: { floor: "project:alpha", panel: "shop", view: "hotel" } });
    expect(group.samples[0]).toMatchObject({ clientTime: 99, message: "Cannot read x at tile 4,5" });
    const again = await c.ask({ type: "bug_report", kind: "uncaught", message: "Cannot read x at tile 8,9", stack: "TypeError\n    at draw (http://localhost:5173/src/a.ts:7:7)" }, "bug_saved");
    expect(again).toMatchObject({ id: saved.id, count: 2 });
  });

  it("keeps a floor the message names, and masks what a client sends", async () => {
    const store = makeStore();
    const c = await connect({ bugs: store });
    const token = `ghp_${"a1B2".repeat(10)}`;
    const saved = await c.ask({ type: "bug_report", kind: "manual", message: `froze with ${token}`, note: "D:\\Kiroween\\x.ts", floor: "lobby" }, "bug_saved");
    const text = JSON.stringify(store.get(saved.id));
    expect(text).not.toContain(token);
    expect(text).toContain("[github-token]");
    expect(text).not.toContain("D:\\\\Kiroween");
    expect(store.get(saved.id)?.last.floor).toBe("lobby");
  });

  it("refuses a kind that only the server's own processes use, and an invalid message", async () => {
    const c = await connect({ bugs: makeStore() });
    c.send({ type: "bug_report", kind: "step-error", message: "x" });
    c.send({ type: "bug_report", kind: "manual", message: "" });
    await c.waitFor(() => c.received.filter((m) => m.type === "error" && m.code === "bad_message").length === 2);
  });

  it("refuses a report over 8 KB", async () => {
    const store = makeStore();
    const c = await connect({ bugs: store });
    c.send({ type: "bug_report", kind: "uncaught", message: "é".repeat(1000), stack: "é".repeat(4000) });
    await c.waitFor(() => c.bugErrors().length === 1);
    expect(c.bugErrors()[0]).toContain("too big");
    expect(store.list()).toEqual([]);
    expect(BUG_REPORT_BYTES).toBe(8192);
  });

  it("allows 20 reports a minute and then stores nothing until the minute is over", async () => {
    const store = makeStore();
    let now = 1_000_000;
    const c = await connect({ bugs: store, clock: () => now });
    for (let i = 0; i < BUG_RATE_PER_MINUTE; i++) {
      now += 100;
      await c.ask({ type: "bug_report", kind: "console-error", message: `error number ${String.fromCharCode(97 + i)}` }, "bug_saved");
    }
    expect(store.list()).toHaveLength(BUG_RATE_PER_MINUTE);
    now += 100;
    c.send({ type: "bug_report", kind: "console-error", message: "one too many" });
    await c.waitFor(() => c.bugErrors().length === 1);
    expect(c.bugErrors()[0]).toContain("Too many");
    expect(store.list()).toHaveLength(BUG_RATE_PER_MINUTE);
    now += 60_000;
    const saved = await c.ask({ type: "bug_report", kind: "console-error", message: "after the minute" }, "bug_saved");
    expect(store.get(saved.id)).toBeDefined();
  });

  it("answers bug_error when the server has no Bug sack", async () => {
    const c = await connect();
    c.send({ type: "bug_report", kind: "manual", message: "x" });
    c.send({ type: "bugs_state" });
    c.send({ type: "bug_get", id: "0123456789abcdef" });
    c.send({ type: "bug_status", id: "0123456789abcdef", status: "fixed" });
    await c.waitFor(() => c.bugErrors().length === 4);
    expect(new Set(c.bugErrors())).toEqual(new Set(["The Bug sack is off on this server."]));
  });
});

describe("the list, the details and the status", () => {
  it("lists groups without samples and counts the open ones per component", async () => {
    const store = makeStore();
    store.record({ component: "code", process: "agent-engine", kind: "docker", message: "docker is gone" });
    const c = await connect({ bugs: store });
    await c.ask({ type: "bug_report", kind: "pixi", message: "texture failed" }, "bug_saved");
    const list = await c.ask({ type: "bugs_state" }, "bugs");
    expect(list.open).toEqual({ game: 1, code: 1 });
    expect(list.groups).toHaveLength(2);
    expect(list.groups[0]).toMatchObject({ kind: "pixi", shots: 0 });
    expect("samples" in list.groups[0]!).toBe(false);
  });

  it("sends one group with its samples, or an error for an unknown id", async () => {
    const store = makeStore();
    const c = await connect({ bugs: store });
    const saved = await c.ask({ type: "bug_report", kind: "manual", message: "it froze", note: "by hand" }, "bug_saved");
    const detail = await c.ask({ type: "bug_get", id: saved.id }, "bug_detail");
    expect(detail.group.samples[0]).toMatchObject({ note: "by hand", shot: false });
    c.send({ type: "bug_get", id: "ffffffffffffffff" });
    await c.waitFor(() => c.bugErrors().includes("No such bug."));
  });

  it("marks a group fixed, and the same error reopens it", async () => {
    const store = makeStore();
    const c = await connect({ bugs: store });
    const saved = await c.ask({ type: "bug_report", kind: "uncaught", message: "boom 1" }, "bug_saved");
    const fixed = await c.ask({ type: "bug_status", id: saved.id, status: "fixed" }, "bugs");
    expect(fixed.open).toEqual({ game: 0, code: 0 });
    expect(fixed.groups[0]).toMatchObject({ status: "fixed" });
    await c.ask({ type: "bug_report", kind: "uncaught", message: "boom 2" }, "bug_saved");
    const list = await c.ask({ type: "bugs_state" }, "bugs");
    expect(list.groups[0]).toMatchObject({ status: "open", reopened: 1, count: 2 });
    const ignored = await c.ask({ type: "bug_status", id: saved.id, status: "ignored" }, "bugs");
    expect(ignored.open.game).toBe(0);
    c.send({ type: "bug_status", id: "ffffffffffffffff", status: "fixed" });
    await c.waitFor(() => c.bugErrors().includes("No such bug."));
  });
});

describe("errors inside the gateway", () => {
  it("records an error that the send queue swallows, and carries on", async () => {
    const recordError = vi.fn();
    const store = makeStore();
    store.recordError = recordError;
    const c = await connect({ bugs: store });
    // A simulation message that breaks the protocol: `send` throws inside the queued task.
    const sim = c.hotel.sim("lobby")!;
    sim.handleIntent = () => [{ type: "say", id: 1, text: "" }];
    c.send({ type: "move", x: 1, y: 1 });
    await vi.waitFor(() => expect(recordError).toHaveBeenCalledTimes(1));
    expect(recordError.mock.calls[0]?.[0]).toBe("handler");
    // The queue still works afterwards.
    sim.handleIntent = () => [{ type: "say", id: 1, text: "still here" }];
    c.send({ type: "move", x: 2, y: 2 });
    await c.waitFor(() => c.received.some((m) => m.type === "say" && m.text === "still here"));
  });
});

describe("SlidingWindow", () => {
  it("lets `limit` events through in any window and forgets the old ones", () => {
    let now = 0;
    const w = new SlidingWindow(3, 1000, () => now);
    expect([w.take(), w.take(), w.take(), w.take()]).toEqual([true, true, true, false]);
    now = 999;
    expect(w.take()).toBe(false);
    now = 1000;
    expect(w.take()).toBe(true);
  });
});
