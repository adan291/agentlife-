import {
  ACTIVITY_BUFFER_SIZE,
  AGENT_IDS,
  ServerMsgSchema,
  WorldSim,
  jobDetailsFromExport,
} from "@agentlife/shared";
import type {
  ActivityLine,
  AgentEvent,
  AgentId,
  AgentWork,
  Approval,
  ClientMsg,
  JobDetails,
  JobState,
  JobView,
  Report,
  RoomDef,
  RunExport,
  ServerMsg,
  StepName,
} from "@agentlife/shared";
import type { ConnectionStatus, Transport } from "../transport.ts";
import { ReplayEngine } from "./engine.ts";

const STEP_OF_STATE: Partial<Record<JobState, StepName>> = {
  analyzing: "analyze",
  developing: "develop",
  testing: "test",
  reviewing: "review",
  report_ready: "report",
};

const END_STATES: readonly JobState[] = ["delivered", "failed", "cancelled"];

export const REPLAY_REJECT_NOTE = "The recorded run was approved, so it continues.";

export interface ReplayTransportOptions {
  /** Wall clock (ms). Drives the walks of the user avatar and the replay clock. */
  now?: () => number;
  /** Starts the periodic `tick`; returns a stop function. Default: `setInterval` every 50 ms. */
  startTicker?: (tick: () => void) => () => void;
  /**
   * Send the first `welcome` from a timer (default), so the page can finish wiring its listeners first.
   * Tests pass false and call `begin()`.
   */
  autoBegin?: boolean;
}

/**
 * Plays a recorded run in the browser behind the `Transport` interface. It takes the place of the
 * world-server gateway: `WorldSim` for avatars and walks, `ReplayEngine` for the recorded agent events,
 * and the same bookkeeping as the gateway for panel data (approvals, reports, activity, work, job view).
 * The scene and panels cannot tell it from a live connection.
 */
export class ReplayTransport implements Transport {
  private readonly exp: RunExport;
  private readonly room: RoomDef;
  private readonly now: () => number;
  private readonly messageListeners = new Set<(msg: ServerMsg) => void>();
  private readonly statusListeners = new Set<(status: ConnectionStatus) => void>();
  private readonly stopTicker: () => void;
  private readonly models: Partial<Record<AgentId, string>> = {};
  private sim: WorldSim;
  private engine: ReplayEngine;
  private you = 1;
  private lastTick: number;
  private closed = false;
  private began = false;

  // Panel data, mirrored from the recorded events like the gateway does.
  private approvals = new Map<string, Approval>();
  private reports = new Map<string, Report>();
  private activity: ActivityLine[] = [];
  private works = new Map<AgentId, AgentWork>();
  private timeline: JobView["timeline"] = [];
  private jobState: JobState | null = null;
  private currentStep: StepName | undefined;
  private verdict: "pass" | "fail" | undefined;
  private createdArtifacts = new Set<string>();
  private startedSteps = new Set<StepName>();

  constructor(exp: RunExport, room: RoomDef, options: ReplayTransportOptions = {}) {
    this.exp = exp;
    this.room = room;
    this.now = options.now ?? Date.now;
    this.lastTick = this.now();
    this.sim = new WorldSim(room, this.now);
    this.engine = new ReplayEngine(exp, this.now());
    // Model per role: from work events when the recording has them, otherwise from the steps of the job.
    const roleOfStep: Partial<Record<StepName, AgentId>> = { analyze: "architect", report: "architect", develop: "developer", review: "qa" };
    for (const s of exp.job.steps) {
      const role = roleOfStep[s.step];
      if (role && s.model && !this.models[role]) this.models[role] = s.model;
    }
    for (const ev of exp.events) {
      if (ev.type === "agent.work" && ev.model && !this.models[ev.agentId]) this.models[ev.agentId] = ev.model;
    }
    const startTicker = options.startTicker ?? ((tick) => {
      const h = setInterval(tick, 50);
      return () => clearInterval(h);
    });
    this.stopTicker = startTicker(() => this.tick());
    if (options.autoBegin ?? true) setTimeout(() => this.begin(), 0);
  }

  // ---- Transport ----

  send(msg: ClientMsg): void {
    if (this.closed || !this.began) return;
    switch (msg.type) {
      case "hello":
        return;
      case "start_job":
        return this.startJob(msg.repoId);
      case "approve":
        return this.resolve(msg.approvalId, msg.decision);
      case "job_details":
        return this.emit({ type: "job_details", details: this.details() });
      case "register_project":
        return this.emit({
          type: "register_result",
          result: { status: "error", code: "outside_allowed_roots", message: "Registering projects is off in the demo. Run AGENT LIFE on your computer to use the Reception." },
        });
      case "remove_project":
      case "deliver":
        return this.emit({ type: "error", code: "project_error", message: "This is a recorded run: nothing can be changed here." });
      default:
        this.deliver(this.sim.handleIntent(this.you, msg));
    }
  }

  onMessage(cb: (msg: ServerMsg) => void): () => void {
    this.messageListeners.add(cb);
    return () => this.messageListeners.delete(cb);
  }

  onStatus(cb: (status: ConnectionStatus) => void): () => void {
    this.statusListeners.add(cb);
    cb("open");
    return () => this.statusListeners.delete(cb);
  }

  close(): void {
    this.closed = true;
    this.stopTicker();
  }

  // ---- controls for the replay UI ----

  /** Sends the first `welcome`. Safe to call more than once. */
  begin(): void {
    if (this.began || this.closed) return;
    this.began = true;
    this.sendWelcome();
  }

  get speed(): number {
    return this.engine.speed;
  }

  setSpeed(speed: number): void {
    this.engine.setSpeed(speed);
  }

  /** The date the run was recorded. */
  get recordedAt(): Date {
    return new Date(this.exp.recordedAt);
  }

  get recordedGoal(): string {
    return this.engine.goal;
  }

  get recordedRepoId(): string {
    return this.engine.repoId;
  }

  get started(): boolean {
    return this.engine.started;
  }

  /** Back to an empty room; the judge starts the job again from the computer. */
  restart(): void {
    if (this.closed) return;
    this.engine.restart(this.now());
    this.sim = new WorldSim(this.room, this.now);
    this.approvals = new Map();
    this.reports = new Map();
    this.activity = [];
    this.works = new Map();
    this.timeline = [];
    this.jobState = null;
    this.currentStep = undefined;
    this.verdict = undefined;
    this.createdArtifacts = new Set();
    this.startedSteps = new Set();
    this.lastTick = this.now();
    this.sendWelcome();
  }

  /** Advances the replay clock and the walks. Called by the ticker; tests call it directly. */
  tick(): void {
    if (this.closed || !this.began) return;
    const t = this.now();
    const dt = t - this.lastTick;
    this.lastTick = t;
    for (const ev of this.engine.advance(dt)) this.onEvent(ev);
    this.deliver(this.sim.dueMessages());
  }

  // ---- commands ----

  private startJob(repoId: string): void {
    if (repoId !== this.engine.repoId) return this.error("bad_message", `unknown repository '${repoId}'`);
    if (this.engine.started) return this.error("busy", "the recorded run is already playing");
    this.lastTick = this.now();
    for (const ev of this.engine.start()) this.onEvent(ev);
  }

  private resolve(approvalId: string, decision: "approve" | "reject"): void {
    if (this.approvals.get(approvalId)?.status !== "pending") return this.error("bad_message", "unknown or resolved approval");
    const result = this.engine.resolveApproval(approvalId, decision);
    if (!result.accepted) return this.error("bad_message", "unknown or resolved approval");
    if (result.overridden) {
      const line: ActivityLine = { ts: this.now(), agentId: "architect", text: REPLAY_REJECT_NOTE, ...(this.currentStep ? { step: this.currentStep } : {}) };
      this.pushActivity(line);
    }
    this.lastTick = this.now();
    for (const ev of result.events) this.onEvent(ev);
  }

  // ---- recorded events ----

  private onEvent(ev: AgentEvent): void {
    this.deliver(this.sim.handleAgentEvent(ev));
    switch (ev.type) {
      case "task.created":
        this.approvals.clear();
        this.reports.clear();
        this.works.clear();
        this.timeline = [];
        this.jobState = "created";
        this.emitJob();
        break;
      case "task.state_changed": {
        this.jobState = ev.state;
        this.currentStep = STEP_OF_STATE[ev.state];
        if (this.currentStep) this.startedSteps.add(this.currentStep);
        this.timeline.push({ ts: ev.ts, state: ev.state, ...(ev.reason ? { text: ev.reason } : {}) });
        if (ev.state === "report_ready" && ev.reason?.startsWith("verdict:")) {
          const v = ev.reason.slice("verdict:".length);
          if (v === "pass" || v === "fail") this.verdict = v;
        }
        if (END_STATES.includes(ev.state)) {
          this.dropPending();
          this.works.clear();
        }
        this.emitJob();
        break;
      }
      case "task.failed":
      case "task.completed":
        this.dropPending();
        this.emitJob();
        break;
      case "artifact.created":
        this.createdArtifacts.add(ev.artifactId);
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
        this.approvals.set(a.approvalId, a);
        this.emit({ type: "approval", approval: a });
        break;
      }
      case "approval.resolved": {
        const a = this.approvals.get(ev.approvalId);
        if (a) {
          a.status = ev.decision === "approve" ? "approved" : "rejected";
          this.emit({ type: "approval", approval: a });
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
          ...(this.verdict ? { verdict: this.verdict } : {}),
        };
        this.reports.set(r.reportId, r);
        this.emit({ type: "report", report: r });
        break;
      }
      case "agent.activity":
        this.pushActivity({
          ts: ev.ts,
          agentId: ev.agentId,
          text: ev.text,
          taskId: ev.taskId,
          ...(this.currentStep ? { step: this.currentStep } : {}),
        });
        break;
      case "agent.work": {
        const { agentId, taskId, step, title, model, contextPct, filesRead, filesEdited, startedAt } = ev;
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
        this.works.set(agentId, work);
        this.emit({ type: "work", agentId, work });
        break;
      }
      default:
        break;
    }
  }

  private dropPending(): void {
    for (const [id, a] of this.approvals) if (a.status === "pending") this.approvals.delete(id);
  }

  private pushActivity(line: ActivityLine): void {
    this.activity.push(line);
    if (this.activity.length > ACTIVITY_BUFFER_SIZE) this.activity.splice(0, this.activity.length - ACTIVITY_BUFFER_SIZE);
    this.emit({ type: "activity", line });
  }

  // ---- views ----

  private jobView(): JobView | null {
    if (!this.jobState) return null;
    return {
      taskId: this.exp.job.taskId,
      repoId: this.exp.job.repoId,
      goal: this.exp.job.goal,
      state: this.jobState,
      timeline: [...this.timeline],
    };
  }

  private emitJob(): void {
    const job = this.jobView();
    if (job) this.emit({ type: "job_update", job });
  }

  /** The job card as far as the replay has come: later artifacts, steps and approvals are not revealed early. */
  private details(): JobDetails {
    const running = this.jobState ? STEP_OF_STATE[this.jobState] : undefined;
    const steps = this.exp.job.steps
      .filter((s) => this.startedSteps.has(s.step))
      .map((s) => {
        if (s.step !== running) return s;
        const { endedAt: _e, durationMs: _d, ...rest } = s;
        return { ...rest, status: "running" as const };
      });
    const approvals = this.exp.job.approvals
      .filter((a) => this.approvals.has(a.approvalId))
      .map((a) => ({ ...a, status: this.approvals.get(a.approvalId)!.status }));
    const artifacts = this.exp.job.artifacts.filter((a) => this.createdArtifacts.has(a.artifactId));
    return jobDetailsFromExport({
      ...this.exp,
      job: { ...this.exp.job, state: this.jobState ?? "created", steps, approvals, artifacts },
      artifacts: this.exp.artifacts.filter((a) => this.createdArtifacts.has(a.id)),
    });
  }

  // ---- output ----

  private sendWelcome(): void {
    const { you, welcome } = this.sim.join();
    this.you = you;
    const agents = welcome.agents.map((a) => {
      const work = this.works.get(a.agentId);
      return work ? { ...a, work } : a;
    });
    const models = Object.fromEntries(AGENT_IDS.flatMap((id) => (this.models[id] ? [[id, this.models[id]]] : [])));
    this.emit({
      ...welcome,
      agents,
      ...(Object.keys(models).length > 0 ? { models } : {}),
      ...(this.activity.length > 0 ? { activity: [...this.activity] } : {}),
    });
  }

  private error(code: "bad_message" | "busy", message: string): void {
    this.emit({ type: "error", code, message });
  }

  /** Simulation output; an `open_panel` is preceded by that panel's data, as the gateway does. */
  private deliver(msgs: ServerMsg[]): void {
    for (const m of msgs) {
      if (m.type === "open_panel") this.panelData(m.panel);
      this.emit(m);
    }
  }

  private panelData(panel: string): void {
    if (panel === "computer") {
      this.emit({
        type: "repos",
        repos: [{ id: this.exp.job.repoId, name: this.exp.job.repoId, description: "Recorded run. The goal is fixed." }],
      });
    } else if (panel === "reception") {
      this.emit({
        type: "projects",
        projects: [{ id: this.exp.job.repoId, name: this.exp.job.repoId, stack: "node-npm", testCommand: "npm test", builtin: true, registeredAt: 0 }],
      });
    } else if (panel === "mailbox") {
      for (const a of this.approvals.values()) this.emit({ type: "approval", approval: a });
      for (const r of this.reports.values()) this.emit({ type: "report", report: r, resend: true });
    } else if (panel === "board") {
      this.emitJob();
    }
  }

  private emit(msg: ServerMsg): void {
    if (this.closed) return;
    const parsed = ServerMsgSchema.safeParse(msg);
    if (!parsed.success) {
      console.warn("dropped invalid replay message", parsed.error.issues[0]?.message);
      return;
    }
    for (const cb of this.messageListeners) cb(parsed.data);
  }
}
