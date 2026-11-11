import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { ServerMsgSchema, WorldSim } from "@agentlife/shared";
import type { AgentEvent, ClientMsg, DeliveryInfo, JobDetails, Project, RegisterProjectBody, RegisterProjectResult, ServerMsg } from "@agentlife/shared";
import { EventQueue } from "../src/engine-link.ts";
import type { EngineLink } from "../src/engine-link.ts";
import { startGateway } from "../src/gateway.ts";
import type { Gateway } from "../src/gateway.ts";
import { HttpEngineLink } from "../src/http-engine.ts";
import { loadRoomFile } from "../src/load-room.ts";

const gateways: Gateway[] = [];
const sockets: WebSocket[] = [];
afterEach(async () => {
  for (const s of sockets.splice(0)) s.terminate();
  for (const g of gateways.splice(0)) await g.close();
});

const builtin: Project = { id: "haunted-todo", name: "haunted-todo", stack: "node-npm", testCommand: "npm test", builtin: true, registeredAt: 0 };
const mine: Project = { id: "my-app", name: "My App", stack: "node-npm", testCommand: "npm test", builtin: false, registeredAt: 5 };

function details(over: { deliverable?: boolean; delivery?: DeliveryInfo }): JobDetails {
  return {
    job: { taskId: "task-1", repoId: "my-app", goal: "g", state: "delivered", steps: [], approvals: [], artifacts: [], ...over },
    artifacts: [],
  };
}

/** An engine whose Reception and delivery calls are recorded and answered from the test. */
function receptionEngine(opts: { register?: RegisterProjectResult; remove?: Error; deliver?: DeliveryInfo | Error; job?: JobDetails } = {}) {
  const queue = new EventQueue<AgentEvent>();
  const calls: string[] = [];
  const registered: RegisterProjectBody[] = [];
  let projects = [builtin];
  const link: EngineLink = {
    listRepos: () => Promise.resolve(projects.map((p) => ({ id: p.id, name: p.name }))),
    startJob: () => Promise.reject(new Error("not used")),
    resolveApproval: () => Promise.resolve(),
    getJob: () => Promise.reject(new Error("not used")),
    getJobDetails: () => (opts.job ? Promise.resolve(opts.job) : Promise.reject(new Error("no details"))),
    listProjects: () => Promise.resolve(projects),
    registerProject: (body) => {
      registered.push(body);
      const result = opts.register ?? { status: "ok" as const, project: mine };
      if (result.status === "ok") projects = [builtin, result.project];
      return Promise.resolve(result);
    },
    removeProject: (id) => {
      calls.push(`remove:${id}`);
      if (opts.remove) return Promise.reject(opts.remove);
      projects = projects.filter((p) => p.id !== id);
      return Promise.resolve();
    },
    deliver: (taskId) => {
      calls.push(`deliver:${taskId}`);
      const d = opts.deliver ?? { branch: `agentlife/${taskId}`, commit: "0123456789abcdef" };
      return d instanceof Error ? Promise.reject(d) : Promise.resolve(d);
    },
    events: () => queue,
    close: () => queue.close(),
  };
  return { link, queue, calls, registered };
}

async function boot(link: EngineLink) {
  const sim = new WorldSim(loadRoomFile(), Date.now, { msPerTile: 5 });
  const gateway = await startGateway({ sim, engine: link, port: 0, tickMs: 5 });
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
  const send = (msg: ClientMsg) => ws.send(JSON.stringify(msg));
  return { ws, received, waitFor, send };
}

const has = (c: { received: ServerMsg[] }, type: ServerMsg["type"]) => c.received.some((m) => m.type === type);

describe("Reception through the gateway", () => {
  it("sends the project list before it opens the panel when the user uses the reception desk", async () => {
    const { link } = receptionEngine();
    const c = connect((await boot(link)).port);
    await c.waitFor(() => has(c, "welcome"));
    c.send({ type: "use", itemId: "reception_desk_1" });
    await c.waitFor(() => has(c, "open_panel"));
    const types = c.received.map((m) => m.type);
    expect(types.indexOf("projects")).toBeGreaterThan(-1);
    expect(types.indexOf("projects")).toBeLessThan(types.indexOf("open_panel"));
    expect(c.received.find((m) => m.type === "open_panel")).toMatchObject({ panel: "reception" });
    expect(c.received.find((m) => m.type === "projects")).toMatchObject({ projects: [builtin] });
  });

  it("forwards a registration, answers with the result and refreshes the lists when it worked", async () => {
    const { link, registered } = receptionEngine();
    const c = connect((await boot(link)).port);
    await c.waitFor(() => has(c, "welcome"));
    c.send({ type: "register_project", path: "D:\\AgentHotel\\my-app", name: "My App", testCommand: "npm test", acceptFindings: true });
    await c.waitFor(() => has(c, "register_result") && has(c, "projects") && has(c, "repos"));
    expect(registered).toEqual([{ path: "D:\\AgentHotel\\my-app", name: "My App", testCommand: "npm test", acceptFindings: true }]);
    expect(c.received.find((m) => m.type === "register_result")).toMatchObject({ result: { status: "ok" } });
    expect(c.received.find((m) => m.type === "projects")).toMatchObject({ projects: [builtin, mine] });
    expect(c.received.find((m) => m.type === "repos")).toMatchObject({ repos: [{ id: "haunted-todo" }, { id: "my-app" }] });
  });

  it("passes findings and refusals through without refreshing the lists", async () => {
    const result: RegisterProjectResult = {
      status: "needs_acceptance",
      total: 1,
      findings: [{ severity: "medium", kind: "email", masked: "a***@b.io", where: "package.json", count: 1 }],
    };
    const { link } = receptionEngine({ register: result });
    const c = connect((await boot(link)).port);
    await c.waitFor(() => has(c, "welcome"));
    c.send({ type: "register_project", path: "D:\\AgentHotel\\x", name: "x" });
    await c.waitFor(() => has(c, "register_result"));
    expect(c.received.find((m) => m.type === "register_result")).toMatchObject({ result });
    expect(has(c, "projects")).toBe(false);
  });

  it("removes a project and refreshes, or reports the engine's reason", async () => {
    const ok = receptionEngine();
    const c = connect((await boot(ok.link)).port);
    await c.waitFor(() => has(c, "welcome"));
    c.send({ type: "remove_project", projectId: "my-app" });
    await c.waitFor(() => has(c, "projects"));
    expect(ok.calls).toEqual(["remove:my-app"]);

    const busy = receptionEngine({ remove: new Error("A job is running on this project. Wait for it to finish.") });
    const d = connect((await boot(busy.link)).port);
    await d.waitFor(() => has(d, "welcome"));
    d.send({ type: "remove_project", projectId: "my-app" });
    await d.waitFor(() => has(d, "error"));
    expect(d.received.find((m) => m.type === "error")).toMatchObject({ code: "project_error", message: "A job is running on this project. Wait for it to finish." });
  });

  it("rejects a malformed registration before it reaches the engine", async () => {
    const { link, registered } = receptionEngine();
    const c = connect((await boot(link)).port);
    await c.waitFor(() => has(c, "welcome"));
    c.ws.send(JSON.stringify({ type: "register_project", path: "x" }));
    c.ws.send(JSON.stringify({ type: "register_project", path: "x", name: "n", testCommand: "a\nb" }));
    await c.waitFor(() => c.received.filter((m) => m.type === "error").length === 2);
    expect(registered).toEqual([]);
  });

  it("says the engine is unavailable when it has no Reception", async () => {
    const queue = new EventQueue<AgentEvent>();
    const bare: EngineLink = {
      listRepos: () => Promise.resolve([]),
      startJob: () => Promise.reject(new Error("x")),
      resolveApproval: () => Promise.resolve(),
      getJob: () => Promise.reject(new Error("x")),
      events: () => queue,
      close: () => queue.close(),
    };
    const c = connect((await boot(bare)).port);
    await c.waitFor(() => has(c, "welcome"));
    c.send({ type: "register_project", path: "x", name: "n" });
    c.send({ type: "deliver", taskId: "task-1" });
    await c.waitFor(() => c.received.filter((m) => m.type === "error").length === 2);
    expect(c.received.filter((m) => m.type === "error").every((m) => m.type === "error" && m.code === "engine_unavailable")).toBe(true);
  });
});

describe("delivery through the gateway", () => {
  const reportEvents = (): AgentEvent[] => [
    { seq: 1, ts: 1000, taskId: "task-1", type: "task.created", repoId: "my-app", goal: "g" },
    { seq: 2, ts: 1100, taskId: "task-1", type: "report.ready", reportId: "report-task-1", title: "Report: g", markdown: "# Report\n" },
  ];

  it("marks a report as deliverable when the engine says so, and delivers on request", async () => {
    const { link, queue, calls } = receptionEngine({ job: details({ deliverable: true }) });
    const c = connect((await boot(link)).port);
    await c.waitFor(() => has(c, "welcome"));
    for (const ev of reportEvents()) queue.push(ev);
    await c.waitFor(() => has(c, "report"));
    expect(c.received.find((m) => m.type === "report")).toMatchObject({ report: { reportId: "report-task-1", delivery: { state: "available" } } });

    c.send({ type: "deliver", taskId: "task-1" });
    await c.waitFor(() => c.received.filter((m) => m.type === "report").length === 2);
    expect(calls).toEqual(["deliver:task-1"]);
    const again = c.received.filter((m) => m.type === "report")[1];
    expect(again).toMatchObject({
      resend: true,
      report: { reportId: "report-task-1", delivery: { state: "done", branch: "agentlife/task-1", commit: "0123456789abcdef" } },
    });
  });

  it("shows a delivered job as delivered after a reload, and a built-in job without any delivery", async () => {
    const delivered = receptionEngine({ job: details({ delivery: { branch: "agentlife/task-1", commit: "abc1234" } }) });
    const c = connect((await boot(delivered.link)).port);
    await c.waitFor(() => has(c, "welcome"));
    for (const ev of reportEvents()) delivered.queue.push(ev);
    await c.waitFor(() => has(c, "report"));
    const d = connect(gateways[0]!.port);
    await d.waitFor(() => has(d, "welcome"));
    d.send({ type: "use", itemId: "mailbox_1" });
    await d.waitFor(() => d.received.some((m) => m.type === "report"));
    expect(d.received.find((m) => m.type === "report")).toMatchObject({
      resend: true,
      report: { delivery: { state: "done", branch: "agentlife/task-1" } },
    });

    const plain = receptionEngine({ job: details({}) });
    const e = connect((await boot(plain.link)).port);
    await e.waitFor(() => has(e, "welcome"));
    for (const ev of reportEvents()) plain.queue.push(ev);
    await e.waitFor(() => has(e, "report"));
    expect(e.received.find((m) => m.type === "report")).toMatchObject({ report: { reportId: "report-task-1" } });
    const report = e.received.find((m) => m.type === "report");
    expect(report?.type === "report" && report.report.delivery).toBeUndefined();
  });

  it("still delivers the report when the engine cannot describe the job", async () => {
    const { link, queue } = receptionEngine();
    const c = connect((await boot(link)).port);
    await c.waitFor(() => has(c, "welcome"));
    for (const ev of reportEvents()) queue.push(ev);
    await c.waitFor(() => has(c, "report"));
    const report = c.received.find((m) => m.type === "report");
    expect(report?.type === "report" && report.report.delivery).toBeUndefined();
  });

  it("reports why a delivery was refused and keeps the button state", async () => {
    const refusal = new Error("The branch agentlife/task-1 already exists in your repository. Nothing was changed.");
    const { link, queue } = receptionEngine({ job: details({ deliverable: true }), deliver: refusal });
    const c = connect((await boot(link)).port);
    await c.waitFor(() => has(c, "welcome"));
    for (const ev of reportEvents()) queue.push(ev);
    await c.waitFor(() => has(c, "report"));
    c.send({ type: "deliver", taskId: "task-1" });
    await c.waitFor(() => c.received.some((m) => m.type === "error" && m.code === "delivery_failed"));
    expect(c.received.find((m) => m.type === "error" && m.code === "delivery_failed")).toMatchObject({ message: refusal.message });
    expect(c.received.filter((m) => m.type === "report")).toHaveLength(1);
  });
});

describe("HttpEngineLink and the Reception", () => {
  const json = (status: number, body: unknown): Response =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  function link(handler: (url: string, init: RequestInit) => Response) {
    const seen: { url: string; method: string; body: unknown }[] = [];
    const fetchFn = ((url: string, init: RequestInit) => {
      seen.push({ url: url.replace("http://engine.test", ""), method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : undefined });
      return Promise.resolve(handler(url, init));
    }) as typeof fetch;
    return { engine: new HttpEngineLink({ baseUrl: "http://engine.test", fetch: fetchFn }), seen };
  }

  it("treats a 400 answer to a registration as a result, not as a failure", async () => {
    const refused = { status: "error", code: "no_commits", message: "The repository has no commits yet." };
    const { engine, seen } = link(() => json(400, refused));
    await expect(engine.registerProject({ path: "D:\\AgentHotel\\x", name: "x" })).resolves.toEqual(refused);
    expect(seen).toEqual([{ url: "/projects", method: "POST", body: { path: "D:\\AgentHotel\\x", name: "x" } }]);
    engine.close();
  });

  it("lists, removes and delivers over the engine's routes", async () => {
    const { engine, seen } = link((url, init) => {
      if (url.endsWith("/projects") && init.method === "GET") return json(200, [builtin]);
      if (init.method === "DELETE") return json(200, { ok: true });
      return json(200, { branch: "agentlife/task-1", commit: "abc1234" });
    });
    expect(await engine.listProjects()).toEqual([builtin]);
    await engine.removeProject("my-app");
    expect(await engine.deliver("task-1")).toEqual({ branch: "agentlife/task-1", commit: "abc1234" });
    expect(seen.map((s) => `${s.method} ${s.url}`)).toEqual(["GET /projects", "DELETE /projects/my-app", "POST /tasks/task-1/deliver"]);
    engine.close();
  });

  it("turns an engine refusal into an error that carries the engine's message", async () => {
    const { engine } = link(() => json(409, { error: "branch_exists", message: "The branch already exists." }));
    await expect(engine.deliver("task-1")).rejects.toThrow("The branch already exists.");
    await expect(engine.removeProject("x")).rejects.toThrow("The branch already exists.");
    engine.close();
  });
});
