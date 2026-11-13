import { FURNI_CATALOG } from "../furni.ts";
import { isSeatDef, seatTile } from "../fun.ts";
import { dirFromDelta, oppositeDir } from "../geometry/dir.ts";
import type { Dir } from "../geometry/dir.ts";
import { findPath, isWalkable } from "../geometry/pathfind.ts";
import type { PathGrid, Tile } from "../geometry/pathfind.ts";
import type { Heightmap } from "../geometry/heightmap.ts";
import { buildPathGrid, resolveAnchor, roomAgents, roomGuests, splitAgentId, useTile } from "../room.ts";
import type { AgentId, RoomDef, SemanticAnchor, StaffId } from "../room.ts";
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
  /** The seat this avatar has claimed (it may still be on its way there). */
  seat?: Seat;
}

/** A seat that an avatar has claimed: the piece, the tile it sits on, the tile in front of the piece and the way it faces. */
interface Seat {
  itemId: string;
  tile: Tile;
  use: Tile;
  dir: Dir;
}

const sameTile = (a: Tile, b: Tile): boolean => a.x === b.x && a.y === b.y;

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
  private current: RoomDef;
  private readonly clock: () => number;
  private grid: PathGrid & Heightmap;
  private readonly msPerTile: number;
  /** Agents that live in this room (a project room has no Builder, the lobby only the Builder). */
  private readonly agentIds: readonly AgentId[];
  private readonly avatars = new Map<AvatarId, AvatarState>();
  /** Who sits on each seat piece (item id to avatar id): one sitter per piece. */
  private readonly seatedBy = new Map<string, AvatarId>();
  private readonly agentStates = new Map<AgentId, { state: AgentState; text?: string }>();
  private deferred: Deferred[] = [];
  private joined = false;

  constructor(room: RoomDef, clock: () => number, options: WorldSimOptions = {}) {
    this.current = room;
    this.clock = clock;
    this.grid = buildPathGrid(room);
    this.msPerTile = options.msPerTile ?? DEFAULT_MS_PER_TILE;
    this.agentIds = roomAgents(room);
    for (const agent of this.agentIds) {
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
    for (const guest of roomGuests(room)) {
      // A guest spot is empty until the world-server puts a team member there: the avatar waits at the elevator.
      this.avatars.set(guest, { id: guest, name: `Guest ${guest.slice("guest".length)}`, tile: { x: room.door.x, y: room.door.y }, dir: room.door.dir as Dir });
    }
  }

  private now(): number {
    return Math.floor(this.clock());
  }

  /** The room as it is now (furniture can be rearranged on a project floor, see `updateRoom`). */
  get room(): RoomDef {
    return this.current;
  }

  /**
   * Swaps the room for a rearranged one (same heightmap, door and anchors that do not follow furniture) and rebuilds
   * the path grid. Avatars keep their tiles; the caller has checked that nobody stands where furniture now is.
   */
  updateRoom(room: RoomDef): void {
    this.current = room;
    this.grid = buildPathGrid(room);
    // A seat whose piece moved or went away is no longer a seat: its sitter just stands where it is.
    for (const a of this.avatars.values()) if (a.seat && !this.seatValid(a.seat)) this.releaseSeat(a);
  }

  /** The tile of every avatar and the rest of every walk in progress: places a piece must not be put on. */
  tilesInUse(): Tile[] {
    const now = this.now();
    const tiles: Tile[] = [];
    for (const a of this.avatars.values()) {
      tiles.push(this.tileAt(a, now));
      if (a.walk) tiles.push(...a.walk.path.slice(this.completedSteps(a, now)));
    }
    return tiles;
  }

  /**
   * Floor tiles that no furniture blocks, where nobody stands or is walking to, and that are not the door: where a wisp
   * may be drawn. Row by row, so the same room always gives the same list.
   */
  freeTiles(): Tile[] {
    const used = new Set(this.tilesInUse().map((t) => `${t.x},${t.y}`));
    used.add(`${this.room.door.x},${this.room.door.y}`);
    const out: Tile[] = [];
    for (let y = 0; y < this.grid.l; y++) {
      for (let x = 0; x < this.grid.w; x++) {
        if (isWalkable(this.grid, x, y) && !used.has(`${x},${y}`)) out.push({ x, y });
      }
    }
    return out;
  }

  /** Single user in the MVP: joining again replaces the previous user avatar. */
  join(): { you: number; welcome: WelcomeMsg } {
    const old = this.avatars.get(USER_ID);
    if (old) this.releaseSeat(old);
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

  /** The user leaves the room (elevator, disconnect). Agents stay. */
  leave(): void {
    const user = this.avatars.get(USER_ID);
    if (user) this.releaseSeat(user);
    this.avatars.delete(USER_ID);
    this.deferred = this.deferred.filter((d) => d.owner !== USER_ID);
    this.joined = false;
  }

  /** Whether the user avatar is in this room. */
  hasUser(): boolean {
    return this.joined;
  }

  /** Agents of this room, in display order. */
  agents(): readonly AgentId[] {
    return this.agentIds;
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
      roomId: this.room.id,
      you,
      avatars,
      agents: this.agentIds.map((agentId) => {
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
        // A seat is not "walk next to it": the avatar sits on it.
        if (isSeatDef(def)) return this.sit(userId, msg.itemId);
        const use = useTile(placed);
        const facing = oppositeDir(placed.dir as Dir);
        const after: ServerMsg[] = [];
        if (def?.interaction) {
          after.push({ type: "open_panel", panel: def.interaction, ...(placed.to ? { data: { to: placed.to } } : {}) });
        }
        return this.walkTo(user, use, facing, after);
      }
      case "emote":
        // A seated avatar does not dance; it can wave and cheer.
        if (msg.emote === "dance" && this.onSeat(user)) return [];
        return [{ type: "emote", id: userId, emote: msg.emote }];
      case "sit_toggle":
        return this.toggleSit(user);
      default:
        // hello, start_job and approve are handled by the gateway / engine link.
        return [];
    }
  }

  handleAgentEvent(ev: AgentEvent): ServerMsg[] {
    if (!("agentId" in ev) || ev.agentId === undefined) return [];
    // Events carry `<project>:<role>`; the room knows the agent by its role.
    const agentId = splitAgentId(ev.agentId).agentId;
    if (!this.agentStates.has(agentId)) return [];
    switch (ev.type) {
      case "agent.goto": {
        const agent = this.avatars.get(agentId);
        const anchor = resolveAnchor(this.room, ev.anchor, agentId);
        if (!agent || !anchor) return [];
        const out = this.walkTo(agent, { x: anchor.x, y: anchor.y }, anchor.dir as Dir, [], false);
        return out;
      }
      case "agent.state_changed": {
        this.agentStates.set(
          agentId,
          ev.text === undefined ? { state: ev.state } : { state: ev.state, text: ev.text },
        );
        return [
          ev.text === undefined
            ? { type: "agent_state", agentId, state: ev.state }
            : { type: "agent_state", agentId, state: ev.state, text: ev.text },
        ];
      }
      case "agent.say":
        return [{ type: "say", id: agentId, text: ev.text }];
      default:
        return [];
    }
  }

  /**
   * Sends an agent or a guest to a named place outside of any job (a team change: the elevator, back to its desk or
   * spot). Returns the walk.
   */
  sendAgentTo(agentId: StaffId, anchor: SemanticAnchor): ServerMsg[] {
    const agent = this.avatars.get(agentId);
    const a = resolveAnchor(this.room, anchor, agentId);
    if (!agent || !a) return [];
    return this.walkTo(agent, { x: a.x, y: a.y }, a.dir as Dir, [], false);
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

  /** True when the avatar has reached the seat it claimed (and the piece is still there). */
  private onSeat(who: AvatarState): boolean {
    const seat = who.seat;
    return seat !== undefined && this.seatValid(seat) && sameTile(this.tileAt(who, this.now()), seat.tile);
  }

  /** The piece of the seat is still in the room, with the same seat tile and use tile. */
  private seatValid(seat: Seat): boolean {
    const piece = this.room.furni.find((f) => f.itemId === seat.itemId);
    const def = piece ? FURNI_CATALOG[piece.defId] : undefined;
    if (!piece || !def || !isSeatDef(def)) return false;
    return sameTile(seatTile(piece, def), seat.tile) && sameTile(useTile(piece), seat.use);
  }

  /** The avatar no longer holds its seat (it got up, left, or the piece went away). */
  private releaseSeat(who: AvatarState): void {
    const seat = who.seat;
    if (!seat) return;
    if (this.seatedBy.get(seat.itemId) === who.id) this.seatedBy.delete(seat.itemId);
    delete who.seat;
  }

  /**
   * Sends an avatar to sit on a seat piece: it walks to the tile in front of it, takes one more step onto the seat and
   * faces the way the piece faces; `sit` follows on arrival. One sitter per piece: a taken seat is refused and the avatar
   * does not move. Sitting on the seat you are on gets you up. In the product only the user sits; the rule is on the id.
   */
  sit(id: AvatarId, itemId: string): ServerMsg[] {
    const who = this.avatars.get(id);
    if (!who) return [{ type: "error", code: "bad_message", message: "not here" }];
    const placed = this.room.furni.find((f) => f.itemId === itemId);
    const def = placed ? FURNI_CATALOG[placed.defId] : undefined;
    if (!placed || !def || !isSeatDef(def)) return [{ type: "error", code: "bad_message", message: `'${itemId}' is not a seat` }];
    if (who.seat?.itemId === itemId && this.seatValid(who.seat)) return this.standUp(who);
    const holder = this.seatedBy.get(itemId);
    if (holder !== undefined && holder !== id) return [{ type: "error", code: "seat_taken", message: "Somebody is sitting there." }];
    const seat: Seat = { itemId, tile: seatTile(placed, def), use: useTile(placed), dir: placed.dir as Dir };
    return this.walkTo(who, seat.use, undefined, [{ type: "sit", id, sitting: true, dir: seat.dir, itemId }], true, seat);
  }

  /** Gets up from the seat: the avatar steps to the tile in front of it. Nothing to do when it is not sitting. */
  private standUp(who: AvatarState): ServerMsg[] {
    const seat = who.seat;
    if (!seat || !this.seatValid(seat)) return [];
    return this.walkTo(who, seat.use, undefined, [], true);
  }

  /** Key 4: get up when sitting, else sit on the nearest free seat that has a path (nearest by the length of that path). */
  private toggleSit(user: AvatarState): ServerMsg[] {
    if (user.seat && this.seatValid(user.seat)) return this.standUp(user);
    const now = this.now();
    const from = this.tileAt(user, now);
    let best: { itemId: string; steps: number } | undefined;
    for (const placed of this.room.furni) {
      const def = FURNI_CATALOG[placed.defId];
      if (!isSeatDef(def)) continue;
      const holder = this.seatedBy.get(placed.itemId);
      if (holder !== undefined && holder !== user.id) continue;
      const path = findPath(this.grid, from, useTile(placed));
      if (path === null) continue;
      if (!best || path.length < best.steps) best = { itemId: placed.itemId, steps: path.length };
    }
    if (!best) return [{ type: "error", code: "seat_taken", message: "There is no free seat here." }];
    return this.sit(user.id, best.itemId);
  }

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
    /** When set, the walk ends with one more step onto this seat, which the avatar claims. */
    toSeat?: Seat,
  ): ServerMsg[] {
    const now = this.now();
    const from = this.tileAt(who, now);
    // Getting up from a seat that was reached: the first step is to the tile in front of it (a solid piece is not on the grid).
    const gettingUp = who.seat !== undefined && this.onSeat(who);
    const origin = gettingUp ? who.seat!.use : from;
    const found = findPath(this.grid, origin, target);
    if (found === null) {
      return reportNoPath ? [{ type: "error", code: "no_path", message: "no path to target" }] : [];
    }
    const path: Tile[] = [...(gettingUp ? [origin] : []), ...found, ...(toSeat ? [toSeat.tile] : [])];
    const finalDir = toSeat ? toSeat.dir : endDir;

    this.deferred = this.deferred.filter((d) => d.owner !== who.id);
    const out: ServerMsg[] = [];
    // The old seat is let go (a seat that was only on the way is just released); the new one is claimed now, so nobody else takes it.
    this.releaseSeat(who);
    if (gettingUp) out.push({ type: "sit", id: who.id, sitting: false });
    if (toSeat) {
      who.seat = toSeat;
      this.seatedBy.set(toSeat.itemId, who.id);
    }

    if (path.length === 0) {
      who.tile = from;
      delete who.walk;
      if (finalDir !== undefined) {
        who.dir = finalDir;
        out.push({ type: "face", id: who.id, dir: finalDir });
      }
      out.push(...afterWalk);
      return out;
    }

    const walk: Walk = { origin: from, path, startedAt: now, msPerTile: this.msPerTile };
    if (finalDir !== undefined) walk.endDir = finalDir;
    who.walk = walk;
    out.push({ type: "walk", id: who.id, path, msPerTile: this.msPerTile, startedAt: now });

    const arrival = now + path.length * this.msPerTile;
    if (finalDir !== undefined) this.deferred.push({ at: arrival, owner: who.id, msg: { type: "face", id: who.id, dir: finalDir } });
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
