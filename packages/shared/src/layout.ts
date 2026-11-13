import { z } from "zod";
import { FURNI_CATALOG } from "./furni.ts";
import type { FurniDef } from "./furni.ts";
import { parseHeightmap } from "./geometry/heightmap.ts";
import type { Heightmap } from "./geometry/heightmap.ts";
import { canStep } from "./geometry/pathfind.ts";
import type { Tile } from "./geometry/pathfind.ts";
import { PlacedFurniSchema, buildPathGrid, footprintTiles, useTile } from "./room.ts";
import type { Anchor, PlacedFurni, RoomDef } from "./room.ts";

/**
 * Arranging a project floor (furni-move). Pure rules, no I/O: `checkMove` says whether one piece may go to a new
 * placement, `applyLayout` rebuilds a floor from the template and a saved layout, `layoutProblem` checks a whole room.
 * The world-server stores the layout and applies it; the client may run the same checks to colour tiles while dragging.
 */

type Catalog = Readonly<Record<string, FurniDef>>;

/** Where a piece stands: its corner tile and facing (0 north, 2 east, 4 south, 6 west). */
export const PlacementSchema = z.object({
  x: z.number().int().min(-100).max(100),
  y: z.number().int().min(-100).max(100),
  dir: PlacedFurniSchema.shape.dir,
});
export type Placement = z.infer<typeof PlacementSchema>;

export const LAYOUT_MAX_PIECES = 100;

const ItemIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/, "invalid item id");
const ProjectIdKeySchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,99}$/, "invalid project id");

/** The pieces of one floor that are not where the template put them. */
export const LayoutSchema = z
  .record(ItemIdSchema, PlacementSchema)
  .refine((l) => Object.keys(l).length <= LAYOUT_MAX_PIECES, `a layout has at most ${LAYOUT_MAX_PIECES} pieces`);
export type Layout = z.infer<typeof LayoutSchema>;

/** `data/layouts.json`. */
export const LayoutsFileSchema = z.record(ProjectIdKeySchema, LayoutSchema);
export type LayoutsFile = z.infer<typeof LayoutsFileSchema>;

export type MoveCode = "unknown_item" | "pinned" | "outside" | "taken" | "wall" | "spot" | "occupied" | "blocks_path";

export type MoveResult = { ok: true; room: RoomDef } | { ok: false; code: MoveCode; reason: string };

export interface LayoutProblem {
  code: MoveCode;
  itemId: string;
  reason: string;
}

export interface MoveOptions {
  /** Tiles where someone stands or walks (from the sim). A solid piece cannot cover them. */
  occupied?: readonly Tile[];
  catalog?: Catalog;
}

const REASONS: Record<Exclude<MoveCode, "blocks_path">, string> = {
  unknown_item: "That piece is not in this room.",
  pinned: "The elevator stays where it is.",
  outside: "That is outside the room.",
  taken: "That tile is taken.",
  wall: "This piece goes on a wall.",
  spot: "A standing spot of the team is on that tile.",
  occupied: "Someone is standing there.",
};

const tileKey = (t: Tile): string => `${t.x},${t.y}`;

/** The elevator (and a door) stay where they are: the elevator tile is where everybody enters the floor. */
export function isPinned(def: FurniDef | undefined): boolean {
  return def?.interaction === "elevator" || def?.interaction === "door";
}

/** Anchors that follow a piece take its place: the tile in front of it, facing it. */
function followAnchors(room: RoomDef, catalog: Catalog): Anchor[] {
  return room.anchors.map((a) => {
    if (a.follows === undefined) return a;
    const piece = room.furni.find((p) => p.itemId === a.follows);
    if (!piece || !catalog[piece.defId]) return a;
    const u = useTile(piece, catalog);
    return { ...a, x: u.x, y: u.y, dir: (piece.dir + 4) % 8 };
  });
}

/** The room with some pieces at new placements and every anchor that follows a piece recomputed. No checks. */
export function applyPlacements(room: RoomDef, placements: ReadonlyMap<string, Placement>, catalog: Catalog = FURNI_CATALOG): RoomDef {
  const furni = room.furni.map((p) => {
    const to = placements.get(p.itemId);
    return to ? { ...p, x: to.x, y: to.y, dir: to.dir } : p;
  });
  return { ...room, furni, anchors: followAnchors({ ...room, furni }, catalog) };
}

interface Ctx {
  room: RoomDef;
  catalog: Catalog;
  hm: Heightmap;
  /** Pieces on each tile (every piece counts, walkable or not). */
  owners: Map<string, string[]>;
  /** Anchors that do not follow a piece: the elevator door tile and the standing spots. */
  spots: Set<string>;
}

function makeCtx(room: RoomDef, catalog: Catalog): Ctx {
  const owners = new Map<string, string[]>();
  for (const p of room.furni) {
    const def = catalog[p.defId];
    if (!def) continue;
    for (const t of footprintTiles(p, def)) {
      const k = tileKey(t);
      const list = owners.get(k);
      if (list) list.push(p.itemId);
      else owners.set(k, [p.itemId]);
    }
  }
  const spots = new Set<string>([tileKey(room.door)]);
  for (const a of room.anchors) if (a.follows === undefined) spots.add(tileKey(a));
  return { room, catalog, hm: parseHeightmap(room.heightmap), owners, spots };
}

/** Wall pieces hug the north wall facing south (dir 4) or the west wall facing east (dir 2): the tile behind has no floor. */
function onWall(ctx: Ctx, p: PlacedFurni, def: FurniDef): boolean {
  const tiles = footprintTiles(p, def);
  if (p.dir === 4) {
    const top = Math.min(...tiles.map((t) => t.y));
    return tiles.filter((t) => t.y === top).every((t) => ctx.hm.height(t.x, t.y - 1) === null);
  }
  if (p.dir === 2) {
    const left = Math.min(...tiles.map((t) => t.x));
    return tiles.filter((t) => t.x === left).every((t) => ctx.hm.height(t.x - 1, t.y) === null);
  }
  return false;
}

function problem(code: Exclude<MoveCode, "blocks_path">, itemId: string): LayoutProblem {
  return { code, itemId, reason: REASONS[code] };
}

/** The rules that look at one piece alone: floor, tiles shared with other pieces, wall, standing spots. */
function pieceProblem(ctx: Ctx, p: PlacedFurni): LayoutProblem | undefined {
  const def = ctx.catalog[p.defId];
  if (!def) return problem("unknown_item", p.itemId);
  const tiles = footprintTiles(p, def);
  if (tiles.some((t) => ctx.hm.height(t.x, t.y) === null)) return problem("outside", p.itemId);
  if (tiles.some((t) => (ctx.owners.get(tileKey(t))?.length ?? 0) > 1)) return problem("taken", p.itemId);
  if (def.mount === "wall" && !onWall(ctx, p, def)) return problem("wall", p.itemId);
  if (!def.walkable && tiles.some((t) => ctx.spots.has(tileKey(t)))) return problem("spot", p.itemId);
  return undefined;
}

interface Target {
  tile: Tile;
  label: string;
  /** Piece the target belongs to. */
  itemId: string | undefined;
}

function anchorLabel(a: Anchor): string {
  if (a.name === "door") return "the elevator";
  if (a.name === "desk") return `the ${a.agent ?? "agent"} desk`;
  if (a.name.startsWith("home_")) return "a standing spot";
  return `the ${a.name}`;
}

/** Everything somebody must be able to walk to from the elevator: the use tile of each interactive piece, then each anchor. */
function targetsOf(ctx: Ctx): Target[] {
  const out: Target[] = [];
  for (const p of ctx.room.furni) {
    const def = ctx.catalog[p.defId];
    if (!def?.interaction || def.interaction === "elevator") continue;
    out.push({ tile: useTile(p, ctx.catalog), label: `the ${def.name.toLowerCase()}`, itemId: p.itemId });
  }
  for (const a of ctx.room.anchors) out.push({ tile: a, label: anchorLabel(a), itemId: a.follows });
  return out;
}

/** Tiles an avatar can walk to from the elevator door (the pathfinder's own steps). */
function reachableFromDoor(room: RoomDef): Set<string> {
  const grid = buildPathGrid(room);
  const seen = new Set<string>([tileKey(room.door)]);
  const queue: Tile[] = [{ x: room.door.x, y: room.door.y }];
  for (let i = 0; i < queue.length; i++) {
    const at = queue[i]!;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const next = { x: at.x + dx, y: at.y + dy };
        const k = tileKey(next);
        if (seen.has(k) || !canStep(grid, at, next)) continue;
        seen.add(k);
        queue.push(next);
      }
    }
  }
  return seen;
}

/** The first target that nobody can walk to, as a refusal. `movedId` is the piece that was just moved, if any. */
function reachProblem(ctx: Ctx, movedId?: string): LayoutProblem | undefined {
  const reached = reachableFromDoor(ctx.room);
  const lost = targetsOf(ctx).find((t) => !reached.has(tileKey(t.tile)));
  if (!lost) return undefined;
  const reason =
    movedId !== undefined && lost.itemId === movedId
      ? `Nobody could reach ${lost.label} from there.`
      : `Blocks the path to ${lost.label}.`;
  return { code: "blocks_path", itemId: movedId ?? lost.itemId ?? "", reason };
}

/** Checks a whole room: the first rule that fails, or undefined when the arrangement is valid. */
export function layoutProblem(room: RoomDef, catalog: Catalog = FURNI_CATALOG): LayoutProblem | undefined {
  const ctx = makeCtx(room, catalog);
  for (const p of room.furni) {
    const found = pieceProblem(ctx, p);
    if (found) return found;
  }
  return reachProblem(ctx);
}

/** Moves one piece, if the new arrangement is valid. The room is not changed; `room` of the result is the new one. */
export function checkMove(room: RoomDef, itemId: string, to: Placement, opts: MoveOptions = {}): MoveResult {
  const catalog = opts.catalog ?? FURNI_CATALOG;
  const fail = (p: { code: MoveCode; reason: string }): MoveResult => ({ ok: false, code: p.code, reason: p.reason });
  const piece = room.furni.find((p) => p.itemId === itemId);
  const def = piece ? catalog[piece.defId] : undefined;
  if (!piece || !def) return fail(problem("unknown_item", itemId));
  if (isPinned(def)) return fail(problem("pinned", itemId));

  const next = applyPlacements(room, new Map([[itemId, to]]), catalog);
  const ctx = makeCtx(next, catalog);
  const moved = next.furni.find((p) => p.itemId === itemId)!;
  const own = pieceProblem(ctx, moved);
  if (own) return fail(own);
  if (!def.walkable && opts.occupied) {
    const mine = new Set(footprintTiles(moved, def).map(tileKey));
    if (opts.occupied.some((t) => mine.has(tileKey(t)))) return fail(problem("occupied", itemId));
  }
  const lost = reachProblem(ctx, itemId);
  return lost ? fail(lost) : { ok: true, room: next };
}

/** The pieces of `room` that are not where `base` has them. */
export function layoutOf(base: RoomDef, room: RoomDef): Layout {
  const entries: [string, Placement][] = [];
  for (const p of room.furni) {
    const b = base.furni.find((x) => x.itemId === p.itemId);
    if (b && (b.x !== p.x || b.y !== p.y || b.dir !== p.dir)) entries.push([p.itemId, { x: p.x, y: p.y, dir: p.dir }]);
  }
  return Object.fromEntries(entries);
}

/**
 * The template with a saved layout. The layout is tried whole first (it was valid when it was saved). When it no longer
 * fits (the template changed), entries are tried one at a time for as long as one more fits, and the rest stay where
 * the template has them (`skipped`). Never throws.
 */
export function applyLayout(
  base: RoomDef,
  layout: Layout | undefined,
  catalog: Catalog = FURNI_CATALOG,
): { room: RoomDef; skipped: string[] } {
  const entries = Object.entries(layout ?? {}).filter(([id]) => {
    const piece = base.furni.find((p) => p.itemId === id);
    return piece !== undefined && !isPinned(catalog[piece.defId]);
  });
  if (entries.length === 0) return { room: base, skipped: [] };

  const whole = applyPlacements(base, new Map(entries), catalog);
  if (layoutProblem(whole, catalog) === undefined) return { room: whole, skipped: [] };

  let room = base;
  let pending = entries;
  while (pending.length > 0) {
    const left: [string, Placement][] = [];
    for (const [id, to] of pending) {
      const r = checkMove(room, id, to, { catalog });
      if (r.ok) room = r.room;
      else left.push([id, to]);
    }
    if (left.length === pending.length) break;
    pending = left;
  }
  return { room, skipped: pending.map(([id]) => id) };
}
