import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { BUG_COPY_GROUPS_MAX, ClientMsgSchema, ServerMsgSchema } from "@agentlife/shared";
import type { ClientMsg, ServerMsg } from "@agentlife/shared";
import { bugFiles } from "@agentlife/shared/bugs-node";
import { BugStore } from "../src/bug-store.ts";
import { startGateway } from "../src/gateway.ts";
import type { Gateway, GatewayOptions } from "../src/gateway.ts";
import { testHotel } from "./helpers.ts";

// Task 2 of the bug-sack spec on the server side: the news the client gets, the screenshot upload, the screenshot back and
// the text of Copy for Kiro.

let dir: string;
const gateways: Gateway[] = [];
const sockets: WebSocket[] = [];
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "agentlife-bug-sack-"));
});
afterEach(async () => {
  for (const s of sockets.splice(0)) s.terminate();
  for (const g of gateways.splice(0)) await g.close();
  rmSync(dir, { recursive: true, force: true });
});

const mask = { secrets: [] as string[], repoRoot: "D:\\Kiroween", projectRoots: ["D:\\AgentHotel"], home: "C:\\Users\\someone" };
const files = () => bugFiles({ AGENTLIFE_BUGS_FILE: join(dir, "bugs.jsonl") });
const makeStore = () => new BugStore({ files: files(), debounceMs: 0, mask });

/** A tiny PNG-shaped blob: the signature and some bytes. The store only looks at the signature and the size. */
const png = (extra = 200): Buffer => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(extra, 7)]);

async function connect(opts: Partial<GatewayOptions> = {}) {
  const hotel = testHotel({ start: "lobby", projects: ["alpha"] });
  const gateway = await startGateway({ hotel, port: 0, tickMs: 5, ...opts });
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
  const ask = async <T extends ServerMsg["type"]>(msg: ClientMsg | Record<string, unknown>, type: T): Promise<Extract<ServerMsg, { type: T }>> => {
    const before = received.length;
    send(msg);
    await waitFor(() => received.slice(before).some((m) => m.type === type || (m.type === "error" && m.code === "bug_error")));
    const hit = received.slice(before).find((m) => m.type === type);
    if (!hit) throw new Error(`got ${JSON.stringify(received.slice(before))}`);
    return hit as Extract<ServerMsg, { type: T }>;
  };
  const bugErrors = () => received.flatMap((m) => (m.type === "error" && m.code === "bug_error" ? [m.message] : []));
  /** Uploads `bytes` in pieces of `size` base64 characters (a multiple of 4). */
  const upload = (id: string, bytes: Buffer, size = 40) => {
    const b64 = bytes.toString("base64");
    const pieces: string[] = [];
    for (let i = 0; i < b64.length; i += size) pieces.push(b64.slice(i, i + size));
    pieces.forEach((data, seq) => send({ type: "bug_upload", id, seq, last: seq === pieces.length - 1, data }));
    return b64;
  };
  return { received, waitFor, send, ask, bugErrors, upload, hotel };
}

describe("bug_news", () => {
  it("tells the client the Bug sack exists and how many groups are open, as soon as it connects", async () => {
    const store = makeStore();
    store.record({ component: "code", process: "agent-engine", kind: "docker", message: "docker is gone" });
    const c = await connect({ bugs: store });
    await c.waitFor(() => c.received.some((m) => m.type === "bug_news"));
    expect(c.received.find((m) => m.type === "bug_news")).toEqual({ type: "bug_news", open: { game: 0, code: 1 }, change: "state" });
  });

  it("sends nothing when the server has no Bug sack", async () => {
    const c = await connect();
    await new Promise((r) => setTimeout(r, 50));
    expect(c.received.some((m) => m.type === "bug_news")).toBe(false);
  });

  it("says what changed: a new group, a repeat, a status change, and a fixed group that came back", async () => {
    const store = makeStore();
    const c = await connect({ bugs: store });
    const news = () => c.received.flatMap((m) => (m.type === "bug_news" && m.change !== "state" ? [m] : []));
    // A bug of the code side, recorded by the server itself (a process that is not the browser).
    store.recordError("handler", new Error("first failure 1"));
    await c.waitFor(() => news().length === 1);
    expect(news()[0]).toMatchObject({ change: "new", open: { game: 0, code: 1 } });
    const id = news()[0]!.id!;
    store.recordError("handler", new Error("first failure 2"));
    await c.waitFor(() => news().length === 2);
    expect(news()[1]).toMatchObject({ change: "repeat", id, open: { game: 0, code: 1 } });
    store.setStatus(id, "fixed");
    await c.waitFor(() => news().length === 3);
    expect(news()[2]).toMatchObject({ change: "status", open: { game: 0, code: 0 } });
    store.recordError("handler", new Error("first failure 3"));
    await c.waitFor(() => news().length === 4);
    expect(news()[3]).toMatchObject({ change: "reopened", open: { game: 0, code: 1 } });
  });
});

describe("the screenshot of a report", () => {
  it("keeps a screenshot that was uploaded in pieces before the report, and sends it back on request", async () => {
    const store = makeStore();
    const c = await connect({ bugs: store });
    const bytes = png(300);
    const b64 = c.upload("shot000001", bytes);
    const saved = await c.ask({ type: "bug_report", kind: "manual", message: "the jar is empty", note: "see the picture", upload: "shot000001" }, "bug_saved");
    expect(c.bugErrors()).toEqual([]);
    const group = store.get(saved.id)!;
    const sample = group.samples[0]!;
    expect(sample.shot).toBe(true);
    expect(existsSync(store.screenshotPath(sample.id))).toBe(true);
    const detail = await c.ask({ type: "bug_get", id: saved.id }, "bug_detail");
    expect(detail.group.samples[0]?.shot).toBe(true);
    const shot = await c.ask({ type: "bug_shot_get", sample: sample.id }, "bug_shot");
    expect(shot).toMatchObject({ sample: sample.id, png: b64 });
    expect((await c.ask({ type: "bugs_state" }, "bugs")).groups[0]?.shots).toBe(1);
  });

  it("keeps the report without a picture when the upload is not there, and uses an upload only once", async () => {
    const store = makeStore();
    const c = await connect({ bugs: store });
    const saved = await c.ask({ type: "bug_report", kind: "manual", message: "no picture came", upload: "neverseen01" }, "bug_saved");
    expect(store.get(saved.id)?.samples[0]?.shot).toBe(false);
    c.send({ type: "bug_upload", id: "shot000002", seq: 0, last: true, data: png(20).toString("base64") });
    const first = await c.ask({ type: "bug_report", kind: "manual", message: "with a picture", upload: "shot000002" }, "bug_saved");
    expect(store.get(first.id)?.samples[0]?.shot).toBe(true);
    const second = await c.ask({ type: "bug_report", kind: "manual", message: "reusing it", upload: "shot000002" }, "bug_saved");
    expect(store.get(second.id)?.samples[0]?.shot).toBe(false);
  });

  it("drops an upload that is out of order, and keeps nothing for a report that names it", async () => {
    const store = makeStore();
    const c = await connect({ bugs: store });
    c.send({ type: "bug_upload", id: "shot000003", seq: 0, last: false, data: "AAAA" });
    c.send({ type: "bug_upload", id: "shot000003", seq: 2, last: true, data: "AAAA" });
    await c.waitFor(() => c.bugErrors().length === 1);
    expect(c.bugErrors()[0]).toContain("out of order");
    const saved = await c.ask({ type: "bug_report", kind: "manual", message: "after a broken upload", upload: "shot000003" }, "bug_saved");
    expect(store.get(saved.id)?.samples[0]?.shot).toBe(false);
  });

  it("refuses a piece that is not base64", async () => {
    const c = await connect({ bugs: makeStore() });
    c.send({ type: "bug_upload", id: "shot000004", seq: 0, last: true, data: "not base64!" });
    await c.waitFor(() => c.bugErrors().length === 1);
    expect(c.bugErrors()[0]).toContain("not valid");
  });

  it("keeps the report but not the picture when the bytes are not a PNG", async () => {
    const store = makeStore();
    const c = await connect({ bugs: store });
    c.send({ type: "bug_upload", id: "shot000006", seq: 0, last: true, data: Buffer.from("this is text, not a picture").toString("base64") });
    const saved = await c.ask({ type: "bug_report", kind: "manual", message: "a text pretending", upload: "shot000006" }, "bug_saved");
    expect(store.get(saved.id)?.samples[0]?.shot).toBe(false);
  });

  it("answers bug_error for a screenshot that is not kept, or a sample with none", async () => {
    const store = makeStore();
    const c = await connect({ bugs: store });
    const saved = await c.ask({ type: "bug_report", kind: "manual", message: "no picture" }, "bug_saved");
    const sample = store.get(saved.id)!.samples[0]!.id;
    c.send({ type: "bug_shot_get", sample });
    c.send({ type: "bug_shot_get", sample: "bnotthere" });
    await c.waitFor(() => c.bugErrors().length === 2);
    expect(new Set(c.bugErrors())).toEqual(new Set(["That screenshot is not kept any more."]));
  });

  it("refuses an upload id or a sample id that is not the right shape (no path can come through)", () => {
    expect(ClientMsgSchema.safeParse({ type: "bug_upload", id: "../../x", seq: 0, last: true, data: "AAAA" }).success).toBe(false);
    expect(ClientMsgSchema.safeParse({ type: "bug_shot_get", sample: "..\\..\\secret" }).success).toBe(false);
    expect(ClientMsgSchema.safeParse({ type: "bug_shot_get", sample: "b1/../x" }).success).toBe(false);
  });
});

describe("bug_copy", () => {
  it("sends the Markdown of one group", async () => {
    const store = makeStore();
    const c = await connect({ bugs: store });
    const saved = await c.ask({ type: "bug_report", kind: "uncaught", message: "Cannot read x", stack: "TypeError: Cannot read x\n    at draw (http://localhost/a.js:1:2)", note: "after buying a fern" }, "bug_saved");
    const text = await c.ask({ type: "bug_copy", id: saved.id }, "bug_text");
    expect(text.count).toBe(1);
    expect(text.text).toContain("Cannot read x");
    expect(text.text).toContain("after buying a fern");
    expect(text.text).toContain(saved.id);
  });

  it("sends the open groups of one component, newest first, and leaves out the fixed ones", async () => {
    const store = makeStore();
    const c = await connect({ bugs: store });
    const a = await c.ask({ type: "bug_report", kind: "uncaught", message: "alpha failure" }, "bug_saved");
    await c.ask({ type: "bug_report", kind: "uncaught", message: "beta failure" }, "bug_saved");
    await c.ask({ type: "bug_report", kind: "uncaught", message: "gamma failure" }, "bug_saved");
    store.setStatus(a.id, "fixed");
    store.recordError("handler", new Error("a code failure"));
    const text = await c.ask({ type: "bug_copy", component: "game" }, "bug_text");
    expect(text.count).toBe(2);
    expect(text.text).not.toContain("alpha failure");
    expect(text.text).not.toContain("a code failure");
    expect(text.text.indexOf("gamma failure")).toBeLessThan(text.text.indexOf("beta failure"));
    expect((await c.ask({ type: "bug_copy", component: "code" }, "bug_text")).count).toBe(1);
  });

  it("puts at most 25 groups in one text and says so", async () => {
    const store = makeStore();
    for (let i = 0; i < BUG_COPY_GROUPS_MAX + 5; i++) store.record({ component: "game", process: "client", kind: "console-error", message: `distinct failure ${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}` });
    const c = await connect({ bugs: store });
    const text = await c.ask({ type: "bug_copy", component: "game" }, "bug_text");
    expect(text.count).toBe(BUG_COPY_GROUPS_MAX);
    expect(text.text).toContain(`newest ${BUG_COPY_GROUPS_MAX} of ${BUG_COPY_GROUPS_MAX + 5}`);
  });

  it("refuses an unknown group, a message that names both or none, and answers bug_error with no Bug sack", async () => {
    const c = await connect({ bugs: makeStore() });
    c.send({ type: "bug_copy", id: "ffffffffffffffff" });
    await c.waitFor(() => c.bugErrors().includes("No such bug."));
    c.send({ type: "bug_copy", id: "ffffffffffffffff", component: "game" });
    c.send({ type: "bug_copy" });
    await c.waitFor(() => c.received.filter((m) => m.type === "error" && m.code === "bad_message").length === 2);
    const off = await connect();
    off.send({ type: "bug_copy", component: "game" });
    off.send({ type: "bug_shot_get", sample: "babc" });
    off.send({ type: "bug_upload", id: "shot000009", seq: 0, last: true, data: "AAAA" });
    await off.waitFor(() => off.bugErrors().length === 3);
  });
});

describe("the Bug sack panel from the jar", () => {
  it("sends the list before the panel opens when the user uses the bug jar", async () => {
    const store = makeStore();
    store.record({ component: "code", process: "agent-engine", kind: "docker", message: "docker is gone" });
    const c = await connect({ bugs: store });
    c.send({ type: "use", itemId: "bug_jar_1" });
    await c.waitFor(() => c.received.some((m) => m.type === "open_panel" && m.panel === "bugs"), 5000);
    const open = c.received.findIndex((m) => m.type === "open_panel" && m.panel === "bugs");
    const list = c.received.findIndex((m) => m.type === "bugs");
    expect(list).toBeGreaterThanOrEqual(0);
    expect(list).toBeLessThan(open);
    expect(c.received[list]).toMatchObject({ open: { game: 0, code: 1 } });
  });

  it("opens the panel on a server with no Bug sack and answers bug_error, so the panel can say so", async () => {
    const c = await connect();
    c.send({ type: "use", itemId: "bug_jar_1" });
    await c.waitFor(() => c.received.some((m) => m.type === "open_panel" && m.panel === "bugs"), 5000);
    expect(c.bugErrors()).toEqual(["The Bug sack is off on this server."]);
  });
});
