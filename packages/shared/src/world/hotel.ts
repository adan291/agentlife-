import { FURNI_CATALOG } from "../furni.ts";
import { sanitize } from "../sanitize.ts";
import { applyLayout, checkMove, layoutOf, layoutProblem } from "../layout.ts";
import type { Layout, MoveCode, Placement } from "../layout.ts";
import { footprintTiles, useTile, validateRoom } from "../room.ts";
import type { PlacedFurni, RoomDef } from "../room.ts";
import { isTemplatePiece } from "../shop.ts";
import type { FloorKind } from "../floors.ts";
import type { WelcomeMsg } from "../protocol.ts";
import { WorldSim } from "./sim.ts";
import type { WorldSimOptions } from "./sim.ts";

export const LOBBY_ROOM = "lobby";
export const HR_ROOM = "hr";
export const PROJECT_ROOM_PREFIX = "project:";

/** `lobby`, `hr` or `project:<projectId>`. */
export type RoomId = typeof LOBBY_ROOM | typeof HR_ROOM | `${typeof PROJECT_ROOM_PREFIX}${string}`;

export function projectRoomId(projectId: string): RoomId {
  return `${PROJECT_ROOM_PREFIX}${projectId}`;
}

/** The project of a `project:<id>` room, or undefined for the lobby and the HR office. */
export function projectIdOfRoom(roomId: string): string | undefined {
  return roomId.startsWith(PROJECT_ROOM_PREFIX) ? roomId.slice(PROJECT_ROOM_PREFIX.length) : undefined;
}

/** Longest name shown on a door sign. */
export const SIGN_TEXT_MAX = 32;

export interface ProjectInfo {
  id: string;
  name: string;
}

/** Text for a door sign: no control characters, paths or secrets (same rules as speech), at most 32 characters. */
export function signText(name: string, fallback: string): string {
  // eslint-disable-next-line no-control-regex
  const clean = sanitize(name.replace(/[\u0000-\u001f\u007f-\u009f]/g, " "), SIGN_TEXT_MAX);
  return clean || sanitize(fallback, SIGN_TEXT_MAX) || "Project";
}

/**
 * The floor of a project before anybody arranged it: the template with the room id of the project and its name as sign
 * text. The result is validated, so a bad template fails here and not when a user walks in.
 */
export function baseRoomForProject(template: RoomDef, project: ProjectInfo): RoomDef {
  return validateRoom({ ...template, id: projectRoomId(project.id), kind: "project", name: signText(project.name, project.id) });
}

/** The floor of a project: its base room with the saved layout applied (a piece that no longer fits stays where the template has it). */
export function roomForProject(template: RoomDef, project: ProjectInfo, layout?: Layout, extras: readonly PlacedFurni[] = []): RoomDef {
  const base = baseRoomForProject(template, project);
  let room = base;
  if (layout) {
    room = applyLayout(base, layout).room;
    try {
      room = validateRoom(room);
    } catch {
      room = base;
    }
  }
  return addExtras(room, extras);
}

/**
 * Stands the bought pieces on a floor one at a time, in order, each through the same checks as a move. A piece that no
 * longer fits (the template or the catalogue changed) is left out; the caller can see which by the room's item ids.
 */
export function addExtras(room: RoomDef, extras: readonly PlacedFurni[]): RoomDef {
  let out = room;
  for (const piece of extras) {
    if (out.furni.some((p) => p.itemId === piece.itemId) || !FURNI_CATALOG[piece.defId]) continue;
    const candidate: RoomDef = { ...out, furni: [...out.furni, piece] };
    const r = checkMove(candidate, piece.itemId, { x: piece.x, y: piece.y, dir: piece.dir });
    if (r.ok) out = r.room;
  }
  return out;
}

export interface HotelOptions {
  lobby: RoomDef;
  hr: RoomDef;
  /** Template of the project floors (`rooms/project-template.json`). */
  template: RoomDef;
  clock: () => number;
  /** Room where a user starts. Default: the lobby. Falls back to the lobby when the room no longer exists. */
  startRoom?: RoomId;
  sim?: WorldSimOptions;
  /** The saved layout of a project, read when its floor is built. */
  layoutOf?: (projectId: string) => Layout | undefined;
  /** The bought pieces standing on a project floor, read when its floor is built (furni-shop). */
  extrasOf?: (projectId: string) => readonly PlacedFurni[];
}

export interface FloorInfo {
  roomId: RoomId;
  name: string;
  kind: FloorKind;
}

export type ArrangeCode = MoveCode | "not_editable" | "save_failed" | "duplicate" | "not_removable" | "no_stock";

export type ArrangeResult =
  | { ok: true; room: RoomDef; layout: Layout }
  | { ok: false; code: ArrangeCode; reason: string };

const NOT_EDITABLE: ArrangeResult = { ok: false, code: "not_editable", reason: "Only project floors can be arranged." };

/**
 * The rooms of the hotel: one `WorldSim` each. A user is in exactly one room; moving leaves the old room and joins the
 * new one at its elevator. Pure (no I/O, no timers), like `WorldSim`.
 */
export class Hotel {
  private readonly sims = new Map<RoomId, WorldSim>();
  private readonly userRooms = new Map<number, RoomId>();
  /** The floor of each project as the template makes it, to compare a layout with and to go back to. */
  private readonly bases = new Map<RoomId, RoomDef>();
  private readonly template: RoomDef;
  private readonly clock: () => number;
  private readonly simOptions: WorldSimOptions;
  private readonly startRoom: RoomId;
  private readonly savedLayout: ((projectId: string) => Layout | undefined) | undefined;
  private readonly savedExtras: ((projectId: string) => readonly PlacedFurni[]) | undefined;

  constructor(opts: HotelOptions) {
    this.template = opts.template;
    this.clock = opts.clock;
    this.simOptions = opts.sim ?? {};
    this.startRoom = opts.startRoom ?? LOBBY_ROOM;
    this.savedLayout = opts.layoutOf;
    this.savedExtras = opts.extrasOf;
    this.sims.set(LOBBY_ROOM, new WorldSim({ ...opts.lobby, id: LOBBY_ROOM, kind: "lobby" }, opts.clock, this.simOptions));
    this.sims.set(HR_ROOM, new WorldSim({ ...opts.hr, id: HR_ROOM, kind: "hr" }, opts.clock, this.simOptions));
  }

  has(roomId: string): roomId is RoomId {
    return this.sims.has(roomId as RoomId);
  }

  sim(roomId: string): WorldSim | undefined {
    return this.sims.get(roomId as RoomId);
  }

  /** Every room with its simulation, lobby and HR office first. */
  entries(): [RoomId, WorldSim][] {
    return [...this.sims.entries()];
  }

  floors(): FloorInfo[] {
    return this.entries().map(([roomId, sim]) => ({
      roomId,
      name: sim.room.name,
      kind: roomId === LOBBY_ROOM ? "lobby" : roomId === HR_ROOM ? "hr" : "project",
    }));
  }

  /** Adds the floor of a project. A project that already has a floor keeps it. */
  addProject(project: ProjectInfo): RoomId {
    const roomId = projectRoomId(project.id);
    if (!this.sims.has(roomId)) {
      const base = baseRoomForProject(this.template, project);
      this.bases.set(roomId, base);
      const room = roomForProject(this.template, project, this.savedLayout?.(project.id), this.savedExtras?.(project.id));
      this.sims.set(roomId, new WorldSim(room, this.clock, this.simOptions));
    }
    return roomId;
  }

  /**
   * Moves one piece of the user's project floor. `save` gets the floor's whole new layout after the checks and before
   * the change; if it throws nothing changes. Only project floors can be arranged.
   */
  moveFurniture(roomId: string, itemId: string, to: Placement, save?: (layout: Layout) => void): ArrangeResult {
    const sim = this.sims.get(roomId as RoomId);
    const base = this.bases.get(roomId as RoomId);
    if (!sim || !base) return NOT_EDITABLE;
    const r = checkMove(sim.room, itemId, to, { occupied: sim.tilesInUse() });
    return r.ok ? this.commit(sim, base, r.room, save) : r;
  }

  /** Puts every piece of the template back where it was. Bought pieces stay where they are, so a piece of the template that would land on one is refused: pick it up first. Refused while someone stands where a piece goes back to. */
  resetLayout(roomId: string, save?: (layout: Layout) => void): ArrangeResult {
    const sim = this.sims.get(roomId as RoomId);
    const base = this.bases.get(roomId as RoomId);
    if (!sim || !base) return NOT_EDITABLE;
    const inUse = new Set(sim.tilesInUse().map((t) => `${t.x},${t.y}`));
    for (const p of base.furni) {
      const def = FURNI_CATALOG[p.defId];
      const now = sim.room.furni.find((q) => q.itemId === p.itemId);
      if (!def || def.walkable || (now && now.x === p.x && now.y === p.y && now.dir === p.dir)) continue;
      if (footprintTiles(p, def).some((t) => inUse.has(`${t.x},${t.y}`))) return { ok: false, code: "occupied", reason: "Someone is standing there." };
    }
    const extras = this.extrasOf(sim, base);
    const target: RoomDef = extras.length === 0 ? base : { ...base, furni: [...base.furni, ...extras] };
    const problem = extras.length === 0 ? undefined : layoutProblem(target);
    // The template alone is always valid, so the problem comes from a piece that was placed.
    if (problem) return { ok: false, code: problem.code, reason: "A piece you placed is in the way. Pick it up first." };
    return this.commit(sim, base, target, save);
  }

  /** The bought pieces of a floor: everything in the room that the template does not have. */
  private extrasOf(sim: WorldSim, base: RoomDef): PlacedFurni[] {
    const ids = new Set(base.furni.map((p) => p.itemId));
    return sim.room.furni.filter((p) => !ids.has(p.itemId));
  }

  /** True when the piece is on the floor and is a bought one (the template does not have it). */
  isExtra(roomId: string, itemId: string): boolean {
    const sim = this.sims.get(roomId as RoomId);
    const base = this.bases.get(roomId as RoomId);
    if (!sim || !base) return false;
    return sim.room.furni.some((p) => p.itemId === itemId) && !base.furni.some((p) => p.itemId === itemId);
  }

  /**
   * Stands a new piece (a bought one) on a project floor, through the same checks as a move: floor, wall, overlaps,
   * standing spots, people, paths. Only pieces without a use of their own can be placed. `save` runs after the checks
   * and before the change, as for a move.
   */
  placeFurniture(roomId: string, piece: PlacedFurni, save?: (layout: Layout) => void): ArrangeResult {
    const sim = this.sims.get(roomId as RoomId);
    const base = this.bases.get(roomId as RoomId);
    if (!sim || !base) return NOT_EDITABLE;
    const def = FURNI_CATALOG[piece.defId];
    if (!def || isTemplatePiece(def)) return { ok: false, code: "unknown_item", reason: "That piece cannot be placed." };
    if (sim.room.furni.some((p) => p.itemId === piece.itemId)) return { ok: false, code: "duplicate", reason: "That piece is already on the floor." };
    const candidate: RoomDef = { ...sim.room, furni: [...sim.room.furni, piece] };
    const r = checkMove(candidate, piece.itemId, { x: piece.x, y: piece.y, dir: piece.dir }, { occupied: sim.tilesInUse() });
    return r.ok ? this.commit(sim, base, r.room, save) : r;
  }

  /** Takes a bought piece off the floor. The pieces of the template (desks, computer, mailbox, board, elevator...) are never picked up. */
  pickUpFurniture(roomId: string, itemId: string, save?: (layout: Layout) => void): ArrangeResult {
    const sim = this.sims.get(roomId as RoomId);
    const base = this.bases.get(roomId as RoomId);
    if (!sim || !base) return NOT_EDITABLE;
    if (base.furni.some((p) => p.itemId === itemId)) return { ok: false, code: "not_removable", reason: "That piece belongs to the room. You can move it, not pick it up." };
    if (!sim.room.furni.some((p) => p.itemId === itemId)) return { ok: false, code: "unknown_item", reason: "That piece is not in this room." };
    return this.commit(sim, base, { ...sim.room, furni: sim.room.furni.filter((p) => p.itemId !== itemId) }, save);
  }

  private commit(sim: WorldSim, base: RoomDef, room: RoomDef, save?: (layout: Layout) => void): ArrangeResult {
    const layout = layoutOf(base, room);
    try {
      save?.(layout);
    } catch {
      return { ok: false, code: "save_failed", reason: "The layout could not be saved." };
    }
    sim.updateRoom(room);
    return { ok: true, room, layout };
  }

  /** Removes the floor of a project. Users inside are moved to the lobby and returned with their new `welcome`. */
  removeProject(projectId: string): { userId: number; welcome: WelcomeMsg }[] {
    const roomId = projectRoomId(projectId);
    const sim = this.sims.get(roomId);
    if (!sim) return [];
    const moved: { userId: number; welcome: WelcomeMsg }[] = [];
    for (const [userId, at] of [...this.userRooms]) {
      if (at !== roomId) continue;
      const welcome = this.moveUser(userId, LOBBY_ROOM);
      if (welcome) moved.push({ userId, welcome });
    }
    this.sims.delete(roomId);
    this.bases.delete(roomId);
    return moved;
  }

  /** The user enters the hotel in the start room. A second join replaces the first user. */
  join(): { you: number; welcome: WelcomeMsg } {
    const roomId = this.has(this.startRoom) ? this.startRoom : LOBBY_ROOM;
    const sim = this.sims.get(roomId)!;
    const joined = sim.join();
    for (const [id, at] of [...this.userRooms]) {
      if (at !== roomId) this.sims.get(at)?.leave();
      this.userRooms.delete(id);
    }
    this.userRooms.set(joined.you, roomId);
    return joined;
  }

  /** The user disconnects. */
  leave(userId: number): void {
    const at = this.userRooms.get(userId);
    if (at) this.sims.get(at)?.leave();
    this.userRooms.delete(userId);
  }

  roomOf(userId: number): RoomId | undefined {
    return this.userRooms.get(userId);
  }

  /** Moves the user to another room, at that room's elevator. Undefined when the room does not exist or the user is not in the hotel. */
  moveUser(userId: number, roomId: string): WelcomeMsg | undefined {
    const from = this.userRooms.get(userId);
    const target = this.sims.get(roomId as RoomId);
    if (!from || !target) return undefined;
    this.sims.get(from)?.leave();
    this.userRooms.set(userId, roomId as RoomId);
    return target.join().welcome;
  }

  /** True while the user stands on the tile in front of an elevator, the only place where `go_to` is accepted. */
  atElevator(userId: number): boolean {
    const at = this.userRooms.get(userId);
    const sim = at ? this.sims.get(at) : undefined;
    const tile = sim?.tileOf(userId);
    if (!sim || !tile) return false;
    return sim.room.furni.some((p) => {
      if (FURNI_CATALOG[p.defId]?.interaction !== "elevator") return false;
      const u = useTile(p);
      return u.x === tile.x && u.y === tile.y;
    });
  }
}
