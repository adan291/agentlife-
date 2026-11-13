import { z } from "zod";
import { FURNI_CATALOG } from "./furni.ts";
import type { FurniDef } from "./furni.ts";
import { parseHeightmap } from "./geometry/heightmap.ts";
import type { Heightmap } from "./geometry/heightmap.ts";
import type { PathGrid, Tile } from "./geometry/pathfind.ts";

export const AGENT_IDS = ["architect", "developer", "qa", "builder"] as const;
export const AgentIdSchema = z.enum(AGENT_IDS);
export type AgentId = z.infer<typeof AgentIdSchema>;

/**
 * Standing spots of a project floor for the team members who do not hold a role's desk: a second developer, a reviewer,
 * a researcher, the Night intern (hr-desk requirement 4.3, decision "every member is visible"). A guest id names a
 * spot, not a person; the world-server says who stands there (`team_view`). Guests are not agents: they have no state,
 * no work and no events, only an avatar that stands, walks to the elevator when they are let go, and walks back.
 */
export const GUEST_IDS = ["guest1", "guest2", "guest3", "guest4", "guest5", "guest6"] as const;
export const GuestIdSchema = z.enum(GUEST_IDS);
export type GuestId = z.infer<typeof GuestIdSchema>;

export function isGuestId(id: unknown): id is GuestId {
  return typeof id === "string" && (GUEST_IDS as readonly string[]).includes(id);
}

/** Everyone who has a home tile in a room: the agents and the guests. */
export const StaffIdSchema = z.enum([...AGENT_IDS, ...GUEST_IDS]);
export type StaffId = z.infer<typeof StaffIdSchema>;

/** Roles that work for a project. The Builder is not a project agent: it lives in the lobby. */
export const PROJECT_ROLES = ["architect", "developer", "qa"] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];

/**
 * Agent id as it appears in engine events: a plain id, or `<projectId>:<role>` for the team of one project
 * (hotel-floors, requirement 3.2). The world-server maps a scoped id to the agent of the same role in that project's room.
 */
export type ScopedAgentId = AgentId | `${string}:${ProjectRole}`;

const SCOPED_AGENT_ID = /^[a-z0-9][a-z0-9-]{0,59}:(architect|developer|qa)$/;

export const ScopedAgentIdSchema = z.custom<ScopedAgentId>(
  (v) => typeof v === "string" && ((AGENT_IDS as readonly string[]).includes(v) || SCOPED_AGENT_ID.test(v)),
  "invalid agent id",
);

export function scopeAgentId(projectId: string, role: ProjectRole): ScopedAgentId {
  return `${projectId}:${role}`;
}

/** Splits a scoped id into its project (absent for a plain id) and the agent of the room. */
export function splitAgentId(id: ScopedAgentId): { projectId?: string; agentId: AgentId } {
  const i = id.indexOf(":");
  if (i < 0) return { agentId: id as AgentId };
  return { projectId: id.slice(0, i), agentId: id.slice(i + 1) as AgentId };
}

/** Anchor names a room defines. `desk` anchors carry an `agent`. */
export const AnchorNameSchema = z.enum([
  "desk",
  "board",
  "computer",
  "mailbox",
  "door",
  "home_architect",
  "home_developer",
  "home_qa",
  "home_builder",
  "home_guest1",
  "home_guest2",
  "home_guest3",
  "home_guest4",
  "home_guest5",
  "home_guest6",
]);
export type AnchorName = z.infer<typeof AnchorNameSchema>;

/** Names the agent-engine uses; `home` resolves to `home_<agent>`, `desk` to that agent's desk. */
export const SemanticAnchorSchema = z.enum(["desk", "board", "computer", "mailbox", "door", "home"]);
export type SemanticAnchor = z.infer<typeof SemanticAnchorSchema>;

const DirSchema = z.number().int().min(0).max(7);

export const AnchorSchema = z.object({
  name: AnchorNameSchema,
  x: z.number().int(),
  y: z.number().int(),
  /** Direction the avatar faces when standing on the anchor (0-7). */
  dir: DirSchema,
  /** Owner of a `desk` anchor. */
  agent: AgentIdSchema.optional(),
  /**
   * Item id of the piece this anchor belongs to (furni-move): the anchor is the tile in front of that piece and
   * moves with it. `checkRoom` makes sure the coordinates agree.
   */
  follows: z.string().min(1).max(100).optional(),
});
export type Anchor = z.infer<typeof AnchorSchema>;

export const PlacedFurniSchema = z.object({
  itemId: z.string().min(1),
  defId: z.string().min(1),
  x: z.number().int(),
  y: z.number().int(),
  /** Facing: 0 north (-y), 2 east (+x), 4 south (+y), 6 west (-x). */
  dir: z.union([z.literal(0), z.literal(2), z.literal(4), z.literal(6)]),
  /** Target room of a `door`. */
  to: z.string().min(1).max(100).optional(),
});
export type PlacedFurni = z.infer<typeof PlacedFurniSchema>;

/**
 * What a room is for. A `project` room is an office with the computer, mailbox and board and the project's team;
 * the `lobby` holds the Reception, the elevator and the Builder; `hr` has no agents yet. A room without a kind is the
 * single office of the first versions (all four agents).
 */
export const RoomKindSchema = z.enum(["project", "lobby", "hr"]);
export type RoomKind = z.infer<typeof RoomKindSchema>;

export const RoomDefSchema = z.object({
  id: z.string().min(1),
  /** Shown on the door sign, the board and the floor list. */
  name: z.string().min(1),
  kind: RoomKindSchema.optional(),
  heightmap: z.array(z.string().regex(/^[x0-9]+$/, "only 'x' and digits 0-9")).min(1),
  door: AnchorSchema,
  anchors: z.array(AnchorSchema),
  furni: z.array(PlacedFurniSchema),
});
export type RoomDef = z.infer<typeof RoomDefSchema>;

/** Agents that live in a room, in display order. */
export function roomAgents(room: Pick<RoomDef, "kind">): readonly AgentId[] {
  switch (room.kind) {
    case "project":
      return PROJECT_ROLES;
    case "lobby":
      return ["builder"];
    case "hr":
      return [];
    default:
      return AGENT_IDS;
  }
}

/** Standing spots of the team's other members: only project floors have them. */
export function roomGuests(room: Pick<RoomDef, "kind">): readonly GuestId[] {
  return room.kind === "project" ? GUEST_IDS : [];
}

export interface RoomIssue {
  /** Dotted path of the invalid field, e.g. `furni.2.x`. */
  path: string;
  message: string;
}

export class RoomValidationError extends Error {
  readonly issues: RoomIssue[];
  constructor(issues: RoomIssue[]) {
    super(`Invalid room definition:\n${issues.map((i) => `  ${i.path}: ${i.message}`).join("\n")}`);
    this.name = "RoomValidationError";
    this.issues = issues;
  }
}

type Catalog = Readonly<Record<string, FurniDef>>;

/** Footprint size after applying the placement direction (dir 2/6 swap w and l). */
export function footprintSize(def: FurniDef, dir: number): { w: number; l: number } {
  return dir === 2 || dir === 6 ? { w: def.l, l: def.w } : { w: def.w, l: def.l };
}

export function footprintTiles(p: PlacedFurni, def: FurniDef): Tile[] {
  const { w, l } = footprintSize(def, p.dir);
  const tiles: Tile[] = [];
  for (let dx = 0; dx < w; dx++) for (let dy = 0; dy < l; dy++) tiles.push({ x: p.x + dx, y: p.y + dy });
  return tiles;
}

/** Tile directly in front of the footprint, according to the item's facing. */
export function useTile(p: PlacedFurni, catalog: Catalog = FURNI_CATALOG): Tile {
  const def = catalog[p.defId];
  if (!def) throw new Error(`unknown furniture def '${p.defId}'`);
  const { w, l } = footprintSize(def, p.dir);
  switch (p.dir) {
    case 0:
      return { x: p.x, y: p.y - 1 };
    case 2:
      return { x: p.x + w, y: p.y };
    case 4:
      return { x: p.x, y: p.y + l };
    case 6:
      return { x: p.x - 1, y: p.y };
  }
}

/**
 * Find the anchor for an engine-level name. `desk` needs the agent and returns that agent's desk;
 * `home` returns `home_<agent>`. Other names return the first matching anchor (`door` is the room door).
 */
export function resolveAnchor(
  room: RoomDef,
  anchor: SemanticAnchor | AnchorName,
  agentId?: StaffId,
): Anchor | undefined {
  if (anchor === "door") return room.door;
  if (anchor === "desk") {
    return agentId ? room.anchors.find((a) => a.name === "desk" && a.agent === agentId) : undefined;
  }
  if (anchor === "home") {
    return agentId ? room.anchors.find((a) => a.name === `home_${agentId}`) : undefined;
  }
  return room.anchors.find((a) => a.name === anchor);
}

/** PathGrid for a room: floor from the heightmap, blocked by non-walkable furniture footprints. */
export function buildPathGrid(room: RoomDef, catalog: Catalog = FURNI_CATALOG): PathGrid & Heightmap {
  const hm = parseHeightmap(room.heightmap);
  const blocked = new Set<string>();
  for (const p of room.furni) {
    const def = catalog[p.defId];
    if (!def || def.walkable) continue;
    for (const t of footprintTiles(p, def)) blocked.add(`${t.x},${t.y}`);
  }
  return { ...hm, blocked: (x, y) => blocked.has(`${x},${y}`) };
}

/** Semantic checks beyond the structural schema. Returns every problem found. */
export function checkRoom(room: RoomDef, catalog: Catalog = FURNI_CATALOG): RoomIssue[] {
  const issues: RoomIssue[] = [];
  const add = (path: string, message: string) => issues.push({ path, message });

  let hm: Heightmap;
  try {
    hm = parseHeightmap(room.heightmap);
  } catch (e) {
    return [{ path: "heightmap", message: e instanceof Error ? e.message : String(e) }];
  }
  const onFloor = (t: Tile) => hm.height(t.x, t.y) !== null;

  // Furniture: known def, footprint on the floor, unique ids, no overlap of solid items.
  const ids = new Set<string>();
  const solid = new Map<string, string>();
  room.furni.forEach((p, i) => {
    const base = `furni.${i}`;
    if (ids.has(p.itemId)) add(`${base}.itemId`, `duplicate item id '${p.itemId}'`);
    ids.add(p.itemId);
    const def = catalog[p.defId];
    if (!def) return add(`${base}.defId`, `unknown furniture def '${p.defId}'`);
    for (const t of footprintTiles(p, def)) {
      if (!onFloor(t)) add(`${base}.x`, `footprint tile (${t.x}, ${t.y}) is outside the floor`);
      if (!def.walkable) {
        const k = `${t.x},${t.y}`;
        const other = solid.get(k);
        if (other) add(`${base}.x`, `overlaps '${other}' at (${t.x}, ${t.y})`);
        else solid.set(k, p.itemId);
      }
    }
  });
  const isSolid = (t: Tile) => solid.has(`${t.x},${t.y}`);
  const walkable = (t: Tile) => onFloor(t) && !isSolid(t);

  // Anchors must be standing spots.
  const checkAnchor = (a: Anchor, path: string) => {
    if (!onFloor(a)) add(`${path}.x`, `anchor '${a.name}' at (${a.x}, ${a.y}) is outside the floor`);
    else if (isSolid(a)) add(`${path}.x`, `anchor '${a.name}' at (${a.x}, ${a.y}) is blocked by furniture`);
  };
  if (room.door.name !== "door") add("door.name", "door anchor must be named 'door'");
  checkAnchor(room.door, "door");
  room.anchors.forEach((a, i) => checkAnchor(a, `anchors.${i}`));

  // Required anchors: the office furniture in an office, and a home and a desk for each agent of the room.
  const office = room.kind === undefined || room.kind === "project";
  const agents = roomAgents(room);
  const required: AnchorName[] = [
    ...(office ? (["computer", "mailbox", "board"] as const) : []),
    ...agents.map((a) => `home_${a}` as const),
    ...roomGuests(room).map((g) => `home_${g}` as const),
  ];
  for (const n of required) {
    if (!room.anchors.some((a) => a.name === n)) add("anchors", `missing anchor '${n}'`);
  }
  for (const agent of agents) {
    if (!room.anchors.some((a) => a.name === "desk" && a.agent === agent)) {
      add("anchors", `missing 'desk' anchor for agent '${agent}'`);
    }
  }
  room.anchors.forEach((a, i) => {
    if (a.agent && !agents.includes(a.agent)) add(`anchors.${i}.agent`, `agent '${a.agent}' does not live in this room`);
  });
  room.anchors.forEach((a, i) => {
    if (a.name === "desk" && !a.agent) add(`anchors.${i}.agent`, "'desk' anchor needs an agent");
  });

  // An anchor that follows a piece is the tile in front of it, facing it.
  room.anchors.forEach((a, i) => {
    if (a.follows === undefined) return;
    const piece = room.furni.find((p) => p.itemId === a.follows);
    if (!piece || !catalog[piece.defId]) return add(`anchors.${i}.follows`, `anchor '${a.name}' follows unknown piece '${a.follows}'`);
    const u = useTile(piece, catalog);
    if (u.x !== a.x || u.y !== a.y || a.dir !== (piece.dir + 4) % 8) {
      add(`anchors.${i}.follows`, `anchor '${a.name}' is not on the tile in front of '${a.follows}' (${u.x}, ${u.y}), facing it`);
    }
  });

  // Interactive items need a walkable use tile.
  room.furni.forEach((p, i) => {
    const def = catalog[p.defId];
    if (def?.interaction === "door" && !p.to) add(`furni.${i}.to`, `door '${p.itemId}' needs a target room`);
    if (def && def.interaction !== "door" && p.to) add(`furni.${i}.to`, `only a door has a target room ('${p.itemId}')`);
    if (!def?.interaction) return;
    const u = useTile(p, catalog);
    if (!walkable(u)) add(`furni.${i}.dir`, `use tile (${u.x}, ${u.y}) of '${p.itemId}' is not walkable`);
  });

  return issues;
}

/** Parse and fully validate untrusted room JSON. Throws RoomValidationError naming each invalid field. */
export function validateRoom(input: unknown, catalog: Catalog = FURNI_CATALOG): RoomDef {
  const parsed = RoomDefSchema.safeParse(input);
  if (!parsed.success) {
    throw new RoomValidationError(
      parsed.error.issues.map((i) => ({ path: i.path.join(".") || "(root)", message: i.message })),
    );
  }
  const issues = checkRoom(parsed.data, catalog);
  if (issues.length > 0) throw new RoomValidationError(issues);
  return parsed.data;
}
