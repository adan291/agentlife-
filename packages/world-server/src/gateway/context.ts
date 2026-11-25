// What every feature of the gateway shares: the connected session, the per-floor state, sending, and the outbox that
// keeps messages in order. Features get this object and their own dependencies; they never import each other's state.
import type { WebSocket } from "ws";
import { ServerMsgSchema, projectIdOfRoom } from "@agentlife/shared";
import type { ActivityLine, AgentId, AgentWork, Approval, ClientMsg, ErrorCode, Hotel, JobKind, JobState, Report, ServerMsg, StepName, WelcomeMsg } from "@agentlife/shared";
import type { EngineLink } from "../engine-link.ts";
import type { ShotUpload } from "../bug-upload.ts";
import type { GatewayOptions } from "./options.ts";
import type { SlidingWindow } from "./rate.ts";

/** What the gateway keeps for one floor: its job, approvals, reports, activity and what its agents work on. */
export interface Floor {
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
  /** Kind and target of the current job, and its state entries (from the events), for the overview. */
  jobKind: JobKind | undefined;
  jobTarget: string | undefined;
  timeline: { ts: number; state: JobState }[];
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
    jobKind: undefined,
    jobTarget: undefined,
    timeline: [],
  };
}

/** The one connected browser tab (one user session in the MVP). */
export interface Session {
  ws: WebSocket;
  userId: number;
  activityAll: boolean;
  overviewWatch: boolean;
}

/** Per-connection state some handlers need (the bug report rate and the screenshot upload). */
export interface Connection {
  bugWindow: SlidingWindow;
  bugShots: ShotUpload;
}

/** One incoming message as a handler sees it: the socket, the raw text (for size checks) and the connection's state. */
export interface Incoming {
  ws: WebSocket;
  raw: string;
  conn: Connection;
}

export type MsgOf<T extends ClientMsg["type"]> = Extract<ClientMsg, { type: T }>;
/** The client messages a feature answers. A message type belongs to exactly one feature (`mergeHandlers` checks it). */
export type Handlers = { [T in ClientMsg["type"]]?: (msg: MsgOf<T>, at: Incoming) => void };

/**
 * Functions defined by features that are built after the ones that need them (rooms need panels, panels need almost
 * everything, and the team needs to deliver the room's walks). `startGateway` fills them in once every feature exists.
 */
export interface Wiring {
  sendSim(roomId: string, msgs: ServerMsg[]): Promise<void>;
  sendWelcome(ws: WebSocket, roomId: string, welcome: WelcomeMsg): void;
}

export interface GatewayContext {
  readonly hotel: Hotel;
  readonly engine: EngineLink | undefined;
  readonly options: GatewayOptions;
  readonly clock: () => number;
  readonly floors: Map<string, Floor>;
  floorOf(roomId: string): Floor;
  /** Room of each job, learnt from `task.created` and from a job the user started. */
  readonly taskRooms: Map<string, string>;
  session(): Session | null;
  setSession(s: Session | null): void;
  /** Room the connected user is in. */
  userRoom(): string | undefined;
  /** The project of the user's floor, when it is a project floor. */
  userProject(): string | undefined;
  send(ws: WebSocket, msg: ServerMsg): void;
  sendError(ws: WebSocket, code: ErrorCode, message: string): void;
  /** Sends to the user only while the user is in that room: messages are scoped to the room (requirement 1.4). */
  toUser(roomId: string, msg: ServerMsg): void;
  /** Serialises outgoing messages so panel data always precedes its `open_panel`. */
  enqueue(task: () => Promise<void> | void): void;
  /** Queues simulation output of a room (walks, presence, panels). */
  deliver(roomId: string, msgs: ServerMsg[]): void;
  /** Model per role for the agent tooltips, cached so the welcome stays synchronous. */
  models: Partial<Record<AgentId, string>> | undefined;
  readonly wire: Wiring;
}

const unwired = (name: string) => () => {
  throw new Error(`gateway: ${name} used before it was wired`);
};

export function createContext(options: GatewayOptions): GatewayContext {
  const { hotel } = options;
  let current: Session | null = null;
  const floors = new Map<string, Floor>();
  let outbox: Promise<void> = Promise.resolve();
  const wire: Wiring = { sendSim: unwired("sendSim"), sendWelcome: unwired("sendWelcome") };

  const send = (ws: WebSocket, msg: ServerMsg): void => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(ServerMsgSchema.parse(msg)));
  };
  const userRoom = (): string | undefined => (current ? hotel.roomOf(current.userId) : undefined);
  const enqueue = (task: () => Promise<void> | void): void => {
    outbox = outbox.then(task).catch((e: unknown) => {
      // Swallowed as before (one failed send must not stop the queue), but kept in the Bug sack.
      options.bugs?.recordError("handler", e);
    });
  };

  return {
    hotel,
    engine: options.engine,
    options,
    clock: options.clock ?? Date.now,
    floors,
    floorOf: (roomId) => {
      let f = floors.get(roomId);
      if (!f) floors.set(roomId, (f = newFloor()));
      return f;
    },
    taskRooms: new Map(),
    session: () => current,
    setSession: (s) => {
      current = s;
    },
    userRoom,
    userProject: () => {
      const room = userRoom();
      return room === undefined ? undefined : projectIdOfRoom(room);
    },
    send,
    sendError: (ws, code, message) => send(ws, { type: "error", code, message }),
    toUser: (roomId, msg) => {
      if (current && userRoom() === roomId) send(current.ws, msg);
    },
    enqueue,
    deliver: (roomId, msgs) => {
      if (msgs.length === 0) return;
      enqueue(() => wire.sendSim(roomId, msgs));
    },
    models: undefined,
    wire,
  };
}

/** The refusal of the shop counter and the wardrobe when the hotel has no economy. */
export const SHOP_CLOSED = "The shop is closed: it needs the real engine.";

/** An error's message for the user, cut short, or the fallback. */
export const errorText = (e: unknown, fallback: string): string => (e instanceof Error && e.message ? e.message.slice(0, 200) : fallback);

/** One handler table from many; a message type claimed twice is a programming error, caught at start. */
export function mergeHandlers(...tables: Handlers[]): Handlers {
  const out: Record<string, unknown> = {};
  for (const t of tables) {
    for (const [type, h] of Object.entries(t)) {
      if (out[type]) throw new Error(`gateway: two features answer '${type}'`);
      out[type] = h;
    }
  }
  return out as Handlers;
}
