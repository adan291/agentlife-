import { WebSocketServer } from "ws";
import type { RawData, WebSocket } from "ws";
import {
  ACTIVITY_BUFFER_SIZE,
  ClientMsgSchema,
  MAX_MESSAGES_PER_SECOND,
  MAX_MESSAGE_BYTES,
  PROTOCOL_VERSION,
  ServerMsgSchema,
  splitAgentId,
} from "@agentlife/shared";
import type { ActivityLine, AgentEvent, AgentId, AgentWork, Approval, ErrorCode, JobState, RegisterProjectBody, Report, ServerMsg, StepName, WorldSim } from "@agentlife/shared";
import type { EngineLink } from "./engine-link.ts";
import { checkOrigin, normalizeOrigin, parseAllowedOrigins } from "./origin.ts";

const STEP_OF_STATE: Partial<Record<JobState, StepName>> = {
  analyzing: "analyze",
  developing: "develop",
  testing: "test",
  reviewing: "review",
  report_ready: "report",
};

export interface GatewayOptions {
  sim: WorldSim;
  /** Source of jobs and agent events. Without it, job commands reply `engine_unavailable`. */
  engine?: EngineLink;
  host?: string;
  /** 0 picks an ephemeral port. */
  port?: number;
  /**
   * Origins allowed to open a WebSocket (security audit M3). Default: the Vite dev server on localhost and
   * 127.0.0.1, port 5173. A request without Origin is accepted only when `host` is a loopback address.
   */
  allowedOrigins?: readonly string[];
  /** Milliseconds between checks for deferred sim messages. */
  tickMs?: number;
  /** Clock for the rate limiter. */
  clock?: () => number;
}

export interface Gateway {
  readonly port: number;
  close(): Promise<void>;
}

/** Token bucket: `rate` tokens per second, burst of `rate`. */
export class TokenBucket {
  private tokens: number;
  private last: number;
  private readonly rate: number;
  private readonly clock: () => number;
  // No parameter properties: node's type stripping does not support them.
  constructor(rate: number, clock: () => number) {
    this.rate = rate;
    this.clock = clock;
    this.tokens = rate;
    this.last = clock();
  }
  take(): boolean {
    const now = this.clock();
    this.tokens = Math.min(this.rate, this.tokens + ((now - this.last) / 1000) * this.rate);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

export function startGateway(options: GatewayOptions): Promise<Gateway> {
  const { sim } = options;
  const clock = options.clock ?? Date.now;
  const bindHost = options.host ?? "127.0.0.1";
  const allowedOrigins = (options.allowedOrigins ?? parseAllowedOrigins(undefined)).map(normalizeOrigin);
  const wss = new WebSocketServer({
    host: bindHost,
    port: options.port ?? 8787,
    maxPayload: MAX_MESSAGE_BYTES,
    verifyClient: (info, done) => {
      if (checkOrigin(info.req.headers.origin, { allowed: allowedOrigins, bindHost })) return done(true);
      done(false, 403, "Forbidden");
    },
  });

  let current: { ws: WebSocket; userId: number } | null = null;
  const currentWs = (): WebSocket | undefined => current?.ws;

  const send = (ws: WebSocket, msg: ServerMsg) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(ServerMsgSchema.parse(msg)));
  };
  const sendError = (ws: WebSocket, code: ErrorCode, message: string) => send(ws, { type: "error", code, message });
  const engine = options.engine;

  // Panel data and job state mirrored from engine events, so a panel can be filled when it opens.
  const approvals = new Map<string, Approval>();
  const reports = new Map<string, Report>();
  /** Last activity lines, newest last. Sent in `welcome` so a reload does not start with an empty terminal. */
  const activity: ActivityLine[] = [];
  /** What each agent works on now (latest `agent.work`), sent in `welcome` so a reload keeps the team bar block. */
  const works = new Map<AgentId, AgentWork>();
  /** Step of the current job, from its latest state change. Tags activity lines (`awaiting_plan_approval` and the end states have none). */
  let currentStep: StepName | undefined;
  /** QA verdict per job, from the `verdict:pass|fail` reason of the transition into `report_ready`. Only the current job is kept. */
  const verdicts = new Map<string, "pass" | "fail">();
  let currentTaskId: string | null = null;
  let jobActive = false;

  /** Serialises outgoing messages so panel data always precedes its `open_panel`. */
  let outbox: Promise<void> = Promise.resolve();
  const enqueue = (task: () => Promise<void> | void) => {
    outbox = outbox.then(task).catch(() => undefined);
  };

  const jobUpdate = async (ws: WebSocket) => {
    if (!engine || !currentTaskId) return;
    try {
      send(ws, { type: "job_update", job: await engine.getJob(currentTaskId) });
    } catch {
      sendError(ws, "engine_unavailable", "cannot read job state");
    }
  };

  /** Reception data. Project paths never get this far: the engine only returns id, name, stack and test command. */
  const sendProjects = async (ws: WebSocket) => {
    if (!engine?.listProjects) return sendError(ws, "engine_unavailable", "no engine connected");
    try {
      send(ws, { type: "projects", projects: await engine.listProjects() });
    } catch {
      sendError(ws, "engine_unavailable", "cannot list projects");
    }
  };

  /** After a project was added or removed: the Reception list and the computer panel's repository list. */
  const sendProjectLists = async (ws: WebSocket) => {
    await sendProjects(ws);
    if (!engine) return;
    try {
      send(ws, { type: "repos", repos: await engine.listRepos() });
    } catch {
      sendError(ws, "engine_unavailable", "cannot list repositories");
    }
  };

  const errorText = (e: unknown, fallback: string): string => (e instanceof Error && e.message ? e.message.slice(0, 200) : fallback);

  const panelData = async (ws: WebSocket, panel: string) => {
    if (panel === "computer") {
      if (!engine) return sendError(ws, "engine_unavailable", "no engine connected");
      try {
        send(ws, { type: "repos", repos: await engine.listRepos() });
      } catch {
        sendError(ws, "engine_unavailable", "cannot list repositories");
      }
    } else if (panel === "reception") {
      await sendProjects(ws);
    } else if (panel === "mailbox") {
      for (const a of approvals.values()) send(ws, { type: "approval", approval: a });
      for (const r of reports.values()) send(ws, { type: "report", report: r, resend: true });
    } else if (panel === "board") {
      await jobUpdate(ws);
    }
  };

  /** Send simulation output; `open_panel` is preceded by the panel's data. */
  const deliver = (msgs: ServerMsg[]) => {
    if (msgs.length === 0) return;
    const target = current?.ws;
    if (!target) return;
    enqueue(async () => {
      for (const m of msgs) {
        if (m.type === "open_panel") await panelData(target, m.panel);
        send(target, m);
      }
    });
  };

  /** A finished, failed or cancelled job can no longer be approved; keep its resolved approvals
   *  (history) but drop the pending ones so the mailbox never offers a dead Approve button. */
  const dropPendingApprovals = (taskId: string) => {
    for (const [id, a] of approvals) if (a.taskId === taskId && a.status === "pending") approvals.delete(id);
  };

  const onEngineEvent = (ev: AgentEvent) => {
    deliver(sim.handleAgentEvent(ev));
    enqueue(async () => {
      const ws = current?.ws;
      switch (ev.type) {
        case "task.created":
          currentTaskId = ev.taskId;
          jobActive = true;
          approvals.clear();
          reports.clear();
          works.clear();
          currentStep = undefined;
          verdicts.clear();
          if (ws) await jobUpdate(ws);
          break;
        case "task.state_changed":
          if (ev.taskId === currentTaskId) currentStep = STEP_OF_STATE[ev.state];
          if (ev.state === "report_ready" && ev.reason?.startsWith("verdict:")) {
            const v = ev.reason.slice("verdict:".length);
            if (v === "pass" || v === "fail") verdicts.set(ev.taskId, v);
          }
          if (ev.state === "cancelled" || ev.state === "delivered" || ev.state === "failed") {
            dropPendingApprovals(ev.taskId);
            if (ev.taskId === currentTaskId) works.clear();
          }
          // The engine ends a rejected or cancelled job with `cancelled` only (no task.failed/completed).
          if ((ev.state === "cancelled" || ev.state === "delivered") && ev.taskId === currentTaskId) jobActive = false;
          if (ws && ev.taskId === currentTaskId) await jobUpdate(ws);
          break;
        case "task.failed":
        case "task.completed":
          dropPendingApprovals(ev.taskId);
          if (ev.taskId === currentTaskId) jobActive = false;
          if (ws && ev.taskId === currentTaskId) await jobUpdate(ws);
          break;
        case "approval.requested": {
          const a: Approval = {
            approvalId: ev.approvalId,
            taskId: ev.taskId,
            kind: ev.kind,
            summary: ev.summary,
            status: "pending",
            ...(ev.options ? { options: ev.options } : {}),
          };
          approvals.set(a.approvalId, a);
          if (ws) send(ws, { type: "approval", approval: a });
          break;
        }
        case "approval.resolved": {
          const a = approvals.get(ev.approvalId);
          if (a) {
            a.status = ev.decision === "approve" ? "approved" : "rejected";
            if (ws) send(ws, { type: "approval", approval: a });
          }
          break;
        }
        case "report.ready": {
          const r: Report = {
            reportId: ev.reportId,
            taskId: ev.taskId,
            title: ev.title,
            markdown: ev.markdown,
            ts: ev.ts,
            ...(verdicts.has(ev.taskId) ? { verdict: verdicts.get(ev.taskId)! } : {}),
          };
          // The job card tells whether the job's branch can be delivered to the user's repository.
          if (engine?.getJobDetails) {
            try {
              const { job } = await engine.getJobDetails(ev.taskId);
              if (job.delivery) r.delivery = { state: "done", branch: job.delivery.branch, commit: job.delivery.commit };
              else if (job.deliverable) r.delivery = { state: "available" };
            } catch {
              // No delivery button, the report itself still arrives.
            }
          }
          reports.set(r.reportId, r);
          if (current?.ws) send(current.ws, { type: "report", report: r });
          break;
        }
        case "agent.activity": {
          const line: ActivityLine = {
            ts: ev.ts,
            agentId: splitAgentId(ev.agentId).agentId,
            text: ev.text,
            taskId: ev.taskId,
            ...(currentStep && ev.taskId === currentTaskId ? { step: currentStep } : {}),
          };
          activity.push(line);
          if (activity.length > ACTIVITY_BUFFER_SIZE) activity.splice(0, activity.length - ACTIVITY_BUFFER_SIZE);
          if (ws) send(ws, { type: "activity", line });
          break;
        }
        case "agent.work": {
          const { taskId, step, title, model, contextPct, filesRead, filesEdited, startedAt } = ev;
          const agentId = splitAgentId(ev.agentId).agentId;
          const work: AgentWork = {
            taskId,
            step,
            title,
            ...(model ? { model } : {}),
            ...(contextPct === undefined ? {} : { contextPct }),
            filesRead,
            filesEdited,
            startedAt,
          };
          works.set(agentId, work);
          if (ws) send(ws, { type: "work", agentId, work });
          break;
        }
        default:
          break;
      }
    });
  };

  if (engine) {
    void (async () => {
      try {
        for await (const ev of engine.events()) onEngineEvent(ev);
      } catch {
        const ws = currentWs();
        if (ws) sendError(ws, "engine_unavailable", "engine event stream ended");
      }
    })();
  }

  const startJob = async (ws: WebSocket, repoId: string, goal: string) => {
    if (!engine) return sendError(ws, "engine_unavailable", "no engine connected");
    if (jobActive) return sendError(ws, "busy", "a job is already running");
    jobActive = true;
    try {
      const { taskId } = await engine.startJob(repoId, goal);
      currentTaskId = taskId;
    } catch (e) {
      jobActive = false;
      sendError(ws, "engine_unavailable", e instanceof Error ? e.message.slice(0, 200) : "cannot start job");
    }
  };

  const sendJobDetails = async (ws: WebSocket, taskId: string) => {
    if (!engine?.getJobDetails) return sendError(ws, "engine_unavailable", "no engine connected");
    try {
      send(ws, { type: "job_details", details: await engine.getJobDetails(taskId) });
    } catch {
      sendError(ws, "engine_unavailable", "cannot read job details");
    }
  };

  const resolveApproval = async (ws: WebSocket, approvalId: string, decision: "approve" | "reject", note?: string) => {
    if (!engine) return sendError(ws, "engine_unavailable", "no engine connected");
    if (approvals.get(approvalId)?.status !== "pending") return sendError(ws, "bad_message", "unknown or resolved approval");
    try {
      await engine.resolveApproval(approvalId, decision, note);
    } catch {
      sendError(ws, "engine_unavailable", "cannot resolve approval");
    }
  };

  const registerProject = async (ws: WebSocket, body: RegisterProjectBody) => {
    if (!engine?.registerProject) return sendError(ws, "engine_unavailable", "no engine connected");
    try {
      const result = await engine.registerProject(body);
      send(ws, { type: "register_result", result });
      if (result.status === "ok") await sendProjectLists(ws);
    } catch {
      sendError(ws, "project_error", "cannot register the project");
    }
  };

  const removeProject = async (ws: WebSocket, projectId: string) => {
    if (!engine?.removeProject) return sendError(ws, "engine_unavailable", "no engine connected");
    try {
      await engine.removeProject(projectId);
    } catch (e) {
      return sendError(ws, "project_error", errorText(e, "cannot remove the project"));
    }
    await sendProjectLists(ws);
  };

  /** Fetches the job's branch into the user's repository, then re-sends the report with its new delivery state. */
  const deliverJob = async (ws: WebSocket, taskId: string) => {
    if (!engine?.deliver) return sendError(ws, "engine_unavailable", "no engine connected");
    try {
      const info = await engine.deliver(taskId);
      for (const r of reports.values()) {
        if (r.taskId !== taskId) continue;
        r.delivery = { state: "done", branch: info.branch, commit: info.commit };
        send(ws, { type: "report", report: r, resend: true });
      }
    } catch (e) {
      sendError(ws, "delivery_failed", errorText(e, "cannot deliver the branch"));
    }
  };

  const tick = setInterval(() => deliver(sim.dueMessages()), options.tickMs ?? 50);

  // Model per role for the agent tooltips. Cached so the welcome stays synchronous; refreshed on every
  // connection (a reload picks up a late engine). Failures leave the cache as it was.
  let models: Partial<Record<AgentId, string>> | undefined;
  const refreshModels = () => {
    const link = engine;
    if (!link?.roleModels) return;
    link.roleModels().then(
      (m) => {
        if (Object.keys(m).length > 0) models = m;
      },
      () => undefined,
    );
  };
  refreshModels();

  wss.on("connection", (ws) => {
    // One user session in the MVP: a second connection replaces the first.
    if (current) current.ws.close(4000, "replaced by a newer connection");
    const { you, welcome } = sim.join();
    current = { ws, userId: you };
    const agents = welcome.agents.map((a) => {
      const work = works.get(a.agentId);
      return work ? { ...a, work } : a;
    });
    send(ws, { ...welcome, agents, ...(models ? { models } : {}), ...(activity.length > 0 ? { activity: [...activity] } : {}) });
    // A reload must still show the mailbox badge and the HUD line for a plan that waits.
    for (const a of approvals.values()) if (a.status === "pending") send(ws, { type: "approval", approval: a });
    // The progress stepper of a reloaded client needs the running job.
    if (currentTaskId) enqueue(() => jobUpdate(ws));
    refreshModels();

    const bucket = new TokenBucket(MAX_MESSAGES_PER_SECOND, clock);

    ws.on("message", (data: RawData, isBinary: boolean) => {
      if (!bucket.take()) return sendError(ws, "rate_limited", "too many messages");
      if (isBinary) return sendError(ws, "bad_message", "binary messages are not supported");
      let json: unknown;
      try {
        json = JSON.parse(rawToString(data));
      } catch {
        return sendError(ws, "bad_message", "invalid JSON");
      }
      const parsed = ClientMsgSchema.safeParse(json);
      if (!parsed.success) return sendError(ws, "bad_message", "invalid message");
      if (current?.ws !== ws) return;
      const msg = parsed.data;
      if (msg.type === "hello") {
        if (msg.protocol !== PROTOCOL_VERSION) sendError(ws, "bad_message", `protocol ${PROTOCOL_VERSION} required`);
        return;
      }
      if (msg.type === "start_job") {
        void startJob(ws, msg.repoId, msg.goal);
      } else if (msg.type === "approve") {
        void resolveApproval(ws, msg.approvalId, msg.decision, msg.note);
      } else if (msg.type === "job_details") {
        void sendJobDetails(ws, msg.taskId);
      } else if (msg.type === "register_project") {
        void registerProject(ws, {
          path: msg.path,
          name: msg.name,
          ...(msg.testCommand === undefined ? {} : { testCommand: msg.testCommand }),
          ...(msg.acceptFindings === undefined ? {} : { acceptFindings: msg.acceptFindings }),
        });
      } else if (msg.type === "remove_project") {
        void removeProject(ws, msg.projectId);
      } else if (msg.type === "deliver") {
        void deliverJob(ws, msg.taskId);
      } else {
        deliver(sim.handleIntent(current.userId, msg));
      }
    });

    ws.on("close", () => {
      if (current?.ws === ws) current = null;
    });
    ws.on("error", () => ws.terminate());
  });

  return new Promise((resolve, reject) => {
    wss.once("error", reject);
    wss.once("listening", () => {
      const addr = wss.address();
      const port = typeof addr === "object" && addr ? addr.port : (options.port ?? 0);
      resolve({
        port,
        close: () =>
          new Promise<void>((done) => {
            clearInterval(tick);
            engine?.close?.();
            for (const c of wss.clients) c.terminate();
            wss.close(() => done());
          }),
      });
    });
  });
}

function rawToString(data: RawData): string {
  if (typeof data === "string") return data;
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  return data.toString("utf8");
}
