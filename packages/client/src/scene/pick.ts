import { FURNI_CATALOG, LAYER, HEIGHT_UNIT, depthKey, footprintSize, footprintTiles, isSeatDef, screenToTile } from "@agentlife/shared";
import type { PlacedFurni, RoomDef } from "@agentlife/shared";

/**
 * Furniture under a point in room space (the world container's local coordinates).
 * A tall item covers screen area above its footprint, so the point is tested against the
 * footprint at several heights. Walkable items without an interaction (cobweb, rug) are not
 * pickable: clicking them is a plain move. A seat is pickable even when it is walkable (a chair): clicking it sits.
 * When several items match, the front-most wins.
 * Arrange mode passes `{ includeWalkable: true }`: a cobweb can be moved too.
 */
export function pickFurni(room: RoomDef, sx: number, sy: number, opts: { includeWalkable?: boolean } = {}): PlacedFurni | undefined {
  return pickAllFurni(room, sx, sy, opts)[0];
}

/**
 * Every piece under the point, front-most first. Arrange mode needs the whole list: a piece that stands behind another
 * (a plant behind the sofa) is under the same point, and the piece the user has selected must stay grabbable there.
 */
export function pickAllFurni(room: RoomDef, sx: number, sy: number, opts: { includeWalkable?: boolean } = {}): PlacedFurni[] {
  const hits: { piece: PlacedFurni; depth: number }[] = [];
  for (const p of room.furni) {
    const def = FURNI_CATALOG[p.defId];
    if (!def || (def.walkable && !def.interaction && !isSeatDef(def) && !opts.includeWalkable)) continue;
    const tiles = footprintTiles(p, def);
    let hit = false;
    for (let z = 0; z <= def.height && !hit; z += 0.5) {
      const t = screenToTile(sx, sy + z * HEIGHT_UNIT);
      hit = tiles.some((f) => f.x === t.x && f.y === t.y);
    }
    if (!hit) continue;
    const { w, l } = footprintSize(def, p.dir);
    hits.push({ piece: p, depth: depthKey({ x: p.x, y: p.y, w, l, layer: LAYER.furni }) });
  }
  // A stable sort: pieces with the same depth keep the order of the room.
  return hits.sort((a, b) => b.depth - a.depth).map((h) => h.piece);
}
