import { BOUGHT_PREFIX, PLACED_PER_FLOOR_MAX } from "./shop.ts";
import type { CatalogueItem, PlacedMap, PlacedPiece, Stock } from "./shop.ts";
import type { Placement } from "./layout.ts";
import type { PlacedFurni } from "./room.ts";

/**
 * Where the user's bought furniture is: in stock (not placed) or standing on a project floor. Pure rules, no I/O; the
 * world-server keeps `data/inventory.json` and the hotel decides whether a place on the floor is valid (`checkMove`).
 * Every function returns a new inventory and leaves its input alone. See the furni-shop design.
 */

export interface Inventory {
  stock: Stock;
  placed: PlacedMap;
  /** Number of the last piece placed: ids are never reused. */
  seq: number;
}

export function emptyInventory(): Inventory {
  return { stock: {}, placed: {}, seq: 0 };
}

const have = (stock: Stock, itemId: string): number => (Object.hasOwn(stock, itemId) ? (stock[itemId] ?? 0) : 0);

const withCount = (stock: Stock, itemId: string, count: number): Stock => {
  const { [itemId]: _gone, ...rest } = stock;
  return count > 0 ? { ...rest, [itemId]: count } : rest;
};

const placedOf = (placed: PlacedMap, projectId: string): readonly PlacedPiece[] => (Object.hasOwn(placed, projectId) ? (placed[projectId] ?? []) : []);

function withPlaced(placed: PlacedMap, projectId: string, pieces: readonly PlacedPiece[]): PlacedMap {
  const { [projectId]: _gone, ...rest } = placed;
  return pieces.length > 0 ? { ...rest, [projectId]: [...pieces] } : rest;
}

export type InventoryResult<T = object> = ({ ok: true; inventory: Inventory } & T) | { ok: false; reason: string };

/** The pieces of a project floor, in the order they were placed. */
export function piecesOf(inv: Inventory, projectId: string): readonly PlacedPiece[] {
  return placedOf(inv.placed, projectId);
}

/** A bought piece as the room draws it: the furniture definition of its catalogue item. Undefined when the item left the catalogue. */
export function furniOf(piece: PlacedPiece, items: readonly CatalogueItem[]): PlacedFurni | undefined {
  const item = items.find((i) => i.id === piece.itemId);
  return item ? { itemId: piece.id, defId: item.defId, x: piece.x, y: piece.y, dir: piece.dir } : undefined;
}

/**
 * Takes one item out of the stock and stands it on a project floor. Whether the spot is valid is the hotel's call (the
 * caller runs it before it keeps this result).
 */
export function placeFromStock(inv: Inventory, projectId: string, itemId: string, to: Placement): InventoryResult<{ piece: PlacedPiece }> {
  if (have(inv.stock, itemId) < 1) return { ok: false, reason: "You do not have that item." };
  const here = placedOf(inv.placed, projectId);
  if (here.length >= PLACED_PER_FLOOR_MAX) return { ok: false, reason: `This floor is full (${PLACED_PER_FLOOR_MAX} placed pieces).` };
  const seq = inv.seq + 1;
  const piece: PlacedPiece = { id: `${BOUGHT_PREFIX}${seq}`, itemId, x: to.x, y: to.y, dir: to.dir };
  return {
    ok: true,
    piece,
    inventory: { stock: withCount(inv.stock, itemId, have(inv.stock, itemId) - 1), placed: withPlaced(inv.placed, projectId, [...here, piece]), seq },
  };
}

/** A placed piece goes back to the stock. */
export function pickUpToStock(inv: Inventory, projectId: string, id: string): InventoryResult<{ piece: PlacedPiece }> {
  const here = placedOf(inv.placed, projectId);
  const piece = here.find((p) => p.id === id);
  if (!piece) return { ok: false, reason: "That piece is not one of yours." };
  return {
    ok: true,
    piece,
    inventory: { ...inv, stock: withCount(inv.stock, piece.itemId, have(inv.stock, piece.itemId) + 1), placed: withPlaced(inv.placed, projectId, here.filter((p) => p !== piece)) },
  };
}

/** A placed piece stands somewhere else. */
export function movePlaced(inv: Inventory, projectId: string, id: string, to: Placement): InventoryResult {
  const here = placedOf(inv.placed, projectId);
  if (!here.some((p) => p.id === id)) return { ok: false, reason: "That piece is not one of yours." };
  return { ok: true, inventory: { ...inv, placed: withPlaced(inv.placed, projectId, here.map((p) => (p.id === id ? { ...p, x: to.x, y: to.y, dir: to.dir } : p))) } };
}

/** Every piece of the floors in `projectIds` goes back to the stock. */
export function returnFloors(inv: Inventory, projectIds: Iterable<string>): Inventory {
  let stock = inv.stock;
  let placed = inv.placed;
  for (const projectId of projectIds) {
    const here = placedOf(placed, projectId);
    if (here.length === 0) continue;
    for (const p of here) stock = withCount(stock, p.itemId, have(stock, p.itemId) + 1);
    placed = withPlaced(placed, projectId, []);
  }
  return stock === inv.stock && placed === inv.placed ? inv : { ...inv, stock, placed };
}

/** The projects that have placed pieces. */
export function floorsWithPieces(inv: Inventory): string[] {
  return Object.keys(inv.placed);
}

/**
 * The pieces of a floor that the room could not take (the template changed under them, or their item left the
 * catalogue) go back to the stock. `visible` holds the room item ids that are on the floor.
 */
export function returnHidden(inv: Inventory, projectId: string, visible: ReadonlySet<string>): Inventory {
  const here = placedOf(inv.placed, projectId);
  const hidden = here.filter((p) => !visible.has(p.id));
  if (hidden.length === 0) return inv;
  let stock = inv.stock;
  for (const p of hidden) stock = withCount(stock, p.itemId, have(stock, p.itemId) + 1);
  return { ...inv, stock, placed: withPlaced(inv.placed, projectId, here.filter((p) => visible.has(p.id))) };
}
