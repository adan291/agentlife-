import { FURNI_CATALOG } from "../furni.ts";
import { sanitize } from "../sanitize.ts";
import { useTile, validateRoom } from "../room.ts";
import type { RoomDef } from "../room.ts";
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
 * The floor of a project: the template with the room id of the project and its name as sign text.
 * The result is validated, so a bad template fails here and not when a user walks in.
 */
export function roomForProject(template: RoomDef, project: ProjectInfo): RoomDef {
  return validateRoom({ ...template, id: projectRoomId(project.id), kind: "project", name: signText(project.name, project.id) });
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
}

export interface FloorInfo {
  roomId: RoomId;
  name: string;
  kind: FloorKind;
}

/**
 * The rooms of the hotel: one `WorldSim` each. A user is in exactly one room; moving leaves the old room and joins the
 * new one at its elevator. Pure (no I/O, no timers), like `WorldSim`.
 */
export class Hotel {
  private readonly sims = new Map<RoomId, WorldSim>();
  private readonly userRooms = new Map<number, RoomId>();
  private readonly template: RoomDef;
  private readonly clock: () => number;
  private readonly simOptions: WorldSimOptions;
  private readonly startRoom: RoomId;

  constructor(opts: HotelOptions) {
    this.template = opts.template;
    this.clock = opts.clock;
    this.simOptions = opts.sim ?? {};
    this.startRoom = opts.startRoom ?? LOBBY_ROOM;
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
      this.sims.set(roomId, new WorldSim(roomForProject(this.template, project), this.clock, this.simOptions));
    }
    return roomId;
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
