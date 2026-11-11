import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentEvent, RunExport } from "@agentlife/shared";
import { HttpEngineLink } from "../src/http-engine.ts";

function say(seq: number): AgentEvent {
  return { type: "agent.say", seq, ts: 1, taskId: "t1", agentId: "qa", text: `line ${seq}` };
}

/** A scripted stand-in for the agent-engine HTTP API. */
class MockEngine {
  events: AgentEvent[] = [];
  readonly clients = new Set<http.ServerResponse>();
  readonly seenTokens: (string | undefined)[] = [];
  readonly seenSince: number[] = [];
  exportBody: RunExport | undefined;
  startStatus = 201;
  private readonly server: http.Server;
  port = 0;

  constructor() {
    this.server = http.createServer((req, res) => {
      this.seenTokens.push(req.headers["x-agentlife-token"] as string | undefined);
      const url = new URL(req.url ?? "/", "http://x");
      const json = (status: number, body: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      if (url.pathname === "/health") return json(200, { ok: true, protocol: 1, lastSeq: this.events.at(-1)?.seq ?? 0 });
      if (url.pathname === "/repos") return json(200, [{ id: "haunted-todo", name: "haunted-todo" }]);
      if (url.pathname === "/tasks" && req.method === "POST") {
        if (this.startStatus === 409) return json(409, { error: "busy", message: "another job is still running" });
        return json(201, { taskId: "t1" });
      }
      if (url.pathname.startsWith("/approvals/")) return json(200, { ok: true });
      if (url.pathname === "/tasks/t1/export") return this.exportBody ? json(200, this.exportBody) : json(404, { error: "not_found" });
      if (url.pathname === "/events") {
        const since = Number(url.searchParams.get("since") ?? 0);
        this.seenSince.push(since);
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(": connected\n\n");
        for (const ev of this.events) if (ev.seq > since) this.write(res, ev);
        this.clients.add(res);
        res.on("close", () => this.clients.delete(res));
        return;
      }
      json(404, { error: "not_found" });
    });
  }

  private write(res: http.ServerResponse, ev: AgentEvent): void {
    res.write(`id: ${ev.seq}\nevent: agent\ndata: ${JSON.stringify(ev)}\n\n`);
  }

  async start(): Promise<void> {
    await new Promise<void>((r) => this.server.listen(0, "127.0.0.1", r));
    this.port = (this.server.address() as AddressInfo).port;
  }

  get url(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  push(...evs: AgentEvent[]): void {
    for (const ev of evs) {
      this.events.push(ev);
      for (const c of this.clients) this.write(c, ev);
    }
  }

  dropStreams(): void {
    for (const c of [...this.clients]) c.destroy();
    this.clients.clear();
  }

  async stop(): Promise<void> {
    this.dropStreams();
    this.server.closeAllConnections();
    await new Promise<void>((r) => this.server.close(() => r()));
  }
}

const mocks: MockEngine[] = [];
const links: HttpEngineLink[] = [];
async function setup(opts: { token?: string } = {}): Promise<{ mock: MockEngine; link: HttpEngineLink }> {
  const mock = new MockEngine();
  await mock.start();
  mocks.push(mock);
  const link = new HttpEngineLink({ baseUrl: mock.url, token: opts.token, reconnectMs: 10, maxReconnectMs: 40 });
  links.push(link);
  return { mock, link };
}
afterEach(async () => {
  for (const l of links.splice(0)) l.close();
  for (const m of mocks.splice(0)) await m.stop();
});

/** Polls `cond` until it holds or fails after `ms` (for state that depends on timers). */
async function waitFor(cond: () => boolean, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("condition not met in time");
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** Pulls `n` events from the link or fails after `ms`. */
async function take(iter: AsyncIterator<AgentEvent>, n: number, ms = 5000): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`only got ${out.length}/${n} events`)), ms));
  while (out.length < n) {
    const r = await Promise.race([iter.next(), timeout]);
    if (r.done) throw new Error("stream ended");
    out.push(r.value);
  }
  return out;
}
const seqs = (evs: AgentEvent[]) => evs.map((e) => e.seq);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("HttpEngineLink commands", () => {
  it("lists repos, starts jobs and resolves approvals, sending the token", async () => {
    const { mock, link } = await setup({ token: "tok" });
    expect((await link.listRepos()).map((r) => r.id)).toEqual(["haunted-todo"]);
    expect(await link.startJob("haunted-todo", "g")).toEqual({ taskId: "t1" });
    await link.resolveApproval("appr-1", "approve", "go");
    expect(mock.seenTokens.length).toBe(3);
    expect(mock.seenTokens.every((t) => t === "tok")).toBe(true);
  });

  it("turns engine errors into Errors carrying the engine message", async () => {
    const { mock, link } = await setup();
    mock.startStatus = 409;
    await expect(link.startJob("haunted-todo", "g")).rejects.toThrow("another job is still running");
  });

  it("builds the client job view with a timeline from the export", async () => {
    const { mock, link } = await setup();
    mock.exportBody = {
      version: 1,
      recordedAt: 5,
      job: { taskId: "t1", repoId: "haunted-todo", goal: "g", state: "developing", steps: [], approvals: [], artifacts: [] },
      events: [
        { type: "task.created", seq: 1, ts: 10, taskId: "t1", repoId: "haunted-todo", goal: "g" },
        { type: "task.state_changed", seq: 2, ts: 11, taskId: "t1", state: "analyzing" },
        say(3),
        { type: "task.state_changed", seq: 4, ts: 12, taskId: "t1", state: "developing", reason: "approved" },
      ],
      artifacts: [],
    };
    const job = await link.getJob("t1");
    expect(job.state).toBe("developing");
    expect(job.timeline).toEqual([
      { ts: 11, state: "analyzing" },
      { ts: 12, state: "developing", text: "approved" },
    ]);
    mock.exportBody = undefined;
    await expect(link.getJob("t1")).rejects.toThrow();
  });
});

describe("HttpEngineLink events", () => {
  it("starts at the engine head: old events are not replayed, new ones arrive in order", async () => {
    const { mock, link } = await setup();
    mock.push(say(1), say(2), say(3));
    const it = link.events()[Symbol.asyncIterator]();
    const pending = take(it, 2);
    await sleep(50);
    mock.push(say(4), say(5));
    expect(seqs(await pending)).toEqual([4, 5]);
    expect(mock.seenSince[0]).toBe(3);
  });

  it("reconnects with the last seen seq and loses nothing", async () => {
    const { mock, link } = await setup();
    const it = link.events()[Symbol.asyncIterator]();
    await sleep(50);
    mock.push(say(1), say(2));
    const first = await take(it, 2);
    mock.dropStreams();
    mock.push(say(3), say(4)); // while disconnected
    await sleep(100);
    mock.push(say(5));
    const rest = await take(it, 3);
    expect([...seqs(first), ...seqs(rest)]).toEqual([1, 2, 3, 4, 5]);
    expect(mock.seenSince.at(-1)).toBe(2);
  });

  it("keeps retrying while the engine is down, then resumes", async () => {
    const { mock, link } = await setup();
    const it = link.events()[Symbol.asyncIterator]();
    await sleep(50);
    mock.push(say(1));
    await take(it, 1);
    const port = mock.port;
    await mock.stop();
    await sleep(80); // several failed attempts
    // Bring a new server up on the same port with the same log plus one more event.
    const revived = new MockEngine();
    revived.events = [say(1), say(2)];
    await new Promise<void>((r) => (revived as unknown as { server: http.Server }).server.listen(port, "127.0.0.1", r));
    revived.port = port;
    mocks.push(revived);
    expect(seqs(await take(it, 1, 3000))).toEqual([2]);
  });

  it("starts over when the engine database was reset (lower seq)", async () => {
    const { mock, link } = await setup();
    mock.push(say(1), say(2), say(3));
    const it = link.events()[Symbol.asyncIterator]();
    await sleep(50);
    mock.push(say(4));
    await take(it, 1);
    mock.events = []; // engine restarted with a fresh database
    mock.dropStreams();
    // Wait for the link to actually reconnect: a fixed sleep raced with reconnect under load.
    await waitFor(() => mock.clients.size > 0);
    mock.push(say(1));
    const [ev] = await take(it, 1);
    expect(ev?.seq).toBe(1);
  });

  it("ignores duplicates and invalid events", async () => {
    const { mock, link } = await setup();
    const it = link.events()[Symbol.asyncIterator]();
    await sleep(50);
    for (const c of mock.clients) c.write(`id: 1\nevent: agent\ndata: {"type":"nope"}\n\n`);
    mock.push(say(1));
    for (const c of mock.clients) c.write(`id: 1\nevent: agent\ndata: ${JSON.stringify(say(1))}\n\n`);
    mock.push(say(2));
    expect(seqs(await take(it, 2))).toEqual([1, 2]);
  });

  it("close() ends the stream", async () => {
    const { link } = await setup();
    const it = link.events()[Symbol.asyncIterator]();
    await sleep(30);
    link.close();
    const r = await it.next();
    expect(r.done).toBe(true);
  });
});
