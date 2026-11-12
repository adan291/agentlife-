import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ServerMsgSchema } from "@agentlife/shared";
import type { ClientMsg, ServerMsg } from "@agentlife/shared";
import { startEngine } from "../src/engine.ts";
import { createRuntimeSteps } from "../src/jobs/runtime-steps.ts";
import { FakeRuntime } from "../src/runtimes/fake.ts";
// The whole chain of the hotel, in one process: client socket -> world-server gateway -> HTTP/SSE -> engine.
import { startGateway } from "../../world-server/src/gateway.ts";
import type { Gateway } from "../../world-server/src/gateway.ts";
import { HttpEngineLink } from "../../world-server/src/http-engine.ts";
import { testHotel } from "../../world-server/test/helpers.ts";
import { addBranch, demoRepo, registryFor, states, useSandbox, userRepoState } from "./job-types-helpers.ts";

/** A WebSocket client that keeps every server message. */
class Client {
  readonly received: ServerMsg[] = [];
  private readonly ws: WebSocket;
  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.addEventListener("message", (ev) => {
      this.received.push(ServerMsgSchema.parse(JSON.parse(String(ev.data))));
    });
  }
  static async open(port: number): Promise<Client> {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve(), { once: true });
      ws.addEventListener("error", () => reject(new Error("cannot connect to the gateway")), { once: true });
    });
    return new Client(ws);
  }
  send(msg: ClientMsg): void {
    this.ws.send(JSON.stringify(msg));
  }
  close(): void {
    this.ws.close();
  }
  /** The newest message of a type. */
  last<T extends ServerMsg["type"]>(type: T): Extract<ServerMsg, { type: T }> | undefined {
    return this.received.findLast((m) => m.type === type) as Extract<ServerMsg, { type: T }> | undefined;
  }
  has(type: ServerMsg["type"]): boolean {
    return this.received.some((m) => m.type === type);
  }
  async until(what: string, pred: () => boolean, ms = 8000): Promise<void> {
    const end = Date.now() + ms;
    while (!pred()) {
      if (Date.now() > end) throw new Error(`timed out waiting for ${what}; got: ${this.received.map((m) => m.type).join(", ")}`);
      await new Promise((r) => setTimeout(r, 5));
    }
  }
}

const gateways: Gateway[] = [];
const clients: Client[] = [];

describe("one scripted job per kind, from the user's socket to the engine and back", () => {
  const box = useSandbox();
  // Registered after the sandbox hook, so it runs first: the sockets and the gateway go before the engine.
  afterEach(async () => {
    for (const c of clients.splice(0)) c.close();
    for (const g of gateways.splice(0)) await g.close();
  });

  async function hotel(qa?: string) {
    const dir = await demoRepo(box);
    await addBranch(dir, "feature/login", { "src/login.js": "export const login = () => true;\n" });
    const reg = registryFor(box);
    const registered = await reg.register({ path: dir, name: "demo" });
    expect(registered.status).toBe("ok");
    const store = box.newStore();
    const runtimes = {
      architect: new FakeRuntime(),
      developer: new FakeRuntime(),
      qa: new FakeRuntime(qa ? { outputs: { qa } } : {}),
    };
    const engine = await startEngine({
      store,
      steps: createRuntimeSteps({ runtimes, store }),
      projects: reg,
      dataDir: path.join(box.tmp, "data"),
      port: 0,
    });
    box.engine = engine;
    const link = new HttpEngineLink({ baseUrl: `http://127.0.0.1:${engine.port}`, reconnectMs: 20 });
    const gateway = await startGateway({ hotel: testHotel({ start: "project:demo", projects: ["demo"] }), engine: link, port: 0, tickMs: 5 });
    gateways.push(gateway);
    const client = await Client.open(gateway.port);
    clients.push(client);
    await client.until("the welcome", () => client.has("welcome"));
    return { dir, engine, store, client };
  }

  /** Approves the plan when it arrives, waits for the report and for the job to settle. Returns the task id. */
  async function finish(h: Awaited<ReturnType<typeof hotel>>, approve: boolean): Promise<string> {
    const { client, engine } = h;
    if (approve) {
      await client.until("the plan approval", () => client.received.some((m) => m.type === "approval" && m.approval.status === "pending"));
      const pending = client.received.find((m) => m.type === "approval" && m.approval.status === "pending");
      if (pending?.type !== "approval") throw new Error("no approval");
      client.send({ type: "approve", approvalId: pending.approval.approvalId, decision: "approve" });
    }
    await client.until("the report", () => client.has("report"));
    const taskId = client.last("report")!.report.taskId;
    await engine.runner.done(taskId);
    await client.until("the delivered job", () => client.last("job_update")?.job.state === "delivered");
    return taskId;
  }

  it("review-branch: lists the branches, reviews one with no plan and no approval, and offers no delivery", async () => {
    const h = await hotel(JSON.stringify({ verdict: "pass", risk: "low", findings: [{ severity: "medium", text: "No test for login" }] }));
    const before = await userRepoState(h.dir);

    h.client.send({ type: "list_branches" });
    await h.client.until("the branch list", () => h.client.has("branches"));
    const list = h.client.last("branches")!;
    expect(list.projectId).toBe("demo");
    expect(list.current).toBe("main");
    expect([...list.branches].sort()).toEqual(["feature/login", "main"]);

    h.client.send({ type: "start_job", repoId: "demo", goal: "Review branch feature/login", kind: "review-branch", target: "feature/login" });
    const taskId = await finish(h, false);

    expect(h.client.has("approval")).toBe(false);
    expect(states(h.store, taskId)).toEqual(["reviewing", "testing", "report_ready", "delivered"]);
    const report = h.client.last("report")!.report;
    expect(report.verdict).toBe("pass");
    expect(report.markdown).toContain("**Kind:** review-branch");
    expect(report.delivery).toBeUndefined();
    const view = h.client.last("job_update")!.job;
    expect(view).toMatchObject({ kind: "review-branch", target: "feature/login", repoId: "demo" });
    expect(h.store.getJob(taskId)).toMatchObject({ kind: "review-branch", target: "feature/login" });
    expect(await userRepoState(h.dir)).toEqual(before);

    // Nothing was written, so the engine has nothing to deliver either.
    const res = await fetch(`http://127.0.0.1:${h.engine.port}/tasks/${taskId}/deliver`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(res.status).toBe(409);
  });

  it("write-tests: plan, approval, develop, test, review, report", async () => {
    const h = await hotel();
    h.client.send({ type: "start_job", repoId: "demo", goal: "Write tests for src/util.js", kind: "write-tests", target: "src/util.js" });
    const taskId = await finish(h, true);

    expect(states(h.store, taskId)).toEqual(["analyzing", "awaiting_plan_approval", "developing", "testing", "reviewing", "report_ready", "delivered"]);
    const report = h.client.last("report")!.report;
    expect(report.verdict).toBe("pass");
    expect(report.markdown).toContain("**Kind:** write-tests");
    expect(h.client.last("job_update")!.job).toMatchObject({ kind: "write-tests", target: "src/util.js" });
  });

  it("document: research, approval, develop, review, report, and no test step", async () => {
    const h = await hotel();
    h.client.send({ type: "start_job", repoId: "demo", goal: "Document the build", kind: "document", target: "How the build works" });
    const taskId = await finish(h, true);

    expect(states(h.store, taskId)).toEqual(["analyzing", "awaiting_plan_approval", "developing", "reviewing", "report_ready", "delivered"]);
    const report = h.client.last("report")!.report;
    expect(report.markdown).toContain("**Kind:** document");
    expect(report.markdown).not.toContain("## Tests");
    expect(h.client.last("job_update")!.job).toMatchObject({ kind: "document", target: "How the build works" });
  });

  it("change: a start without a kind runs the original pipeline", async () => {
    const h = await hotel();
    h.client.send({ type: "start_job", repoId: "demo", goal: "Fix the thing" });
    const taskId = await finish(h, true);

    expect(states(h.store, taskId)).toEqual(["analyzing", "awaiting_plan_approval", "developing", "testing", "reviewing", "report_ready", "delivered"]);
    expect(h.client.last("report")!.report.markdown).not.toContain("**Kind:**");
    const view = h.client.last("job_update")!.job;
    expect(view.kind).toBeUndefined();
    expect(view.target).toBeUndefined();
  });

  it("refuses a branch the project does not have, and the floor stays free for the next job", async () => {
    const h = await hotel();
    h.client.send({ type: "start_job", repoId: "demo", goal: "Review branch nope", kind: "review-branch", target: "nope" });
    await h.client.until("the refusal", () => h.client.has("error"));
    expect(h.client.last("error")).toMatchObject({ message: expect.stringContaining("not a local branch") });

    h.client.send({ type: "start_job", repoId: "demo", goal: "Review branch feature/login", kind: "review-branch", target: "feature/login" });
    await finish(h, false);
    expect(h.client.last("job_update")!.job.kind).toBe("review-branch");
  });
});
