import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AgentEventSchema, type AgentEvent } from "@agentlife/shared";
import { startEngine, type Engine } from "../src/engine.ts";

const engines: Engine[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const e of engines.splice(0)) await e.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function boot(heartbeatMs?: number): Promise<{ engine: Engine; url: string }> {
  const dir = mkdtempSync(path.join(os.tmpdir(), "agentlife-sse-"));
  dirs.push(dir);
  const engine = await startEngine({
    storeOptions: { dbPath: ":memory:", runsDir: dir },
    port: 0,
    ...(heartbeatMs === undefined ? {} : { heartbeatMs }),
  });
  engines.push(engine);
  return { engine, url: `http://127.0.0.1:${engine.port}` };
}

interface SseMessage {
  id: number;
  event: string;
  data: AgentEvent;
}

/** Reads SSE messages until `count` arrived (or `rawUntil` matches the raw text), then disconnects. */
async function readSse(
  url: string,
  opts: { count?: number; headers?: Record<string, string>; rawUntil?: RegExp; timeoutMs?: number } = {},
): Promise<{ messages: SseMessage[]; raw: string }> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), opts.timeoutMs ?? 3000);
  const res = await fetch(url, { headers: opts.headers ?? {}, signal: ac.signal });
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/event-stream");
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let raw = "";
  const messages: SseMessage[] = [];
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      raw += dec.decode(value, { stream: true });
      let idx: number;
      let rest = raw;
      messages.length = 0;
      while ((idx = rest.indexOf("\n\n")) >= 0) {
        const block = rest.slice(0, idx);
        rest = rest.slice(idx + 2);
        if (block.startsWith(":")) continue;
        const f: Record<string, string> = {};
        for (const line of block.split("\n")) {
          const i = line.indexOf(": ");
          f[line.slice(0, i)] = line.slice(i + 2);
        }
        messages.push({ id: Number(f["id"]), event: f["event"]!, data: AgentEventSchema.parse(JSON.parse(f["data"]!)) });
      }
      if (opts.count !== undefined && messages.length >= opts.count) break;
      if (opts.rawUntil && opts.rawUntil.test(raw)) break;
    }
  } finally {
    clearTimeout(timer);
    await reader.cancel().catch(() => {});
  }
  if (opts.count !== undefined) messages.splice(opts.count);
  return { messages, raw };
}

let n = 0;
function add(engine: Engine, taskId = "t1"): AgentEvent {
  return engine.store.appendEvent({ type: "agent.say", taskId, agentId: "architect", text: `line ${++n}` });
}

describe("GET /events", () => {
  it("replays stored events then streams live ones, with id/event/data fields", async () => {
    const { engine, url } = await boot();
    for (let i = 0; i < 3; i++) add(engine);
    const pending = readSse(`${url}/events`, { count: 5 });
    await new Promise((r) => setTimeout(r, 50));
    add(engine);
    add(engine);
    const { messages } = await pending;
    expect(messages.map((m) => m.id)).toEqual([1, 2, 3, 4, 5]);
    expect(messages.every((m) => m.event === "agent" && m.data.seq === m.id)).toBe(true);
  });

  it("honours since= and Last-Event-ID", async () => {
    const { engine, url } = await boot();
    for (let i = 0; i < 5; i++) add(engine);
    const a = await readSse(`${url}/events?since=3`, { count: 2 });
    expect(a.messages.map((m) => m.id)).toEqual([4, 5]);
    const b = await readSse(`${url}/events`, { count: 1, headers: { "last-event-id": "4" } });
    expect(b.messages.map((m) => m.id)).toEqual([5]);
  });

  it("requirement 2.2: events appended while the client is away arrive after reconnect, in order", async () => {
    const { engine, url } = await boot();
    for (let i = 0; i < 4; i++) add(engine);

    const firstPending = readSse(`${url}/events`, { count: 6 });
    await new Promise((r) => setTimeout(r, 50));
    add(engine);
    add(engine);
    const first = await firstPending; // client disconnects after seq 6
    const seen = first.messages.map((m) => m.id);
    expect(seen).toEqual([1, 2, 3, 4, 5, 6]);

    for (let i = 0; i < 4; i++) add(engine); // 7..10 while disconnected
    const secondPending = readSse(`${url}/events`, { count: 6, headers: { "last-event-id": String(seen.at(-1)) } });
    await new Promise((r) => setTimeout(r, 50));
    add(engine); // 11, 12 live after reconnect
    add(engine);
    const second = await secondPending;
    const all = [...seen, ...second.messages.map((m) => m.id)];
    expect(all).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(new Set(all).size).toBe(all.length);
  });

  it("keeps order when events are appended continuously during connect", async () => {
    const { engine, url } = await boot();
    for (let i = 0; i < 20; i++) add(engine);
    let stop = false;
    const writer = (async () => {
      while (!stop) {
        add(engine);
        await new Promise((r) => setImmediate(r));
      }
    })();
    const { messages } = await readSse(`${url}/events`, { count: 60 });
    stop = true;
    await writer;
    const ids = messages.map((m) => m.id);
    expect(ids).toEqual(Array.from({ length: ids.length }, (_, i) => i + 1));
  });

  it("sends heartbeat comments", async () => {
    const { url } = await boot(20);
    const { raw } = await readSse(`${url}/events`, { rawUntil: /: hb\n\n/ });
    expect(raw).toContain(": hb");
  });

  it("rejects a bad since value with 400", async () => {
    const { url } = await boot();
    const res = await fetch(`${url}/events?since=abc`);
    expect(res.status).toBe(400);
  });
});
