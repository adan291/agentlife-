import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { ServerMsgSchema, footprintTiles, useTile, FURNI_CATALOG } from "@agentlife/shared";
import type { AgentEvent, BranchesResponse, ClientMsg, Project, RoomId, ServerMsg } from "@agentlife/shared";
import { EventQueue } from "../src/engine-link.ts";
import type { EngineLink, StartJobOptions } from "../src/engine-link.ts";
import { FakeEngineLink } from "../src/fake-engine.ts";
import { startGateway } from "../src/gateway.ts";
import type { Gateway } from "../src/gateway.ts";
import { HttpEngineLink } from "../src/http-engine.ts";
import { loadHotelRooms } from "../src/load-room.ts";
import { testHotel } from "./helpers.ts";

const gateways: Gateway[] = [];
const sockets: WebSocket[] = [];
afterEach(async () => {
  for (const s of sockets.splice(0)) s.terminate();
  for (const g of gateways.splice(0)) await g.close();
});

const mine: Project = { id: "my-app", name: "My App", stack: "node-npm", testCommand: "npm test", builtin: false, registeredAt: 5 };
const FLOOR: RoomId = "project:my-app";

interface Started {
  repoId: string;
  goal: string;
  options: StartJobOptions | undefined;
}

/** An engine that records the jobs it is asked to start and answers the branch picker from the test. */
function kindsEngine(opts: { branches?: BranchesResponse | Error | "missing" } = {}) {
  const queue = new EventQueue<AgentEvent>();
  const started: Started[] = [];
  const asked: string[] = [];
  const answer = opts.branches ?? { current: "main", branches: ["main", "feature/login"] };
  const link: EngineLink = {
    listRepos: () => Promise.resolve([{ id: mine.id, name: mine.name }]),
    startJob: (repoId, goal, options) => {
      started.push({ repoId, goal, options });
      return Promise.resolve({ taskId: `task-${started.length}` });
    },
    resolveApproval: () => Promise.resolve(),
    getJob: () => Promise.reject(new Error("not used")),
    listProjects: () => Promise.resolve([mine]),
    ...(answer === "missing"
      ? {}
      : {
          listBranches: (projectId: string) => {
            asked.push(projectId);
            return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
          },
        }),
    events: () => queue,
    close: () => queue.close(),
  };
  return { link, started, asked };
}

async function boot(link: EngineLink, start: RoomId = FLOOR) {
  const hotel = testHotel({ projects: [mine.id], start });
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
  return { ws, received, waitFor, send };
}

const has = (c: { received: ServerMsg[] }, type: ServerMsg["type"]) => c.received.some((m) => m.type === type);
const types = (c: { received: ServerMsg[] }) => c.received.map((m) => m.type);

describe("furniture per kind on a project floor", () => {
  const { template } = loadHotelRooms();

  it("has the review desk, test lab and library shelf, with a free tile in front of each", () => {
    const blocked = new Set<string>();
    for (const p of template.furni) {
      const def = FURNI_CATALOG[p.defId]!;
      if (!def.walkable) for (const t of footprintTiles(p, def)) blocked.add(`${t.x},${t.y}`);
    }
    for (const [item, panel] of [
      ["review_desk_1", "review"],
      ["test_lab_1", "tests"],
      ["library_shelf_1", "library"],
    ] as const) {
      const placed = template.furni.find((f) => f.itemId === item);
      expect(placed, item).toBeDefined();
      expect(FURNI_CATALOG[placed!.defId]?.interaction).toBe(panel);
      const use = useTile(placed!);
      expect(blocked.has(`${use.x},${use.y}`), `${item} use tile`).toBe(false);
    }
  });

  it("the user can walk to each of them and the panel opens", async () => {
    const { link } = kindsEngine();
    const c = connect((await boot(link)).port);
    await c.waitFor(() => has(c, "welcome"));
    for (const [item, panel] of [
      ["review_desk_1", "review"],
      ["test_lab_1", "tests"],
      ["library_shelf_1", "library"],
    ] as const) {
      c.send({ type: "use", itemId: item });
      await c.waitFor(() => c.received.some((m) => m.type === "open_panel" && m.panel === panel));
    }
  });
});

describe("panels of the kinds through the gateway", () => {
  it("sends the repository and the branches before it opens the review desk", async () => {
    const { link, asked } = kindsEngine();
    const c = connect((await boot(link)).port);
    await c.waitFor(() => has(c, "welcome"));
    c.send({ type: "use", itemId: "review_desk_1" });
    await c.waitFor(() => has(c, "open_panel"));
    const order = types(c);
    expect(order.indexOf("repos")).toBeLessThan(order.indexOf("branches"));
    expect(order.indexOf("branches")).toBeLessThan(order.indexOf("open_panel"));
    expect(c.received.find((m) => m.type === "branches")).toEqual({
      type: "branches",
      projectId: "my-app",
      current: "main",
      branches: ["main", "feature/login"],
    });
    expect(asked).toEqual(["my-app"]);
  });

  it("sends only the repository for the test lab and the library shelf", async () => {
    const { link, asked } = kindsEngine();
    const c = connect((await boot(link)).port);
    await c.waitFor(() => has(c, "welcome"));
    c.send({ type: "use", itemId: "test_lab_1" });
    await c.waitFor(() => c.received.some((m) => m.type === "open_panel" && m.panel === "tests"));
    c.send({ type: "use", itemId: "library_shelf_1" });
    await c.waitFor(() => c.received.some((m) => m.type === "open_panel" && m.panel === "library"));
    expect(has(c, "branches")).toBe(false);
    expect(asked).toEqual([]);
    expect(c.received.filter((m) => m.type === "repos")).toHaveLength(2);
  });

  it("answers a refresh of the branch list", async () => {
    const { link } = kindsEngine({ branches: { current: null, branches: ["a"] } });
    const c = connect((await boot(link)).port);
    await c.waitFor(() => has(c, "welcome"));
    c.send({ type: "list_branches" });
    await c.waitFor(() => has(c, "branches"));
    expect(c.received.find((m) => m.type === "branches")).toMatchObject({ projectId: "my-app", current: null, branches: ["a"] });
  });

  it("says so when the engine cannot list branches or fails to", async () => {
    const missing = connect((await boot(kindsEngine({ branches: "missing" }).link)).port);
    await missing.waitFor(() => has(missing, "welcome"));
    missing.send({ type: "list_branches" });
    await missing.waitFor(() => has(missing, "error"));
    expect(missing.received.find((m) => m.type === "error")).toMatchObject({ code: "engine_unavailable" });

    const failing = connect((await boot(kindsEngine({ branches: new Error("The project folder moved.") }).link)).port);
    await failing.waitFor(() => has(failing, "welcome"));
    failing.send({ type: "list_branches" });
    await failing.waitFor(() => has(failing, "error"));
    expect(failing.received.find((m) => m.type === "error")).toMatchObject({ code: "engine_unavailable", message: "The project folder moved." });
  });

  it("refuses to list branches outside a project floor", async () => {
    const { link, asked } = kindsEngine();
    const c = connect((await boot(link, "lobby")).port);
    await c.waitFor(() => has(c, "welcome"));
    c.send({ type: "list_branches" });
    await c.waitFor(() => has(c, "error"));
    expect(c.received.find((m) => m.type === "error")).toMatchObject({ code: "bad_message" });
    expect(asked).toEqual([]);
  });
});

describe("starting a job of each kind", () => {
  it("passes the kind and target to the engine, and a change as before", async () => {
    const { link, started } = kindsEngine();

    // A floor runs one job at a time, so each start gets its own gateway (and so its own free floor).
    const jobs: { msg: Record<string, unknown>; options: StartJobOptions | undefined }[] = [
      { msg: { goal: "Review branch feature/login", kind: "review-branch", target: "feature/login" }, options: { kind: "review-branch", target: "feature/login" } },
      { msg: { goal: "Write tests for src/todo.ts", kind: "write-tests", target: "src/todo.ts" }, options: { kind: "write-tests", target: "src/todo.ts" } },
      { msg: { goal: "Document the build", kind: "document", target: "The build" }, options: { kind: "document", target: "The build" } },
      { msg: { goal: "Fix it" }, options: undefined },
      { msg: { goal: "Fix it", kind: "change" }, options: undefined },
    ];
    for (const job of jobs) {
      const c = connect((await boot(link)).port);
      await c.waitFor(() => has(c, "welcome"));
      c.send({ type: "start_job", repoId: "my-app", ...job.msg });
      await vi.waitFor(() => expect(started.length).toBeGreaterThan(0));
      expect(started.pop()).toEqual({ repoId: "my-app", goal: job.msg["goal"], options: job.options });
      c.ws.terminate();
    }
  });

  it("refuses a kind without its target before the engine hears of it", async () => {
    const { link, started } = kindsEngine();
    const c = connect((await boot(link)).port);
    await c.waitFor(() => has(c, "welcome"));
    c.send({ type: "start_job", repoId: "my-app", goal: "Review", kind: "review-branch" });
    c.send({ type: "start_job", repoId: "my-app", goal: "Tests", kind: "write-tests", target: "../etc" });
    c.send({ type: "start_job", repoId: "my-app", goal: "Fix", target: "main" });
    await c.waitFor(() => c.received.filter((m) => m.type === "error").length === 3);
    expect(c.received.filter((m) => m.type === "error").every((m) => m.type === "error" && m.code === "bad_message")).toBe(true);
    expect(started).toEqual([]);
  });

  it("starts a job only from the project's own floor", async () => {
    const { link, started } = kindsEngine();
    const c = connect((await boot(link, "lobby")).port);
    await c.waitFor(() => has(c, "welcome"));
    c.send({ type: "start_job", repoId: "my-app", goal: "Review", kind: "review-branch", target: "feature/login" });
    await c.waitFor(() => has(c, "error"));
    expect(started).toEqual([]);
  });
});

describe("the scripted engine", () => {
  it("runs changes only and says so for another kind", async () => {
    const engine = new FakeEngineLink({ stepMs: 0 });
    await expect(engine.startJob("haunted-todo", "g", { kind: "review-branch", target: "x" })).rejects.toThrow("only runs change jobs");
    await expect(engine.startJob("haunted-todo", "g")).resolves.toMatchObject({ taskId: expect.any(String) });
    engine.close();
  });
});

describe("HttpEngineLink and the kinds", () => {
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

  it("sends kind and target only for a job that is not a change", async () => {
    const { engine, seen } = link(() => json(201, { taskId: "task-1" }));
    await engine.startJob("my-app", "g");
    await engine.startJob("my-app", "g", { kind: "change" });
    await engine.startJob("my-app", "Review x", { kind: "review-branch", target: "feature/x" });
    expect(seen.map((s) => s.body)).toEqual([
      { repoId: "my-app", goal: "g" },
      { repoId: "my-app", goal: "g" },
      { repoId: "my-app", goal: "Review x", kind: "review-branch", target: "feature/x" },
    ]);
    engine.close();
  });

  it("reads the branches of a project and checks the answer", async () => {
    const { engine, seen } = link((url) =>
      url.includes("bad") ? json(200, { current: "main" }) : json(200, { current: "main", branches: ["main", "feature/x"] }),
    );
    expect(await engine.listBranches("my-app")).toEqual({ current: "main", branches: ["main", "feature/x"] });
    expect(seen[0]).toMatchObject({ method: "GET", url: "/projects/my-app/branches" });
    await expect(engine.listBranches("bad")).rejects.toThrow();
    engine.close();
  });

  it("gives the job view the kind and target from the export", async () => {
    const exp = {
      version: 1,
      recordedAt: 1,
      job: { taskId: "task-1", repoId: "my-app", goal: "Review x", kind: "review-branch", target: "feature/x", state: "reviewing", steps: [], approvals: [], artifacts: [] },
      events: [],
      artifacts: [],
    };
    const { engine } = link(() => json(200, exp));
    expect(await engine.getJob("task-1")).toMatchObject({ kind: "review-branch", target: "feature/x" });
    engine.close();
  });
});
