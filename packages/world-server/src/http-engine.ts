import {
  AgentEventSchema,
  DeliveryInfoSchema,
  ErrorResponseSchema,
  HealthResponseSchema,
  jobDetailsFromExport,
  ProjectSchema,
  RegisterProjectResultSchema,
  RepoSchema,
  RolesConfigResponseSchema,
  RunExportSchema,
  StartJobResponseSchema,
  type AgentEvent,
  type AgentId,
  type ApprovalDecision,
  type DeliveryInfo,
  type JobDetails,
  type JobView,
  type Project,
  type RegisterProjectBody,
  type RegisterProjectResult,
  type Repo,
} from "@agentlife/shared";
import { EventQueue } from "./engine-link.ts";
import type { EngineLink } from "./engine-link.ts";

export const ENGINE_TOKEN_HEADER = "x-agentlife-token";
const REQUEST_TIMEOUT_MS = 10_000;

export interface HttpEngineOptions {
  /** Engine base URL, e.g. http://127.0.0.1:8788. */
  baseUrl: string;
  /** Sent as `x-agentlife-token` when set. */
  token?: string | undefined;
  fetch?: typeof fetch;
  /** First reconnect delay in ms (doubles up to `maxReconnectMs`). Default 500. */
  reconnectMs?: number;
  maxReconnectMs?: number;
  /** Receives short diagnostics (never secrets). */
  onLog?: (message: string) => void;
}

/**
 * EngineLink over the engine's HTTP API and SSE stream. `events()` never ends until `close()`:
 * the stream reconnects with the last seen seq, so a short engine outage loses no events.
 */
export class HttpEngineLink implements EngineLink {
  private readonly base: string;
  private readonly token: string | undefined;
  private readonly fetchFn: typeof fetch;
  private readonly reconnectMs: number;
  private readonly maxReconnectMs: number;
  private readonly log: (message: string) => void;
  private readonly queue = new EventQueue<AgentEvent>();
  private readonly closer = new AbortController();
  private lastSeq: number | undefined;
  private started = false;

  constructor(opts: HttpEngineOptions) {
    this.base = opts.baseUrl.replace(/\/+$/, "");
    this.token = opts.token || undefined;
    this.fetchFn = opts.fetch ?? fetch;
    this.reconnectMs = opts.reconnectMs ?? 500;
    this.maxReconnectMs = opts.maxReconnectMs ?? 5000;
    this.log = opts.onLog ?? (() => {});
  }

  // ---- commands ----

  async listRepos(): Promise<Repo[]> {
    return RepoSchema.array().parse(await this.request("GET", "/repos"));
  }

  async startJob(repoId: string, goal: string): Promise<{ taskId: string }> {
    return StartJobResponseSchema.parse(await this.request("POST", "/tasks", { repoId, goal }));
  }

  /** Models per role from `GET /config/roles`; roles without a model are left out. */
  async roleModels(): Promise<Partial<Record<AgentId, string>>> {
    const cfg = RolesConfigResponseSchema.parse(await this.request("GET", "/config/roles"));
    const out: Partial<Record<AgentId, string>> = {};
    for (const role of ["architect", "developer", "qa"] as const) {
      const m = cfg[role].model;
      if (m) out[role] = m;
    }
    return out;
  }

  async resolveApproval(approvalId: string, decision: ApprovalDecision, note?: string): Promise<void> {
    await this.request("POST", `/approvals/${encodeURIComponent(approvalId)}`, { decision, ...(note ? { note } : {}) });
  }

  async listProjects(): Promise<Project[]> {
    return ProjectSchema.array().parse(await this.request("GET", "/projects"));
  }

  /** The engine answers 201, 200 or 400 with a `RegisterProjectResult`; all three are results, not failures. */
  async registerProject(body: RegisterProjectBody): Promise<RegisterProjectResult> {
    const { json } = await this.requestRaw("POST", "/projects", body);
    return RegisterProjectResultSchema.parse(json);
  }

  async removeProject(projectId: string): Promise<void> {
    await this.request("DELETE", `/projects/${encodeURIComponent(projectId)}`);
  }

  async deliver(taskId: string): Promise<DeliveryInfo> {
    return DeliveryInfoSchema.parse(await this.request("POST", `/tasks/${encodeURIComponent(taskId)}/deliver`, {}));
  }

  /** Builds the client-facing job view; the timeline comes from the job's state-change events. */
  async getJob(taskId: string): Promise<JobView> {
    const exp = RunExportSchema.parse(await this.request("GET", `/tasks/${encodeURIComponent(taskId)}/export`));
    return {
      taskId: exp.job.taskId,
      repoId: exp.job.repoId,
      goal: exp.job.goal,
      state: exp.job.state,
      timeline: exp.events.flatMap((e) =>
        e.type === "task.state_changed" ? [{ ts: e.ts, state: e.state, ...(e.reason ? { text: e.reason } : {}) }] : [],
      ),
    };
  }

  async getJobDetails(taskId: string): Promise<JobDetails> {
    return jobDetailsFromExport(RunExportSchema.parse(await this.request("GET", `/tasks/${encodeURIComponent(taskId)}/export`)));
  }

  events(): AsyncIterable<AgentEvent> {
    if (!this.started) {
      this.started = true;
      void this.pump();
    }
    return this.queue;
  }

  close(): void {
    this.closer.abort();
    this.queue.close();
  }

  // ---- HTTP helpers ----

  private headers(): Record<string, string> {
    return this.token ? { [ENGINE_TOKEN_HEADER]: this.token } : {};
  }

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const { ok, status, json } = await this.requestRaw(method, path, body);
    if (!ok) {
      const err = ErrorResponseSchema.safeParse(json);
      throw new Error(err.success ? (err.data.message ?? err.data.error) : `engine responded ${status}`);
    }
    return json;
  }

  /** Like `request` but returns the answer of any status instead of throwing on a non-2xx one. */
  private async requestRaw(method: string, path: string, body?: unknown): Promise<{ ok: boolean; status: number; json: unknown }> {
    const res = await this.fetchFn(this.base + path, {
      method,
      headers: { ...this.headers(), ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.any([this.closer.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
    });
    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    return { ok: res.ok, status: res.status, json };
  }

  // ---- SSE ----

  private async pump(): Promise<void> {
    let delay = this.reconnectMs;
    while (!this.closer.signal.aborted) {
      try {
        const health = HealthResponseSchema.parse(await this.request("GET", "/health"));
        // First connect: only new events. Engine database reset (lower seq): start over from its head.
        if (this.lastSeq === undefined || health.lastSeq < this.lastSeq) this.lastSeq = health.lastSeq;
        await this.stream(() => {
          delay = this.reconnectMs;
        });
      } catch (e) {
        if (this.closer.signal.aborted) break;
        this.log(`engine stream: ${e instanceof Error ? e.message : String(e)}`);
      }
      if (this.closer.signal.aborted) break;
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, delay);
        this.closer.signal.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
      });
      delay = Math.min(delay * 2, this.maxReconnectMs);
    }
    this.queue.close();
  }

  /** Reads one SSE connection until it ends. Throws on a bad status. */
  private async stream(onConnected: () => void): Promise<void> {
    const res = await this.fetchFn(`${this.base}/events?since=${this.lastSeq ?? 0}`, {
      headers: { ...this.headers(), accept: "text/event-stream" },
      signal: this.closer.signal,
    });
    if (!res.ok || !res.body) throw new Error(`engine /events responded ${res.status}`);
    onConnected();
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buf += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
        let idx: number;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          this.handleBlock(block);
        }
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
  }

  private handleBlock(block: string): void {
    let data = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("data:")) data += line.slice(5).replace(/^ /, "");
    }
    if (!data) return; // comment or heartbeat
    let parsed: ReturnType<typeof AgentEventSchema.safeParse>;
    try {
      parsed = AgentEventSchema.safeParse(JSON.parse(data));
    } catch {
      this.log("engine stream: dropped a message that is not JSON");
      return;
    }
    if (!parsed.success) {
      this.log("engine stream: dropped an invalid event");
      return;
    }
    const ev = parsed.data;
    if (this.lastSeq !== undefined && ev.seq <= this.lastSeq) return; // duplicate after a reconnect
    this.lastSeq = ev.seq;
    this.queue.push(ev);
  }
}
