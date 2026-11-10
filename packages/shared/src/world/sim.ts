import { FURNI_CATALOG } from "../furni.ts";
import { dirFromDelta, oppositeDir } from "../geometry/dir.ts";
import type { Dir } from "../geometry/dir.ts";
import { findPath } from "../geometry/pathfind.ts";
import type { PathGrid, Tile } from "../geometry/pathfind.ts";
import { AGENT_IDS, buildPathGrid, resolveAnchor, useTile } from "../room.ts";
import type { AgentId, RoomDef } from "../room.ts";
import type { AgentEvent, AgentState } from "../events.ts";
import { PROTOCOL_VERSION } from "../version.ts";
import type { AvatarId, Avatar, ClientMsg, ServerMsg, WelcomeMsg } from "../protocol.ts";

export const DEFAULT_MS_PER_TILE = 400;
const USER_ID = 1;

const AGENT_NAMES: Record<AgentId, string> = {
  architect: "Architect",
  developer: "Developer",
  qa: "QA",
  builder: "Builder",
};

interface Walk {
  origin: Tile;
  path: Tile[];
  startedAt: number;
  msPerTile: number;
  /** Direction to face once the walk is complete. */
  endDir?: Dir;
}

interface AvatarState {
  id: AvatarId;
  name: string;
  /** Tile where the avatar stands when it has no walk (or before the walk starts). */
  tile: Tile;
  dir: Dir;
  walk?: Walk;
}

interface Deferred {
  at: number;
  owner: AvatarId;
  msg: ServerMsg;
}

export interface WorldSimOptions {
  msPerTile?: number;
}

/**
 * Pure world simulation. No I/O and no timers: positions are derived from walk start times and the
 * injected clock. Messages that must be sent when a walk ends are held as deferred messages;
 * the host (gateway or replay transport) collects them with `dueMessages()` and may use
 * `nextDeferredAt()` to schedule its own wake-up.
 */
export class WorldSim {
  readonly room: RoomDef;
  private readonly clock: () => number;
  private readonly grid: PathGrid;
  private readonly msPerTile: number;
  private readonly avatars = new Map<AvatarId, AvatarState>();
  private readonly agentStates = new Map<AgentId, { state: AgentState; text?: string }>();
  private deferred: Deferred[] = [];
  private joined = false;

  constructor(room: RoomDef, clock: () => number, options: WorldSimOptions = {}) {
    this.room = room;
    this.clock = clock;
    this.grid = buildPathGrid(room);
    this.msPerTile = options.msPerTile ?? DEFAULT_MS_PER_TILE;
    for (const agent of AGENT_IDS) {
      const home = resolveAnchor(room, "home", agent);
      const tile = home ? { x: home.x, y: home.y } : { x: room.door.x, y: room.door.y };
      this.avatars.set(agent, {
        id: agent,
        name: AGENT_NAMES[agent],
        tile,
        dir: (home?.dir ?? 4) as Dir,
      });
      this.agentStates.set(agent, { state: "idle" });
    }
  }

  private now(): number {
    return Math.floor(this.clock());
  }

  /** Single user in the MVP: joining again replaces the previous user avatar. */
  join(): { you: number; welcome: WelcomeMsg } {
    this.avatars.set(USER_ID, {
      id: USER_ID,
      name: "You",
      tile: { x: this.room.door.x, y: this.room.door.y },
      dir: this.room.door.dir as Dir,
    });
    this.deferred = this.deferred.filter((d) => d.owner !== USER_ID);
    this.joined = true;
    return { you: USER_ID, welcome: this.snapshot(USER_ID) };
  }

  snapshot(you: number = USER_ID): WelcomeMsg {
    const now = this.now();
    const avatars: Avatar[] = [];
    for (const a of this.avatars.values()) {
      if (a.id === USER_ID && !this.joined) continue;
      const t = this.tileAt(a, now);
      avatars.push({ id: a.id, name: a.name, x: t.x, y: t.y, dir: this.dirAt(a, now) });
    }
    return {
      type: "welcome",
      protocol: PROTOCOL_VERSION,
      room: this.room,
      you,
      avatars,
      agents: AGENT_IDS.map((agentId) => {
        const s = this.agentStates.get(agentId)!;
        return s.text === undefined ? { agentId, state: s.state } : { agentId, state: s.state, text: s.text };
      }),
    };
  }

  /** Current logical tile of an avatar (the last tile it has fully reached). */
  tileOf(id: AvatarId): Tile | undefined {
    const a = this.avatars.get(id);
    return a ? this.tileAt(a, this.now()) : undefined;
  }

  handleIntent(userId: number, msg: ClientMsg): ServerMsg[] {
    const user = this.avatars.get(userId);
    if (!user) return [{ type: "error", code: "bad_message", message: "not joined" }];
    switch (msg.type) {
      case "move":
        return this.walkTo(user, { x: msg.x, y: msg.y }, undefined, []);
      case "use": {
        const placed = this.room.furni.find((f) => f.itemId === msg.itemId);
        if (!placed) return [{ type: "error", code: "bad_message", message: `unknown item '${msg.itemId}'` }];
        const def = FURNI_CATALOG[placed.defId];
        const use = useTile(placed);
        const facing = oppositeDir(placed.dir as Dir);
        const after: ServerMsg[] = [];
        if (def?.interaction) after.push({ type: "open_panel", panel: def.interaction });
        return this.walkTo(user, use, facing, after);
      }
      default:
        // hello, start_job and approve are handled by the gateway / engine link.
        return [];
    }
  }

  handleAgentEvent(ev: AgentEvent): ServerMsg[] {
    switch (ev.type) {
      case "agent.goto": {
        const agent = this.avatars.get(ev.agentId);
        const anchor = resolveAnchor(this.room, ev.anchor, ev.agentId);
        if (!agent || !anchor) return [];
        const out = this.walkTo(agent, { x: anchor.x, y: anchor.y }, anchor.dir as Dir, [], false);
        return out;
      }
      case "agent.state_changed": {
        this.agentStates.set(
          ev.agentId,
          ev.text === undefined ? { state: ev.state } : { state: ev.state, text: ev.text },
        );
        return [
          ev.text === undefined
            ? { type: "agent_state", agentId: ev.agentId, state: ev.state }
            : { type: "agent_state", agentId: ev.agentId, state: ev.state, text: ev.text },
        ];
      }
      case "agent.say":
        return [{ type: "say", id: ev.agentId, text: ev.text }];
      default:
        return [];
    }
  }

  /** Remove and return deferred messages whose time has come, oldest first. */
  dueMessages(): ServerMsg[] {
    const now = this.now();
    const due = this.deferred.filter((d) => d.at <= now).sort((a, b) => a.at - b.at);
    if (due.length === 0) return [];
    this.deferred = this.deferred.filter((d) => d.at > now);
    return due.map((d) => d.msg);
  }

  /** Time of the earliest pending deferred message, or null. */
  nextDeferredAt(): number | null {
    let min: number | null = null;
    for (const d of this.deferred) if (min === null || d.at < min) min = d.at;
    return min;
  }

  // ---- internals ----

  /**
   * Start a walk to `target`. `afterWalk` messages are deferred until arrival (or returned at once
   * when already there). A new walk cancels the previous walk's pending messages.
   */
  private walkTo(
    who: AvatarState,
    target: Tile,
    endDir: Dir | undefined,
    afterWalk: ServerMsg[],
    reportNoPath = true,
  ): ServerMsg[] {
    const now = this.now();
    const from = this.tileAt(who, now);
    const path = findPath(this.grid, from, target);
    if (path === null) {
      return reportNoPath ? [{ type: "error", code: "no_path", message: "no path to target" }] : [];
    }

    this.deferred = this.deferred.filter((d) => d.owner !== who.id);
    const out: ServerMsg[] = [];

    if (path.length === 0) {
      who.tile = from;
      delete who.walk;
      if (endDir !== undefined) {
        who.dir = endDir;
        out.push({ type: "face", id: who.id, dir: endDir });
      }
      out.push(...afterWalk);
      return out;
    }

    const walk: Walk = { origin: from, path, startedAt: now, msPerTile: this.msPerTile };
    if (endDir !== undefined) walk.endDir = endDir;
    who.walk = walk;
    out.push({ type: "walk", id: who.id, path, msPerTile: this.msPerTile, startedAt: now });

    const arrival = now + path.length * this.msPerTile;
    if (endDir !== undefined) this.deferred.push({ at: arrival, owner: who.id, msg: { type: "face", id: who.id, dir: endDir } });
    for (const m of afterWalk) this.deferred.push({ at: arrival, owner: who.id, msg: m });
    return out;
  }

  private completedSteps(a: AvatarState, now: number): number {
    const w = a.walk;
    if (!w) return 0;
    const done = Math.floor((now - w.startedAt) / w.msPerTile);
    return Math.max(0, Math.min(w.path.length, done));
  }

  private tileAt(a: AvatarState, now: number): Tile {
    const w = a.walk;
    if (!w) return a.tile;
    const n = this.completedSteps(a, now);
    return n === 0 ? w.origin : w.path[n - 1]!;
  }

  private dirAt(a: AvatarState, now: number): Dir {
    const w = a.walk;
    if (!w) return a.dir;
    const n = this.completedSteps(a, now);
    if (n >= w.path.length) return w.endDir ?? this.lastStepDir(w, a.dir);
    const from = n === 0 ? w.origin : w.path[n - 1]!;
    const to = w.path[n]!;
    return dirFromDelta(to.x - from.x, to.y - from.y, a.dir);
  }

  private lastStepDir(w: Walk, fallback: Dir): Dir {
    const last = w.path[w.path.length - 1]!;
    const prev = w.path.length > 1 ? w.path[w.path.length - 2]! : w.origin;
    return dirFromDelta(last.x - prev.x, last.y - prev.y, fallback);
  }
}
