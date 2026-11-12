import { WebSocketServer } from "ws";
import type { RawData, WebSocket } from "ws";
import {
  ACTIVITY_BUFFER_SIZE,
  ClientMsgSchema,
  GUEST_IDS,
  HR_ROOM,
  LOBBY_ROOM,
  MAX_MESSAGES_PER_SECOND,
  MAX_MESSAGE_BYTES,
  PROTOCOL_VERSION,
  SEATED_ROLES,
  ServerMsgSchema,
  morningReportId,
  morningTitle,
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
  ErrorCode,
  FloorStatus,
  GuestId,
  Hotel,
  HrAction,
  MemoryAction,
  JobState,
  MorningSummary,
  NightState,
  Project,
  RegisterProjectBody,
  Report,
  SeatedRole,
  ServerMsg,
  StepName,
  TeamMember,
  TeamRole,
  WelcomeMsg,
} from "@agentlife/shared";
import type { EngineLink, StartJobOptions } from "./engine-link.ts";
import { checkOrigin, normalizeOrigin, parseAllowedOrigins } from "./origin.ts";

const STEP_OF_STATE: Partial<Record<JobState, StepName>> = {
  analyzing: "analyze",
  developing: "develop",
  testing: "test",
  reviewing: "review",
  report_ready: "report",
};

export interface GatewayOptions {
  /** The rooms. Project floors are added and removed to match the engine's projects. */
  hotel: Hotel;
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
  /** Milliseconds between looks at the engine's night shift (summaries, window). Default 60000. */
  nightPollMs?: number;
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

/** What the gateway keeps for one floor: its job, approvals, reports, activity and what its agents work on. */
interface Floor {
  /** Panel data and job state mirrored from engine events, so a panel can be filled when it opens. */
  approvals: Map<string, Approval>;
  reports: Map<string, Report>;
  /** Last activity lines, newest last. Sent in `welcome` so a reload does not start with an empty terminal. */
  activity: ActivityLine[];
  /** What each agent works on now (latest `agent.work`), sent in `welcome` so a reload keeps the team bar block. */
  works: Map<AgentId, AgentWork>;
  /** Step of the current job, from its latest state change. Tags activity lines (`awaiting_plan_approval` and the end states have none). */
  currentStep: StepName | undefined;
  /** QA verdict per job, from the `verdict:pass|fail` reason of the transition into `report_ready`. Only the current job is kept. */
  verdicts: Map<string, "pass" | "fail">;
  currentTaskId: string | null;
  jobActive: boolean;
  /** State of the current job and its place in the queue: the floor status in the elevator panel. */
  jobState: JobState | undefined;
  queuePosition: number | undefined;
  /** A report the user has not opened yet (cleared when the mailbox of this floor is opened). */
  unread: "report_ready" | "failed" | null;
}

function newFloor(): Floor {
  return {
    approvals: new Map(),
    reports: new Map(),
    activity: [],
    works: new Map(),
    currentStep: undefined,
    verdicts: new Map(),
    currentTaskId: null,
    jobActive: false,
    jobState: undefined,
    queuePosition: undefined,
    unread: null,
  };
}

export function startGateway(options: GatewayOptions): Promise<Gateway> {
  const { hotel } = options;
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

  // Model per role for the agent tooltips. Cached so the welcome stays synchronous; refreshed on every
  // connection (a reload picks up a late engine). Failures leave the cache as it was.
  let models: Partial<Record<AgentId, string>> | undefined;

  let current: { ws: WebSocket; userId: number; activityAll: boolean } | null = null;
  const currentWs = (): WebSocket | undefined => current?.ws;

  const send = (ws: WebSocket, msg: ServerMsg) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(ServerMsgSchema.parse(msg)));
  };
  const sendError = (ws: WebSocket, code: ErrorCode, message: string) => send(ws, { type: "error", code, message });
  const engine = options.engine;

  const floors = new Map<string, Floor>();
  const floorOf = (roomId: string): Floor => {
    let f = floors.get(roomId);
    if (!f) floors.set(roomId, (f = newFloor()));
    return f;
  };
  /** Room of each job, learnt from `task.created`. */
  const taskRooms = new Map<string, string>();

  /** Room the connected user is in. */
  const userRoom = (): string | undefined => (current ? hotel.roomOf(current.userId) : undefined);
  /** Sends to the user only while the user is in that room: messages are scoped to the room (requirement 1.4). */
  const toUser = (roomId: string, msg: ServerMsg): void => {
    if (current && userRoom() === roomId) send(current.ws, msg);
  };

  /** Serialises outgoing messages so panel data always precedes its `open_panel`. */
  let outbox: Promise<void> = Promise.resolve();
  const enqueue = (task: () => Promise<void> | void) => {
    outbox = outbox.then(task).catch(() => undefined);
  };

  const sendJobUpdate = async (roomId: string) => {
    const taskId = floors.get(roomId)?.currentTaskId;
    if (!engine || !taskId) return;
    try {
      toUser(roomId, { type: "job_update", job: await engine.getJob(taskId) });
    } catch {
      toUser(roomId, { type: "error", code: "engine_unavailable", message: "cannot read job state" });
    }
  };

  // ---- floors ----

  const floorStatuses = (): FloorStatus[] =>
    hotel.floors().map((info) => {
      const f = floors.get(info.roomId);
      const base = f?.jobState ? statusOfJobState(f.jobState, f.queuePosition) : { status: "idle" as const };
      const status = base.status === "idle" && f?.unread ? f.unread : base.status;
      return {
        roomId: info.roomId,
        name: info.name,
        kind: info.kind,
        status,
        ...(status === "working" && "who" in base && base.who ? { who: base.who } : {}),
        ...(status === "queued" && "queuePosition" in base && base.queuePosition ? { queuePosition: base.queuePosition } : {}),
      };
    });

  let lastFloorsKey = "";
  /** Sends the floor list to the user when it changed (or `force`). */
  const pushFloors = (force = false): void => {
    const list = floorStatuses().slice(0, 100);
    const key = JSON.stringify(list);
    if (!force && key === lastFloorsKey) return;
    lastFloorsKey = key;
    if (current) send(current.ws, { type: "floors", floors: list });
  };

  /** Makes the rooms match the engine's projects: a floor for each project, none for a removed one. Never throws. */
  const syncProjects = async (): Promise<void> => {
    if (!engine?.listProjects) return;
    let projects: Project[];
    try {
      projects = await engine.listProjects();
    } catch {
      return; // keep the floors we have
    }
    const wanted = new Set(projects.map((p) => projectRoomId(p.id)));
    for (const p of projects) hotel.addProject({ id: p.id, name: p.name });
    for (const info of hotel.floors()) {
      if (info.kind !== "project" || wanted.has(info.roomId)) continue;
      const moved = hotel.removeProject(projectIdOfRoom(info.roomId)!);
      floors.delete(info.roomId);
      if (current) {
        for (const m of moved) if (m.userId === current.userId) sendWelcome(current.ws, LOBBY_ROOM, m.welcome);
      }
    }
    pushFloors();
  };

  // ---- panels ----

  /** Reception data. Project paths never get this far: the engine only returns id, name, stack and test command. */
  const sendProjects = async (ws: WebSocket) => {
    if (!engine?.listProjects) return sendError(ws, "engine_unavailable", "no engine connected");
    try {
      send(ws, { type: "projects", projects: await engine.listProjects() });
    } catch {
      sendError(ws, "engine_unavailable", "cannot list projects");
    }
  };

  /** Construction board data and verify reports: read-only, from the engine. */
  const sendBuildBoard = async (ws: WebSocket) => {
    if (!engine?.getBuildBoard) return sendError(ws, "engine_unavailable", "the construction board needs the real engine");
    try {
      send(ws, { type: "build_board", board: await engine.getBuildBoard() });
    } catch {
      sendError(ws, "engine_unavailable", "cannot read the construction board");
    }
  };

  const sendBuildReport = async (ws: WebSocket, spec: string) => {
    if (!engine?.getBuildReport) return sendError(ws, "engine_unavailable", "the construction board needs the real engine");
    try {
      send(ws, { type: "build_report", report: await engine.getBuildReport(spec) });
    } catch {
      sendError(ws, "engine_unavailable", "no verification report for that spec");
    }
  };

  // ---- night shift: morning summaries in the lobby mailbox ----

  /** Summaries written within this long count as news when the gateway first sees them; older ones are history. */
  const FRESH_SUMMARY_MS = 24 * 60 * 60 * 1000;
  /** Summary reports the user has not opened the lobby mailbox for yet. */
  const unopenedSummaries = new Set<string>();

  /**
   * Copies the engine's morning summaries into the lobby mailbox. A summary that is new, and recent, is announced like a
   * delivered report (badge, toast) when the user is in the lobby, and again on the next welcome into the lobby until
   * the mailbox is opened. Never throws.
   */
  const syncSummaries = async (): Promise<void> => {
    if (!engine?.getNightSummaries) return;
    let list: MorningSummary[];
    try {
      list = await engine.getNightSummaries();
    } catch {
      return; // keep what the mailbox has
    }
    const lobby = floorOf(LOBBY_ROOM);
    const news: Report[] = [];
    for (const s of [...list].reverse()) {
      const id = morningReportId(s.nightKey);
      const report: Report = { reportId: id, taskId: id, title: morningTitle(s.nightKey), markdown: s.markdown, ts: s.writtenAt, kind: "night" };
      const known = lobby.reports.has(id);
      lobby.reports.set(id, report);
      if (!known && Date.now() - s.writtenAt < FRESH_SUMMARY_MS) news.push(report);
    }
    for (const r of news) {
      unopenedSummaries.add(r.reportId);
      toUser(LOBBY_ROOM, { type: "report", report: r });
    }
    if (news.length > 0) {
      lobby.unread = "report_ready";
      pushFloors();
    }
  };

  // ---- night shift: the night board and the night look ----

  let lastClock = "";
  /** Tells the client whether the night window is open (dimmed rooms, moon clock). Sent when it changed, or when forced. Never throws. */
  const pushNightClock = async (force = false): Promise<void> => {
    if (!engine?.getNight || !current) return;
    let state: NightState;
    try {
      state = await engine.getNight();
    } catch {
      return;
    }
    const msg: ServerMsg = { type: "night_clock", open: state.open, start: state.config.start, end: state.config.end };
    const key = JSON.stringify(msg);
    if (!force && key === lastClock) return;
    lastClock = key;
    if (current) send(current.ws, msg);
  };

  const sendNight = async (ws: WebSocket): Promise<void> => {
    if (!engine?.getNight) return sendError(ws, "engine_unavailable", "the night shift needs the real engine");
    try {
      send(ws, { type: "night", state: await engine.getNight() });
    } catch {
      sendError(ws, "engine_unavailable", "cannot read the night schedule");
    }
  };

  /** Add, remove or move a night job. The board is in the lobby, so the user must be there; the answer is the new schedule. */
  const nightCommand = async (ws: WebSocket, run: (link: EngineLink) => Promise<void>): Promise<void> => {
    if (!engine?.getNight) return sendError(ws, "engine_unavailable", "the night shift needs the real engine");
    if (userRoom() !== LOBBY_ROOM) return sendError(ws, "bad_message", "the night board is in the lobby");
    try {
      await run(engine);
    } catch (e) {
      sendError(ws, "night_error", errorText(e, "the night schedule was not changed"));
    }
    await sendNight(ws);
  };

  /** The repositories the computer of a floor can start a job on: the floor's own project. */
  const sendRepos = async (ws: WebSocket, roomId: string) => {
    if (!engine) return sendError(ws, "engine_unavailable", "no engine connected");
    try {
      const projectId = projectIdOfRoom(roomId);
      const repos = await engine.listRepos();
      send(ws, { type: "repos", repos: projectId === undefined ? repos : repos.filter((r) => r.id === projectId) });
    } catch {
      sendError(ws, "engine_unavailable", "cannot list repositories");
    }
  };

  /** After a project was added or removed: the floors, the Reception list and the computer panel's repository list. */
  const sendProjectLists = async (ws: WebSocket) => {
    await syncProjects();
    await sendProjects(ws);
    const room = userRoom();
    if (room && engine) await sendRepos(ws, room);
  };

  const errorText = (e: unknown, fallback: string): string => (e instanceof Error && e.message ? e.message.slice(0, 200) : fallback);

  /** The branches of the project on the user's floor, for the branch picker of the review desk. */
  const sendBranches = async (ws: WebSocket, roomId: string) => {
    const projectId = projectIdOfRoom(roomId);
    if (projectId === undefined) return sendError(ws, "bad_message", "the review desk is on a project's floor");
    if (!engine?.listBranches) return sendError(ws, "engine_unavailable", "listing branches needs the real engine");
    try {
      send(ws, { type: "branches", projectId, ...(await engine.listBranches(projectId)) });
    } catch (e) {
      sendError(ws, "engine_unavailable", errorText(e, "cannot list the branches of the project"));
    }
  };

  const panelData = async (ws: WebSocket, roomId: string, panel: string) => {
    const f = floorOf(roomId);
    if (panel === "computer" || panel === "tests" || panel === "library") {
      await sendRepos(ws, roomId);
      if (panel === "library") await sendMemory(ws, true);
    } else if (panel === "review") {
      await sendRepos(ws, roomId);
      await sendBranches(ws, roomId);
    } else if (panel === "reception") {
      await sendProjects(ws);
    } else if (panel === "mailbox") {
      // The lobby's mailbox holds the morning summaries; ask the engine so a summary written a moment ago is there.
      if (roomId === LOBBY_ROOM) await syncSummaries();
      else await sendMemory(ws, true);
      for (const a of f.approvals.values()) send(ws, { type: "approval", approval: a });
      for (const r of f.reports.values()) send(ws, { type: "report", report: r, resend: true });
      if (roomId === LOBBY_ROOM) unopenedSummaries.clear();
      if (f.unread) {
        f.unread = null;
        pushFloors();
      }
    } else if (panel === "board") {
      await sendJobUpdate(roomId);
    } else if (panel === "elevator" || panel === "directory") {
      pushFloors(true);
    } else if (panel === "build") {
      await sendBuildBoard(ws);
    } else if (panel === "night") {
      // The form lists the hotel's projects, so they travel with the schedule.
      await sendProjects(ws);
      await sendNight(ws);
    } else if (panel === "hr") {
      await sendHr(ws);
    }
  };

  /** Welcome for a room, with that floor's work, activity, pending approvals and job, then the floor list. */
  const sendWelcome = (ws: WebSocket, roomId: string, welcome: WelcomeMsg) => {
    const f = floors.get(roomId);
    const agents = welcome.agents.map((a) => {
      const work = f?.works.get(a.agentId);
      return work ? { ...a, work } : a;
    });
    const lines = f?.activity ?? [];
    send(ws, { ...welcome, agents, ...(models ? { models } : {}), ...(lines.length > 0 ? { activity: [...lines] } : {}) });
    // A reload must still show the mailbox badge and the HUD line for a plan that waits.
    for (const a of f?.approvals.values() ?? []) if (a.status === "pending") send(ws, { type: "approval", approval: a });
    // A morning summary nobody opened yet is announced again to a client that just arrived in the lobby.
    if (roomId === LOBBY_ROOM) {
      for (const id of unopenedSummaries) {
        const report = f?.reports.get(id);
        if (report) send(ws, { type: "report", report });
      }
    }
    // The progress stepper of a reloaded client needs the running job.
    if (f?.currentTaskId) enqueue(() => sendJobUpdate(roomId));
    // A project floor shows who sits at each desk, and keeps the ghosts that have left by the elevator out of the room.
    const projectId = projectIdOfRoom(roomId);
    if (projectId !== undefined && engine?.hr) {
      for (const slot of SLOTS) if (absent.has(`${roomId}|${slot}`)) send(ws, { type: "agent_presence", agentId: slot, present: false });
      const view = teamViewMsg(projectId);
      if (view) send(ws, view);
      enqueue(() => refreshTeam(projectId, false));
    }
    pushFloors(true);
  };

  /** Moves the user to another room (elevator, door, removed floor) and sends that room's welcome. */
  const enterRoom = async (roomId: string): Promise<void> => {
    if (!current || roomId === userRoom()) return;
    const welcome = hotel.moveUser(current.userId, roomId);
    if (welcome) sendWelcome(current.ws, roomId, welcome);
  };

  /** Send simulation output of a room; `open_panel` is preceded by the panel's data, and a door enters its room. */
  const sendSim = async (roomId: string, msgs: ServerMsg[]): Promise<void> => {
    for (const m of msgs) {
      const target = current?.ws;
      if (!target || userRoom() !== roomId) return; // the user left the room meanwhile
      if (m.type === "open_panel") {
        if (m.panel === "door") {
          const to = (m.data as { to?: unknown } | undefined)?.to;
          if (typeof to === "string" && hotel.has(to)) await enterRoom(to);
          return;
        }
        await panelData(target, roomId, m.panel);
      }
      send(target, m);
    }
  };
  const deliver = (roomId: string, msgs: ServerMsg[]) => {
    if (msgs.length === 0) return;
    enqueue(() => sendSim(roomId, msgs));
  };

  // ---- the HR office and the people at the desks ----

  interface Seat {
    memberId: string;
    name: string;
    model?: string;
    role: TeamRole;
  }
  /** A desk of a role, or a standing spot (`guest1`..`guest6`). */
  type SlotId = SeatedRole | GuestId;
  const SLOTS: readonly SlotId[] = [...SEATED_ROLES, ...GUEST_IDS];
  const isGuestSlot = (slot: SlotId): slot is GuestId => (GUEST_IDS as readonly string[]).includes(slot);
  /** Desks always have an entry (the room label when nobody was hired); a spot has one only while somebody stands there. */
  type Seats = Map<SlotId, Seat>;
  /** Who works each desk according to the engine, and who the room shows (a ghost that is being replaced keeps its name until the new one walks in). */
  const seatsNow = new Map<string, Seats>();
  const seatsShown = new Map<string, Seats>();
  /** `<roomId>|<slot>` of the ghosts that have left by the elevator and are not back yet. */
  const absent = new Set<string>();
  const swapTimers = new Set<NodeJS.Timeout>();
  /** The label the room uses for a desk nobody was hired for. */
  const DEFAULT_SEAT_NAME: Record<SeatedRole, string> = { architect: "Architect", developer: "Developer", qa: "QA" };
  /** Where a member who holds no desk likes to stand: near the desk of their own role, else by the middle of the room. */
  const SPOT_PREFERENCE: Record<TeamRole, readonly GuestId[]> = {
    architect: ["guest1", "guest5", "guest6"],
    developer: ["guest2", "guest5", "guest6"],
    qa: ["guest3", "guest4", "guest6"],
    reviewer: ["guest5", "guest6", "guest4"],
    researcher: ["guest6", "guest5", "guest1"],
  };

  /**
   * The seats for a team: the first member of each seated role holds that role's desk, every other member stands at a
   * spot (hr-desk requirement 4.3: everybody hired is on the floor). A member keeps the spot they had (`previous`).
   */
  const seatsOf = (members: readonly TeamMember[], previous?: Seats): Seats => {
    const out: Seats = new Map();
    const seated = new Set<string>();
    for (const role of SEATED_ROLES) {
      const m = members.find((x) => x.role === role);
      if (m) seated.add(m.id);
      out.set(role, m ? { memberId: m.id, name: m.displayName, model: m.model, role } : { memberId: "", name: DEFAULT_SEAT_NAME[role], role });
    }
    const seatOf = (m: TeamMember): Seat => ({ memberId: m.id, name: m.displayName, model: m.model, role: m.role });
    const others = members.filter((m) => !seated.has(m.id));
    for (const spot of GUEST_IDS) {
      const kept = previous?.get(spot);
      const m = kept ? others.find((x) => x.id === kept.memberId) : undefined;
      if (m) out.set(spot, seatOf(m));
    }
    const placed = new Set([...out.values()].map((s) => s.memberId));
    for (const m of others) {
      if (placed.has(m.id)) continue;
      const spot = [...SPOT_PREFERENCE[m.role], ...GUEST_IDS].find((g) => !out.has(g));
      if (spot) out.set(spot, seatOf(m)); // a team has at most 8 members and 2 or more hold desks: there is always a spot
    }
    return out;
  };

  const teamViewMsg = (projectId: string): ServerMsg | undefined => {
    const shown = seatsShown.get(projectId);
    if (!shown) return undefined;
    return {
      type: "team_view",
      roomId: projectRoomId(projectId),
      members: SEATED_ROLES.map((role) => {
        const s = shown.get(role)!;
        return { agentId: role, name: s.name, ...(s.model ? { model: s.model } : {}) };
      }),
      guests: GUEST_IDS.flatMap((guestId) => {
        const s = shown.get(guestId);
        return s ? [{ guestId, name: s.name, role: s.role, ...(s.model ? { model: s.model } : {}) }] : [];
      }),
    };
  };

  /** Queued behind the walks and presence messages already waiting, so a ghost is told where it is before it is shown. */
  const pushTeamView = (projectId: string): void => {
    enqueue(() => {
      const msg = teamViewMsg(projectId);
      if (msg) toUser(projectRoomId(projectId), msg);
    });
  };

  /** Time a ghost needs to walk to a place, from the `walk` message the sim answered with. */
  const walkMs = (msgs: readonly ServerMsg[]): number => {
    const w = msgs.find((m) => m.type === "walk");
    return w && w.type === "walk" ? w.path.length * w.msPerTile : 0;
  };

  /** Somebody new takes a spot (or comes back to a desk): they walk in from the elevator to their place. */
  const walkIn = (projectId: string, slot: SlotId): void => {
    const roomId = projectRoomId(projectId);
    const back = hotel.sim(roomId)?.sendAgentTo(slot, "home") ?? [];
    deliver(roomId, [{ type: "agent_presence", agentId: slot, present: true }, ...back]);
  };

  /**
   * The ghost at this desk or spot was let go (or replaced): it walks to the elevator and leaves; its successor, if
   * there is one, comes back through it. A spot nobody takes stays empty.
   */
  const startSwap = (projectId: string, slot: SlotId): void => {
    const roomId = projectRoomId(projectId);
    const key = `${roomId}|${slot}`;
    if (absent.has(key)) return; // the coming-back step reads the newest team
    absent.add(key);
    const out = hotel.sim(roomId)?.sendAgentTo(slot, "door") ?? [];
    deliver(roomId, [...out, { type: "agent_presence", agentId: slot, present: false }]);
    const timer = setTimeout(
      () => {
        swapTimers.delete(timer);
        enqueue(() => {
          absent.delete(key);
          const seat = seatsNow.get(projectId)?.get(slot);
          if (seat) {
            seatsShown.get(projectId)?.set(slot, seat);
            walkIn(projectId, slot);
          } else {
            seatsShown.get(projectId)?.delete(slot);
          }
          pushTeamView(projectId);
        });
      },
      walkMs(out) + 700,
    );
    timer.unref();
    swapTimers.add(timer);
  };

  /**
   * Reads a project's team and shows it in the room: names and models on the ghosts, and, when `announce` is set and
   * somebody else now sits at a desk, the old ghost leaves and the new one walks in. Members at the spots always walk
   * in and out (they have no job to keep still for). Never throws.
   */
  const refreshTeam = async (projectId: string, announce: boolean): Promise<void> => {
    const hr = engine?.hr;
    if (!hr || !hotel.has(projectRoomId(projectId))) return;
    let team;
    try {
      team = await hr.team(projectId);
    } catch {
      return;
    }
    const next = seatsOf(team.members, seatsNow.get(projectId));
    seatsNow.set(projectId, next);
    const shown = seatsShown.get(projectId);
    if (!shown) {
      seatsShown.set(projectId, new Map(next));
      for (const slot of GUEST_IDS) if (next.has(slot)) walkIn(projectId, slot);
    } else {
      for (const slot of SLOTS) {
        const n = next.get(slot);
        const s = shown.get(slot);
        if (!isGuestSlot(slot)) {
          if (n!.memberId === s!.memberId || !announce) shown.set(slot, n!);
          else startSwap(projectId, slot);
        } else if (n && s && n.memberId === s.memberId) {
          shown.set(slot, n);
        } else if (n && s) {
          startSwap(projectId, slot); // somebody else takes the spot
        } else if (n) {
          if (!absent.has(`${projectRoomId(projectId)}|${slot}`)) {
            shown.set(slot, n);
            walkIn(projectId, slot);
          }
        } else if (s) {
          startSwap(projectId, slot); // let go
        }
      }
    }
    pushTeamView(projectId);
  };

  const sendHr = async (ws: WebSocket): Promise<void> => {
    if (!engine?.hr) return sendError(ws, "engine_unavailable", "the HR office needs the real engine");
    try {
      send(ws, { type: "hr", state: await engine.hr.state() });
    } catch (e) {
      sendError(ws, "engine_unavailable", errorText(e, "cannot read the HR desk"));
    }
  };

  /** Runs one HR action for the user in the HR office, then sends the desk's new state. */
  const hrAct = async (ws: WebSocket, act: HrAction): Promise<void> => {
    const hr = engine?.hr;
    if (!hr) return sendError(ws, "engine_unavailable", "the HR office needs the real engine");
    if (userRoom() !== HR_ROOM) return sendError(ws, "bad_message", "the HR desk is in the HR office");
    try {
      // Know who sits at the desks before the change, so a change of person can be shown.
      if (act.action === "hire" || act.action === "update" || act.action === "fire" || act.action === "apply") await refreshTeam(act.projectId, false);
      switch (act.action) {
        case "hire":
          await hr.hire(act.projectId, { templateId: act.templateId, displayName: act.displayName, ...(act.model ? { model: act.model } : {}) });
          await refreshTeam(act.projectId, true);
          break;
        case "update":
          await hr.update(act.projectId, act.memberId, {
            ...(act.displayName === undefined ? {} : { displayName: act.displayName }),
            ...(act.model === undefined ? {} : { model: act.model }),
          });
          await refreshTeam(act.projectId, true);
          break;
        case "fire":
          await hr.fire(act.projectId, act.memberId);
          await refreshTeam(act.projectId, true);
          break;
        case "import":
          await hr.importTemplate(act.url);
          break;
        case "approve_import":
          await hr.approveImport(act.id, act.hash);
          break;
        case "reject_import":
          await hr.rejectImport(act.id);
          break;
        case "suggest": {
          send(ws, { type: "hr_suggestion", suggestion: await hr.suggest(act.projectId) });
          return;
        }
        case "apply":
          // Each pick is a hire; the member it replaces leaves afterwards, so the team never lacks a role.
          try {
            for (const pick of act.picks) {
              await hr.hire(act.projectId, { templateId: pick.templateId, displayName: pick.displayName, model: pick.model });
              if (pick.replacesId) await hr.fire(act.projectId, pick.replacesId);
            }
          } finally {
            await refreshTeam(act.projectId, true);
          }
          break;
      }
    } catch (e) {
      sendError(ws, "hr_error", errorText(e, "the HR desk could not do that"));
    }
    await sendHr(ws);
  };

  // ---- the Library: what the team of a project remembers ----

  /** The memory of the project on the user's floor. `quiet` skips the error when there is nothing to show (the mailbox asks for it too). */
  const sendMemory = async (ws: WebSocket, quiet = false): Promise<void> => {
    const room = userRoom();
    const projectId = room === undefined ? undefined : projectIdOfRoom(room);
    if (projectId === undefined) return quiet ? undefined : sendError(ws, "bad_message", "the Library is on a project's floor");
    if (!engine?.memory) return quiet ? undefined : sendError(ws, "engine_unavailable", "the Library needs the real engine");
    try {
      send(ws, { type: "memory", projectId, state: await engine.memory.state(projectId) });
    } catch (e) {
      if (!quiet) sendError(ws, "engine_unavailable", errorText(e, "cannot read the Library"));
    }
  };

  /** One change to the Library of the user's project, then its new state. A refusal is shown as `memory_error`. */
  const memoryAct = async (ws: WebSocket, act: MemoryAction): Promise<void> => {
    const room = userRoom();
    const projectId = room === undefined ? undefined : projectIdOfRoom(room);
    if (projectId === undefined) return sendError(ws, "bad_message", "the Library is on a project's floor");
    const memory = engine?.memory;
    if (!memory) return sendError(ws, "engine_unavailable", "the Library needs the real engine");
    try {
      switch (act.action) {
        case "edit":
          await memory.edit(projectId, act.entryId, { ...(act.kind ? { kind: act.kind } : {}), ...(act.text === undefined ? {} : { text: act.text }) });
          break;
        case "delete":
          await memory.remove(projectId, act.entryId);
          break;
        case "accept":
          await memory.accept(projectId, act.proposalId, { ...(act.kind ? { kind: act.kind } : {}), ...(act.text === undefined ? {} : { text: act.text }) });
          break;
        case "dismiss":
          await memory.dismiss(projectId, act.proposalId);
          break;
        case "auto":
          await memory.setAutoRemember(projectId, act.autoRemember);
          break;
      }
    } catch (e) {
      sendError(ws, "memory_error", errorText(e, "the Library could not do that"));
    }
    await sendMemory(ws);
  };

  // ---- engine events ----

  /** A finished, failed or cancelled job can no longer be approved; keep its resolved approvals
   *  (history) but drop the pending ones so the mailbox never offers a dead Approve button. */
  const dropPendingApprovals = (f: Floor, taskId: string) => {
    for (const [id, a] of f.approvals) if (a.taskId === taskId && a.status === "pending") f.approvals.delete(id);
  };

  /** The room an event belongs to: the room of its job, else the project in its agent id, else the lobby (Builder). */
  const roomOfEvent = (ev: AgentEvent): string | undefined => {
    if (ev.type === "task.created") {
      const room = projectRoomId(ev.repoId);
      taskRooms.set(ev.taskId, room);
      return room;
    }
    const known = taskRooms.get(ev.taskId);
    if (known) return known;
    const agent = "agentId" in ev ? ev.agentId : undefined;
    if (!agent) return undefined;
    const { projectId, agentId } = splitAgentId(agent);
    if (projectId !== undefined) return projectRoomId(projectId);
    return agentId === "builder" ? LOBBY_ROOM : undefined;
  };

  const onEngineEvent = (ev: AgentEvent) => {
    enqueue(async () => {
      const roomId = roomOfEvent(ev);
      if (!roomId) return;
      // A project registered after the gateway started has no floor yet.
      if (!hotel.has(roomId)) await syncProjects();
      const sim = hotel.sim(roomId);
      if (!sim) return;
      const f = floorOf(roomId);
      await sendSim(roomId, sim.handleAgentEvent(ev));
      switch (ev.type) {
        case "task.created":
          f.currentTaskId = ev.taskId;
          f.jobActive = true;
          f.approvals.clear();
          f.reports.clear();
          f.works.clear();
          f.currentStep = undefined;
          f.verdicts.clear();
          f.jobState = "created";
          f.queuePosition = undefined;
          f.unread = null;
          await sendJobUpdate(roomId);
          pushFloors();
          break;
        case "task.queued":
          if (ev.taskId === f.currentTaskId) {
            f.queuePosition = ev.position;
            pushFloors();
          }
          break;
        case "task.state_changed":
          if (ev.taskId === f.currentTaskId) {
            f.currentStep = STEP_OF_STATE[ev.state];
            f.jobState = ev.state;
            f.queuePosition = undefined;
          }
          if (ev.state === "report_ready" && ev.reason?.startsWith("verdict:")) {
            const v = ev.reason.slice("verdict:".length);
            if (v === "pass" || v === "fail") f.verdicts.set(ev.taskId, v);
          }
          if (ev.state === "cancelled" || ev.state === "delivered" || ev.state === "failed") {
            dropPendingApprovals(f, ev.taskId);
            if (ev.taskId === f.currentTaskId) f.works.clear();
          }
          // The engine ends a rejected or cancelled job with `cancelled` only (no task.failed/completed).
          if ((ev.state === "cancelled" || ev.state === "delivered") && ev.taskId === f.currentTaskId) f.jobActive = false;
          if (ev.taskId === f.currentTaskId) {
            await sendJobUpdate(roomId);
            pushFloors();
          }
          break;
        case "task.failed":
        case "task.completed":
          dropPendingApprovals(f, ev.taskId);
          if (ev.taskId === f.currentTaskId) {
            f.jobActive = false;
            await sendJobUpdate(roomId);
            pushFloors();
          }
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
          f.approvals.set(a.approvalId, a);
          toUser(roomId, { type: "approval", approval: a });
          break;
        }
        case "approval.resolved": {
          const a = f.approvals.get(ev.approvalId);
          if (a) {
            a.status = ev.decision === "approve" ? "approved" : "rejected";
            toUser(roomId, { type: "approval", approval: a });
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
            ...(f.verdicts.has(ev.taskId) ? { verdict: f.verdicts.get(ev.taskId)! } : {}),
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
          f.reports.set(r.reportId, r);
          // Unread until the user opens the mailbox on this floor; a report that arrives while the user reads it counts as read.
          f.unread = r.verdict === "fail" ? "failed" : "report_ready";
          toUser(roomId, { type: "report", report: r });
          pushFloors();
          break;
        }
        case "agent.activity": {
          const line: ActivityLine = {
            ts: ev.ts,
            agentId: splitAgentId(ev.agentId).agentId,
            text: ev.text,
            taskId: ev.taskId,
            roomId,
            ...(f.currentStep && ev.taskId === f.currentTaskId ? { step: f.currentStep } : {}),
          };
          f.activity.push(line);
          if (f.activity.length > ACTIVITY_BUFFER_SIZE) f.activity.splice(0, f.activity.length - ACTIVITY_BUFFER_SIZE);
          // "All floors" also gets the lines of the floors the user is not on (opt-in, see `activity_scope`).
          if (current?.activityAll) send(current.ws, { type: "activity", line });
          else toUser(roomId, { type: "activity", line });
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
          f.works.set(agentId, work);
          toUser(roomId, { type: "work", agentId, work });
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
    enqueue(syncProjects);
    enqueue(syncSummaries);
  }

  // ---- client commands ----

  const startJob = async (ws: WebSocket, repoId: string, goal: string, options?: StartJobOptions) => {
    if (!engine) return sendError(ws, "engine_unavailable", "no engine connected");
    const roomId = userRoom();
    // The furniture of a floor starts jobs for the floor's own project only.
    if (!roomId || projectIdOfRoom(roomId) !== repoId) return sendError(ws, "bad_message", "start the job from the furniture on the project's floor");
    const f = floorOf(roomId);
    if (f.jobActive) return sendError(ws, "busy", "a job is already running");
    f.jobActive = true;
    try {
      const { taskId } = await engine.startJob(repoId, goal, options);
      f.currentTaskId = taskId;
      taskRooms.set(taskId, roomId);
    } catch (e) {
      f.jobActive = false;
      sendError(ws, "engine_unavailable", e instanceof Error ? e.message.slice(0, 200) : "cannot start job");
    }
  };

  /** True when the job is known to belong to another floor than the user's. */
  const otherFloor = (taskId: string): boolean => {
    const room = taskRooms.get(taskId);
    return room !== undefined && room !== userRoom();
  };

  const sendJobDetails = async (ws: WebSocket, taskId: string) => {
    if (!engine?.getJobDetails) return sendError(ws, "engine_unavailable", "no engine connected");
    if (otherFloor(taskId)) return sendError(ws, "bad_message", "that job is on another floor");
    try {
      send(ws, { type: "job_details", details: await engine.getJobDetails(taskId) });
    } catch {
      sendError(ws, "engine_unavailable", "cannot read job details");
    }
  };

  const resolveApproval = async (ws: WebSocket, approvalId: string, decision: "approve" | "reject", note?: string) => {
    if (!engine) return sendError(ws, "engine_unavailable", "no engine connected");
    const roomId = userRoom();
    // Only the approvals of the floor the user is on can be decided.
    if (!roomId || floors.get(roomId)?.approvals.get(approvalId)?.status !== "pending") {
      return sendError(ws, "bad_message", "unknown or resolved approval");
    }
    try {
      await engine.resolveApproval(approvalId, decision, note);
    } catch {
      sendError(ws, "engine_unavailable", "cannot resolve approval");
    }
  };

  const registerProject = async (ws: WebSocket, body: RegisterProjectBody) => {
    if (!engine?.registerProject) return sendError(ws, "engine_unavailable", "no engine connected");
    if (userRoom() !== LOBBY_ROOM) return sendError(ws, "bad_message", "projects are managed at the Reception in the lobby");
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
    if (userRoom() !== LOBBY_ROOM) return sendError(ws, "bad_message", "projects are managed at the Reception in the lobby");
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
    if (otherFloor(taskId)) return sendError(ws, "bad_message", "that job is on another floor");
    try {
      const info = await engine.deliver(taskId);
      for (const f of floors.values()) {
        for (const r of f.reports.values()) {
          if (r.taskId !== taskId) continue;
          r.delivery = { state: "done", branch: info.branch, commit: info.commit };
          const room = taskRooms.get(taskId);
          if (room) toUser(room, { type: "report", report: r, resend: true });
        }
      }
    } catch (e) {
      sendError(ws, "delivery_failed", errorText(e, "cannot deliver the branch"));
    }
  };

  /** Activity terminal scope. "all" sends the other floors' buffered lines at once and their new lines from now on. */
  const setActivityScope = (scope: "floor" | "all") => {
    if (!current) return;
    current.activityAll = scope === "all";
    if (!current.activityAll) return;
    // Sent on every request: the client asks again after each `welcome` (its terminal was reseeded with one floor).
    const here = userRoom();
    enqueue(() => {
      if (!current?.activityAll) return;
      for (const [roomId, f] of floors) {
        if (roomId === here || !hotel.has(roomId)) continue;
        for (const line of f.activity) send(current.ws, { type: "activity", line });
      }
    });
  };

  /** The elevator: only while the avatar stands in front of one. */
  const goTo = (ws: WebSocket, roomId: string) => {
    if (!current) return;
    if (!hotel.has(roomId)) return sendError(ws, "bad_message", "unknown floor");
    if (roomId === userRoom()) return;
    if (!hotel.atElevator(current.userId)) return sendError(ws, "bad_message", "use the elevator first");
    enqueue(() => enterRoom(roomId));
  };

  const tick = setInterval(() => {
    const here = userRoom();
    for (const [roomId, sim] of hotel.entries()) {
      const msgs = sim.dueMessages();
      if (roomId === here) deliver(roomId, msgs);
    }
  }, options.tickMs ?? 50);

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

  // The night shift writes its summary while nobody is connected, or while the user works on another floor; the window
  // opens and closes by the clock. One look a minute covers both.
  const nightPoll =
    engine?.getNightSummaries || engine?.getNight
      ? setInterval(() => {
          enqueue(syncSummaries);
          enqueue(() => pushNightClock());
        }, options.nightPollMs ?? 60_000)
      : undefined;
  nightPoll?.unref();

  wss.on("connection", (ws) => {
    // One user session in the MVP: a second connection replaces the first.
    if (current) current.ws.close(4000, "replaced by a newer connection");
    const { you, welcome } = hotel.join();
    current = { ws, userId: you, activityAll: false };
    sendWelcome(ws, hotel.roomOf(you) ?? LOBBY_ROOM, welcome);
    // A project registered since the last connection gets its floor now.
    if (engine) {
      enqueue(syncProjects);
      enqueue(syncSummaries);
      enqueue(() => pushNightClock(true));
    }
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
        const kind = msg.kind ?? "change";
        void startJob(ws, msg.repoId, msg.goal, kind === "change" ? undefined : { kind, target: msg.target });
      } else if (msg.type === "list_branches") {
        const room = userRoom();
        if (room) void sendBranches(ws, room);
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
      } else if (msg.type === "go_to") {
        goTo(ws, msg.roomId);
      } else if (msg.type === "activity_scope") {
        setActivityScope(msg.scope);
      } else if (msg.type === "build_board") {
        void sendBuildBoard(ws);
      } else if (msg.type === "build_report") {
        void sendBuildReport(ws, msg.spec);
      } else if (msg.type === "night_state") {
        void sendNight(ws);
      } else if (msg.type === "night_add") {
        const job = msg.job;
        void nightCommand(ws, async (link) => void (await link.addNightJob?.(job)));
      } else if (msg.type === "night_remove") {
        const id = msg.id;
        void nightCommand(ws, (link) => link.removeNightJob?.(id) ?? Promise.resolve());
      } else if (msg.type === "night_move") {
        const { id, direction } = msg;
        void nightCommand(ws, (link) => link.moveNightJob?.(id, direction) ?? Promise.resolve());
      } else if (msg.type === "hr_state") {
        void sendHr(ws);
      } else if (msg.type === "hr_do") {
        void hrAct(ws, msg.act);
      } else if (msg.type === "memory_state") {
        void sendMemory(ws);
      } else if (msg.type === "memory_do") {
        void memoryAct(ws, msg.act);
      } else {
        const roomId = userRoom();
        const sim = roomId ? hotel.sim(roomId) : undefined;
        if (roomId && sim) deliver(roomId, sim.handleIntent(current.userId, msg));
      }
    });

    ws.on("close", () => {
      if (current?.ws === ws) {
        hotel.leave(current.userId);
        current = null;
      }
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
            clearInterval(nightPoll);
            for (const t of swapTimers) clearTimeout(t);
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
