import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { ServerMsgSchema } from "@agentlife/shared";
import type { AgentEvent, ClientMsg, NightJob, NightJobRequest, NightState, ServerMsg } from "@agentlife/shared";
import { EventQueue } from "../src/engine-link.ts";
import type { EngineLink } from "../src/engine-link.ts";
import { startGateway } from "../src/gateway.ts";
import type { Gateway } from "../src/gateway.ts";
import { HttpEngineLink } from "../src/http-engine.ts";
import { testHotel } from "./helpers.ts";

const gateways: Gateway[] = [];
const sockets: WebSocket[] = [];
afterEach(async () => {
  for (const s of sockets.splice(0)) s.terminate();
  for (const g of gateways.splice(0)) await g.close();
});

const CONFIG = { start: "01:00", end: "07:00", maxJobsPerNight: 4, maxJobMinutes: 20 };

function nightJob(id: string, extra: Partial<NightJob> = {}): NightJob {
  return { id, repoId: "demo", kind: "audit-deps", goal: "Audit dependencies", tier: "normal", preApprove: false, deliver: false, status: "scheduled", addedAt: 1, ...extra };
}

/** An engine whose night schedule is a list in memory. */
function engine(opts: { open?: boolean; refuse?: string; project?: boolean } = {}) {
  const queue = new EventQueue<AgentEvent>();
  const jobs: NightJob[] = [nightJob("a"), nightJob("b")];
  const calls: string[] = [];
  const state = { open: opts.open ?? false };
  const link: EngineLink = {
    listRepos: () => Promise.resolve([]),
    listProjects: () => Promise.resolve([{ id: "demo", name: "Demo", builtin: true, stack: "node-npm", testCommand: "npm test", registeredAt: 0 }]),
    startJob: () => Promise.reject(new Error("not used")),
    resolveApproval: () => Promise.resolve(),
    getJob: () => Promise.reject(new Error("not used")),
    getNight: (): Promise<NightState> => Promise.resolve({ config: CONFIG, open: state.open, jobs: [...jobs] }),
    addNightJob: (job: NightJobRequest) => {
      calls.push(`add:${job.kind}:${job.repoId}`);
      if (opts.refuse) return Promise.reject(new Error(opts.refuse));
      const added = nightJob(`n${jobs.length + 1}`, { kind: job.kind, repoId: job.repoId });
      jobs.push(added);
      return Promise.resolve(added);
    },
    removeNightJob: (id: string) => {
      calls.push(`remove:${id}`);
      const i = jobs.findIndex((j) => j.id === id);
      if (i < 0) return Promise.reject(new Error("unknown night job"));
      jobs.splice(i, 1);
      return Promise.resolve();
    },
    moveNightJob: (id: string, direction: "up" | "down") => {
      calls.push(`move:${id}:${direction}`);
      return Promise.resolve();
    },
    events: () => queue,
    close: () => queue.close(),
  };
  return { link, calls, jobs, state };
}

async function connect(link: EngineLink, extra: { nightPollMs?: number } = {}) {
  const gateway = await startGateway({ hotel: testHotel(), engine: link, port: 0, tickMs: 5, ...extra });
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

const nights = (received: ServerMsg[]) => received.flatMap((m) => (m.type === "night" ? [m.state] : []));
const errors = (received: ServerMsg[]) => received.flatMap((m) => (m.type === "error" ? [m] : []));

const GOOD: Record<string, unknown> = { type: "night_add", job: { repoId: "demo", kind: "audit-deps", tier: "cheap", preApprove: false, deliver: false } };

describe("night board through the gateway", () => {
  it("sends the projects and the schedule before it opens the panel", async () => {
    const { link } = engine();
    const c = await connect(link);
    c.send({ type: "use", itemId: "night_board_1" });
    await c.waitFor(() => c.received.some((m) => m.type === "open_panel"));
    const types = c.received.map((m) => m.type);
    expect(types.indexOf("night")).toBeGreaterThan(-1);
    expect(types.indexOf("night")).toBeLessThan(types.indexOf("open_panel"));
    expect(types.indexOf("projects")).toBeLessThan(types.indexOf("open_panel"));
    expect(c.received.find((m) => m.type === "open_panel")).toMatchObject({ panel: "night" });
    expect(nights(c.received)[0]?.jobs.map((j) => j.id)).toEqual(["a", "b"]);
  });

  it("adds, moves and removes a job and answers each time with the new schedule", async () => {
    const e = engine();
    const c = await connect(e.link);
    c.send(GOOD);
    await c.waitFor(() => nights(c.received).some((s) => s.jobs.length === 3));
    expect(e.calls).toEqual(["add:audit-deps:demo"]);

    c.send({ type: "night_move", id: "b", direction: "up" });
    await c.waitFor(() => e.calls.includes("move:b:up"));
    c.send({ type: "night_remove", id: "a" });
    await c.waitFor(() => nights(c.received).some((s) => !s.jobs.some((j) => j.id === "a")));
    expect(errors(c.received)).toEqual([]);
  });

  it("reports a refused change as night_error and still sends the schedule", async () => {
    const e = engine({ refuse: "The night schedule holds 50 jobs. Remove one first." });
    const c = await connect(e.link);
    c.send(GOOD);
    await c.waitFor(() => errors(c.received).length > 0 && nights(c.received).length > 0);
    expect(errors(c.received)[0]).toMatchObject({ code: "night_error", message: "The night schedule holds 50 jobs. Remove one first." });
  });

  it("refuses a malformed job before it reaches the engine", async () => {
    const e = engine();
    const c = await connect(e.link);
    c.send({ type: "night_add", job: { repoId: "demo", kind: "review-branch", target: "../etc", tier: "normal", preApprove: false, deliver: false } });
    c.send({ type: "night_add", job: { repoId: "demo", kind: "audit-deps", preApprove: true } });
    c.send({ type: "night_move", id: "a", direction: "sideways" });
    await c.waitFor(() => errors(c.received).filter((m) => m.code === "bad_message").length === 3);
    expect(e.calls).toEqual([]);
  });

  it("says so when the engine has no night shift", async () => {
    const { link } = engine();
    delete link.getNight;
    const c = await connect(link);
    c.send({ type: "night_state" });
    await c.waitFor(() => errors(c.received).some((m) => m.code === "engine_unavailable"));
    c.send(GOOD);
    await c.waitFor(() => errors(c.received).filter((m) => m.code === "engine_unavailable").length === 2);
  });
});

describe("night clock", () => {
  const clocks = (received: ServerMsg[]) => received.flatMap((m) => (m.type === "night_clock" ? [m] : []));

  it("tells a new client whether the window is open", async () => {
    const e = engine({ open: true });
    const c = await connect(e.link);
    await c.waitFor(() => clocks(c.received).length > 0);
    expect(clocks(c.received)[0]).toMatchObject({ open: true, start: "01:00", end: "07:00" });
  });

  it("sends a change when the window opens or closes, and nothing while it stays the same", async () => {
    const e = engine({ open: false });
    const c = await connect(e.link, { nightPollMs: 15 });
    await c.waitFor(() => clocks(c.received).length === 1);
    await new Promise((r) => setTimeout(r, 80));
    expect(clocks(c.received)).toHaveLength(1);
    e.state.open = true;
    await c.waitFor(() => clocks(c.received).length === 2);
    expect(clocks(c.received)[1]).toMatchObject({ open: true });
    e.state.open = false;
    await c.waitFor(() => clocks(c.received).length === 3);
    expect(clocks(c.received)[2]).toMatchObject({ open: false });
  });
});

describe("HttpEngineLink night methods", () => {
  function link(respond: (url: string, init: RequestInit) => { status: number; body: unknown }) {
    const seen: { url: string; method: string; body: unknown }[] = [];
    const fetchStub = ((url: string, init: RequestInit) => {
      seen.push({ url, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : undefined });
      const r = respond(url, init);
      return Promise.resolve(new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } }));
    }) as unknown as typeof fetch;
    return { engine: new HttpEngineLink({ baseUrl: "http://engine.test", fetch: fetchStub }), seen };
  }

  it("reads the schedule and sends add, move and remove to the right routes", async () => {
    const job = nightJob("n1");
    const { engine: e, seen } = link((url, init) => {
      if (url.endsWith("/night") && init.method === "GET") return { status: 200, body: { config: CONFIG, open: false, jobs: [job] } };
      if (url.endsWith("/night/jobs")) return { status: 201, body: job };
      return { status: 200, body: { ok: true } };
    });
    expect((await e.getNight()).jobs).toHaveLength(1);
    expect(await e.addNightJob({ repoId: "demo", kind: "audit-deps", tier: "normal", preApprove: false, deliver: false })).toMatchObject({ id: "n1" });
    await e.moveNightJob("n1", "down");
    await e.removeNightJob("n/1");
    expect(seen.map((s) => `${s.method} ${s.url.replace("http://engine.test", "")}`)).toEqual([
      "GET /night",
      "POST /night/jobs",
      "POST /night/jobs/n1/move",
      "DELETE /night/jobs/n%2F1",
    ]);
    expect(seen[2]?.body).toEqual({ direction: "down" });
  });

  it("names the field the engine refused", async () => {
    const { engine: e } = link(() => ({ status: 400, body: { error: "invalid_request", issues: [{ path: "scopePaths", message: "name the files or folders the plan may touch" }] } }));
    await expect(e.addNightJob({ repoId: "demo", kind: "change", goal: "x", tier: "normal", preApprove: true, deliver: false })).rejects.toThrow(
      "scopePaths: name the files or folders the plan may touch",
    );
  });

  it("passes the engine's message for a refusal without issues", async () => {
    const { engine: e } = link(() => ({ status: 409, body: { error: "night_full", message: "The night schedule holds 50 jobs. Remove one first." } }));
    await expect(e.addNightJob({ repoId: "demo", kind: "audit-deps", tier: "normal", preApprove: false, deliver: false })).rejects.toThrow("The night schedule holds 50 jobs");
  });
});
