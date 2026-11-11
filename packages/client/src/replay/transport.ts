import {
  ACTIVITY_BUFFER_SIZE,
  AGENT_IDS,
  Hotel,
  ServerMsgSchema,
  jobDetailsFromExport,
  projectIdOfRoom,
  projectRoomId,
  splitAgentId,
  statusOfJobState,
} from "@agentlife/shared";
import type {
  ActivityLine,
  AgentEvent,
  AgentId,
  AgentWork,
  Approval,
  ClientMsg,
  FloorStatus,
  JobDetails,
  JobState,
  JobView,
  Report,
  RoomDef,
  RoomId,
  RunExport,
  ServerMsg,
  StepName,
  WelcomeMsg,
} from "@agentlife/shared";
import type { ConnectionStatus, Transport } from "../transport.ts";
import { ReplayEngine } from "./engine.ts";

/** The room files of the hotel (the same three the world-server loads). */
export interface ReplayRooms {
  lobby: RoomDef;
  hr: RoomDef;
  /** Template of the project floors. */
  template: RoomDef;
}

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
 * world-server gateway: a `Hotel` (lobby, HR office and the recorded floor) for avatars and walks, `ReplayEngine` for
 * the recorded agent events, and the same bookkeeping as the gateway for panel data (approvals, reports, activity,
 * work, job view, floor status). The user starts on the recorded floor and can take the elevator to the others.
 * The scene and panels cannot tell it from a live connection.
 */
export class ReplayTransport implements Transport {
  private readonly exp: RunExport;
  private readonly rooms: ReplayRooms;
  /** Floor the run was recorded on (`project:<id>`). */
  private readonly floorRoom: RoomId;
  private readonly projectId: string;
  private readonly now: () => number;
  private readonly messageListeners = new Set<(msg: ServerMsg) => void>();
  private readonly statusListeners = new Set<(status: ConnectionStatus) => void>();
  private readonly stopTicker: () => void;
  private readonly models: Partial<Record<AgentId, string>> = {};
  private hotel: Hotel;
  private engine: ReplayEngine;
  private you = 1;
  private lastTick: number;
  private closed = false;
  private began = false;
  private lastFloorsKey = "";
  /** A report the user has not opened yet (cleared when the mailbox is opened), like the gateway's floor status. */
  private unread: "report_ready" | "failed" | null = null;

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

  constructor(exp: RunExport, rooms: ReplayRooms, options: ReplayTransportOptions = {}) {
    this.exp = exp;
    this.rooms = rooms;
    // Exports made before the hotel have no room id: the floor of a project is named after its repo.
    this.projectId = projectIdOfRoom(exp.roomId ?? "") ?? exp.job.repoId;
    this.floorRoom = projectRoomId(this.projectId);
    this.now = options.now ?? Date.now;
    this.lastTick = this.now();
    this.hotel = this.buildHotel();
    this.engine = new ReplayEngine(exp, this.now());
    // Model per role: from work events when the recording has them, otherwise from the steps of the job.
    const roleOfStep: Partial<Record<StepName, AgentId>> = { analyze: "architect", report: "architect", develop: "developer", review: "qa" };
    for (const s of exp.job.steps) {
      const role = roleOfStep[s.step];
      if (role && s.model && !this.models[role]) this.models[role] = s.model;
    }
    for (const ev of exp.events) {
      if (ev.type !== "agent.work" || !ev.model) continue;
      const role = splitAgentId(ev.agentId).agentId;
      if (!this.models[role]) this.models[role] = ev.model;
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
      case "go_to":
        return this.goTo(msg.roomId);
      case "activity_scope":
        return; // every recorded line belongs to the one recorded floor
      case "build_board":
      case "build_report":
        return; // the demo has no construction board data (the panel says so when it opens)
      default: {
        const room = this.userRoom();
        const sim = room ? this.hotel.sim(room) : undefined;
        if (room && sim) this.deliver(room, sim.handleIntent(this.you, msg));
      }
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
    this.hotel = this.buildHotel();
    this.approvals = new Map();
    this.reports = new Map();
    this.activity = [];
    this.works = new Map();
    this.timeline = [];
    this.jobState = null;
    this.currentStep = undefined;
    this.verdict = undefined;
    this.unread = null;
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
    const here = this.userRoom();
    for (const [roomId, sim] of this.hotel.entries()) {
      const msgs = sim.dueMessages();
      if (roomId === here) this.deliver(roomId, msgs);
    }
  }

  // ---- rooms ----

  /** The lobby, the HR office and the recorded floor; the user starts on the recorded floor. */
  private buildHotel(): Hotel {
    const hotel = new Hotel({ ...this.rooms, clock: this.now, startRoom: this.floorRoom });
    hotel.addProject({ id: this.projectId, name: this.projectId });
    return hotel;
  }

  private userRoom(): RoomId | undefined {
    return this.hotel.roomOf(this.you);
  }

  private onRecordedFloor(): boolean {
    return this.userRoom() === this.floorRoom;
  }

  /** The elevator, as in the gateway: only while the avatar stands in front of one. */
  private goTo(roomId: string): void {
    if (!this.hotel.has(roomId)) return this.error("bad_message", "unknown floor");
    if (roomId === this.userRoom()) return;
    if (!this.hotel.atElevator(this.you)) return this.error("bad_message", "use the elevator first");
    this.enterRoom(roomId);
  }

  private enterRoom(roomId: string): void {
    const welcome = this.hotel.moveUser(this.you, roomId);
    if (welcome) this.sendWelcome(welcome);
  }

  /** The status of every floor: the recorded floor follows the recorded job, the others are idle. */
  private floorStatuses(): FloorStatus[] {
    return this.hotel.floors().map((info) => {
      if (info.roomId !== this.floorRoom) return { roomId: info.roomId, name: info.name, kind: info.kind, status: "idle" as const };
      const base: ReturnType<typeof statusOfJobState> = this.jobState ? statusOfJobState(this.jobState) : { status: "idle" };
      const status = base.status === "idle" && this.unread ? this.unread : base.status;
      return { roomId: info.roomId, name: info.name, kind: info.kind, status, ...(status === "working" && base.who ? { who: base.who } : {}) };
    });
  }

  private pushFloors(force = false): void {
    const floors = this.floorStatuses();
    const key = JSON.stringify(floors);
    if (!force && key === this.lastFloorsKey) return;
    this.lastFloorsKey = key;
    this.emit({ type: "floors", floors });
  }

  // ---- commands ----

  private startJob(repoId: string): void {
    if (repoId !== this.engine.repoId) return this.error("bad_message", `unknown repository '${repoId}'`);
    if (!this.onRecordedFloor()) return this.error("bad_message", "start the job from the computer on the project's floor");
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
    const floorSim = this.hotel.sim(this.floorRoom);
    if (floorSim) this.deliver(this.floorRoom, floorSim.handleAgentEvent(ev));
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
        this.emitHere({ type: "approval", approval: a });
        break;
      }
      case "approval.resolved": {
        const a = this.approvals.get(ev.approvalId);
        if (a) {
          a.status = ev.decision === "approve" ? "approved" : "rejected";
          this.emitHere({ type: "approval", approval: a });
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
        this.unread = r.verdict === "fail" ? "failed" : "report_ready";
        this.emitHere({ type: "report", report: r });
        break;
      }
      case "agent.activity":
        this.pushActivity({
          ts: ev.ts,
          agentId: splitAgentId(ev.agentId).agentId,
          text: ev.text,
          taskId: ev.taskId,
          ...(this.currentStep ? { step: this.currentStep } : {}),
        });
        break;
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
        this.works.set(agentId, work);
        this.emitHere({ type: "work", agentId, work });
        break;
      }
      default:
        break;
    }
    this.pushFloors();
  }

  private dropPending(): void {
    for (const [id, a] of this.approvals) if (a.status === "pending") this.approvals.delete(id);
  }

  private pushActivity(line: ActivityLine): void {
    this.activity.push(line);
    if (this.activity.length > ACTIVITY_BUFFER_SIZE) this.activity.splice(0, this.activity.length - ACTIVITY_BUFFER_SIZE);
    this.emitHere({ type: "activity", line });
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
    if (job) this.emitHere({ type: "job_update", job });
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

  /** The welcome of a room: the first one joins the hotel; later ones come from `moveUser` (elevator, door). */
  private sendWelcome(moved?: WelcomeMsg): void {
    let welcome = moved;
    if (!welcome) {
      const joined = this.hotel.join();
      this.you = joined.you;
      welcome = joined.welcome;
    }
    const here = (welcome.roomId ?? welcome.room.id) === this.floorRoom;
    // What happened on the recorded floor (work, activity, pending plan, job) belongs to that floor only.
    const agents = welcome.agents.map((a) => {
      const work = here ? this.works.get(a.agentId) : undefined;
      return work ? { ...a, work } : a;
    });
    const models = Object.fromEntries(AGENT_IDS.flatMap((id) => (this.models[id] ? [[id, this.models[id]]] : [])));
    this.emit({
      ...welcome,
      agents,
      ...(Object.keys(models).length > 0 ? { models } : {}),
      ...(here && this.activity.length > 0 ? { activity: [...this.activity] } : {}),
    });
    if (here) {
      for (const a of this.approvals.values()) if (a.status === "pending") this.emit({ type: "approval", approval: a });
      this.emitJob();
    }
    this.pushFloors(true);
  }

  private error(code: "bad_message" | "busy", message: string): void {
    this.emit({ type: "error", code, message });
  }

  /** Output of the simulation of a room: dropped when the user is elsewhere. An `open_panel` is preceded by that panel's data, as the gateway does, and a door leads to its room. */
  private deliver(roomId: RoomId, msgs: ServerMsg[]): void {
    for (const m of msgs) {
      if (this.userRoom() !== roomId) return;
      if (m.type === "open_panel") {
        if (m.panel === "door") {
          const to = (m.data as { to?: unknown } | undefined)?.to;
          if (typeof to === "string" && this.hotel.has(to)) this.enterRoom(to);
          return;
        }
        this.panelData(m.panel);
      }
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
      if (this.unread) {
        this.unread = null;
        this.pushFloors();
      }
    } else if (panel === "board") {
      this.emitJob();
    } else if (panel === "elevator" || panel === "directory") {
      this.pushFloors(true);
    } else if (panel === "build") {
      this.emit({ type: "error", code: "engine_unavailable", message: "the construction board shows this repository's own build and is not part of the recorded demo" });
    }
  }

  /** Messages about the recorded job reach the user only on the recorded floor. */
  private emitHere(msg: ServerMsg): void {
    if (this.onRecordedFloor()) this.emit(msg);
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
