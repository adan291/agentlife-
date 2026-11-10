import { WebSocketServer } from "ws";
import type { RawData, WebSocket } from "ws";
import {
  ClientMsgSchema,
  MAX_MESSAGES_PER_SECOND,
  MAX_MESSAGE_BYTES,
  PROTOCOL_VERSION,
  ServerMsgSchema,
} from "@agentlife/shared";
import type { AgentEvent, Approval, ErrorCode, Report, ServerMsg, WorldSim } from "@agentlife/shared";
import type { EngineLink } from "./engine-link.ts";

export interface GatewayOptions {
  sim: WorldSim;
  /** Source of jobs and agent events. Without it, job commands reply `engine_unavailable`. */
  engine?: EngineLink;
  host?: string;
  /** 0 picks an ephemeral port. */
  port?: number;
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
  const wss = new WebSocketServer({
    host: options.host ?? "127.0.0.1",
    port: options.port ?? 8787,
    maxPayload: MAX_MESSAGE_BYTES,
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

  const panelData = async (ws: WebSocket, panel: string) => {
    if (panel === "computer") {
      if (!engine) return sendError(ws, "engine_unavailable", "no engine connected");
      try {
        send(ws, { type: "repos", repos: await engine.listRepos() });
      } catch {
        sendError(ws, "engine_unavailable", "cannot list repositories");
      }
    } else if (panel === "mailbox") {
      for (const a of approvals.values()) send(ws, { type: "approval", approval: a });
      for (const r of reports.values()) send(ws, { type: "report", report: r });
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
          if (ws) await jobUpdate(ws);
          break;
        case "task.state_changed":
          if (ev.state === "cancelled" || ev.state === "delivered" || ev.state === "failed") dropPendingApprovals(ev.taskId);
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
          const r: Report = { reportId: ev.reportId, taskId: ev.taskId, title: ev.title, markdown: ev.markdown };
          reports.set(r.reportId, r);
          if (ws) send(ws, { type: "report", report: r });
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

  const resolveApproval = async (ws: WebSocket, approvalId: string, decision: "approve" | "reject", note?: string) => {
    if (!engine) return sendError(ws, "engine_unavailable", "no engine connected");
    if (approvals.get(approvalId)?.status !== "pending") return sendError(ws, "bad_message", "unknown or resolved approval");
    try {
      await engine.resolveApproval(approvalId, decision, note);
    } catch {
      sendError(ws, "engine_unavailable", "cannot resolve approval");
    }
  };

  const tick = setInterval(() => deliver(sim.dueMessages()), options.tickMs ?? 50);

  wss.on("connection", (ws) => {
    // One user session in the MVP: a second connection replaces the first.
    if (current) current.ws.close(4000, "replaced by a newer connection");
    const { you, welcome } = sim.join();
    current = { ws, userId: you };
    send(ws, welcome);

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
