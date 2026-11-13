import { z } from "zod";
import { LEDGER_MAX, keepLast } from "./economy.ts";
import type { LedgerEntry, Wallet } from "./economy.ts";
import { FURNI_CATALOG } from "./furni.ts";
import type { FurniDef } from "./furni.ts";

/**
 * The shop of the hotel (furni-shop): the catalogue, the stock of bought items and the purchase rule. Pure; the
 * world-server keeps the files. See the spec's design.md.
 */

/** Items in stock (bought and not placed). */
export const INVENTORY_MAX = 200;
export const PRICE_MAX = 10_000;
/** The catalogue sells at least this many items. */
export const CATALOGUE_MIN_ITEMS = 24;

export const SHOP_PAGES = ["seating", "tables", "lights", "plants", "spooky", "walls"] as const;
export const ShopPageSchema = z.enum(SHOP_PAGES);
export type ShopPage = z.infer<typeof ShopPageSchema>;

export const PAGE_LABELS: Readonly<Record<ShopPage, string>> = {
  seating: "Seating",
  tables: "Tables",
  lights: "Lights",
  plants: "Plants",
  spooky: "Spooky",
  walls: "Walls",
};

export const CatalogueItemIdSchema = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/);

export const CatalogueItemSchema = z.object({
  id: CatalogueItemIdSchema,
  name: z.string().min(1).max(40),
  page: ShopPageSchema,
  price: z.number().int().min(1).max(PRICE_MAX),
  /** The furniture definition (`FURNI_CATALOG`) that is drawn and placed. */
  defId: z.string().min(1).max(100),
});
export type CatalogueItem = z.infer<typeof CatalogueItemSchema>;

/** `config/catalogue-furni.json`. */
export const CatalogueFileSchema = z.object({ version: z.literal(1), items: z.array(CatalogueItemSchema).max(200) });
export type CatalogueFile = z.infer<typeof CatalogueFileSchema>;

/**
 * Interactions a piece that is for sale may have. Nothing sold starts work: the coffee machine only changes the mood of a
 * ghost, which is for show. Any other interaction belongs to the template.
 */
export const SHOP_INTERACTIONS: readonly string[] = ["coffee"];

/** A definition the template needs: the shop never sells it. */
export function isTemplatePiece(def: FurniDef): boolean {
  return (def.interaction !== undefined && !SHOP_INTERACTIONS.includes(def.interaction)) || def.id === "agent_desk";
}

/** Every problem of a catalogue, in words. Empty means the shop can open. */
export function checkCatalogue(items: readonly CatalogueItem[], catalog: Readonly<Record<string, FurniDef>> = FURNI_CATALOG): string[] {
  const problems: string[] = [];
  if (items.length < CATALOGUE_MIN_ITEMS) problems.push(`the catalogue has ${items.length} items, at least ${CATALOGUE_MIN_ITEMS} are required`);
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) problems.push(`duplicate item id '${item.id}'`);
    seen.add(item.id);
    const def = Object.hasOwn(catalog, item.defId) ? catalog[item.defId] : undefined;
    if (!def) problems.push(`item '${item.id}' uses the unknown furniture '${item.defId}'`);
    else if (isTemplatePiece(def)) problems.push(`item '${item.id}' is template furniture ('${item.defId}'), which is not for sale`);
  }
  return problems;
}

// ---- data/inventory.json ----

/**
 * Most of one item in stock. `INVENTORY_MAX` limits purchases only: pieces that come back (picked up, or from a removed
 * project) always fit, so a stock may pass 200 without the file becoming invalid.
 */
export const STOCK_COUNT_MAX = 100_000;
export const StockSchema = z.record(CatalogueItemIdSchema, z.number().int().min(1).max(STOCK_COUNT_MAX));
export type Stock = z.infer<typeof StockSchema>;

/** Placed bought pieces on one project floor, at most. */
export const PLACED_PER_FLOOR_MAX = 60;
/** The room item id of a bought piece starts with this (a template piece never does). */
export const BOUGHT_PREFIX = "bought_";

/** True for the id of a bought piece (`bought_<n>`). The server decides by what it stored; the client uses this to label the UI. */
export function isBoughtId(itemId: string): boolean {
  return /^bought_[0-9]{1,9}$/.test(itemId);
}

const PlacedDirSchema = z.union([z.literal(0), z.literal(2), z.literal(4), z.literal(6)]);

/** A bought piece standing on a project floor. `id` is its room item id, `itemId` the catalogue item it came from. */
export const PlacedPieceSchema = z.object({
  id: z.string().regex(/^bought_[0-9]{1,9}$/),
  itemId: CatalogueItemIdSchema,
  x: z.number().int().min(-100).max(100),
  y: z.number().int().min(-100).max(100),
  dir: PlacedDirSchema,
});
export type PlacedPiece = z.infer<typeof PlacedPieceSchema>;

/** Placed pieces of each project floor. */
export const PlacedMapSchema = z.record(z.string().regex(/^[a-z0-9][a-z0-9-]{0,99}$/), z.array(PlacedPieceSchema).min(1).max(PLACED_PER_FLOOR_MAX));
export type PlacedMap = z.infer<typeof PlacedMapSchema>;

/**
 * `data/inventory.json`. `placed` and `seq` have defaults, so the file written before pieces could be placed stays valid.
 * `seq` is the number of the last bought piece placed: ids are never reused.
 */
export const InventoryFileSchema = z.object({
  version: z.literal(1),
  stock: StockSchema,
  placed: PlacedMapSchema.default({}),
  seq: z.number().int().min(0).max(999_999_999).default(0),
});
export type InventoryFile = z.infer<typeof InventoryFileSchema>;

export function stockCount(stock: Stock): number {
  return Object.values(stock).reduce((sum, n) => sum + n, 0);
}

// ---- purchase ----

export const PURCHASE_CODES = ["unknown_item", "not_enough_ecto", "inventory_full"] as const;
export type PurchaseCode = (typeof PURCHASE_CODES)[number];

export type PurchaseResult =
  | { ok: true; wallet: Wallet; stock: Stock; entry: LedgerEntry }
  | { ok: false; code: PurchaseCode; reason: string };

/**
 * Buys one item. The first rule that fails answers and nothing changes: the item must be in the catalogue, the balance
 * must cover the price, and the stock must have room. The balance only ever falls by what it holds.
 */
export function applyPurchase(wallet: Wallet, stock: Stock, item: CatalogueItem | undefined, ts: number): PurchaseResult {
  if (!item) return { ok: false, code: "unknown_item", reason: "That item is not in the shop." };
  if (wallet.balance < item.price) {
    return { ok: false, code: "not_enough_ecto", reason: `You need ${item.price} Ecto and have ${wallet.balance}.` };
  }
  if (stockCount(stock) >= INVENTORY_MAX) {
    return { ok: false, code: "inventory_full", reason: `Your inventory is full (${INVENTORY_MAX} items).` };
  }
  const entry: LedgerEntry = { ts, amount: -item.price, reason: "purchase", ref: item.id };
  const had = Object.hasOwn(stock, item.id) ? (stock[item.id] ?? 0) : 0;
  return {
    ok: true,
    wallet: { ...wallet, balance: wallet.balance - item.price, ledger: keepLast([...wallet.ledger, entry], LEDGER_MAX) },
    stock: { ...stock, [item.id]: had + 1 },
    entry,
  };
}

// ---- what the server tells the client ----

export const StockEntrySchema = z.object({ itemId: CatalogueItemIdSchema, count: z.number().int().min(1).max(STOCK_COUNT_MAX) });
export type StockEntry = z.infer<typeof StockEntrySchema>;

/** The whole shop as the panel needs it. Sent when it opens, on `shop_state` and after a purchase. */
export const ShopStateSchema = z.object({
  balance: z.number().int().nonnegative(),
  items: z.array(CatalogueItemSchema).max(200),
  stock: z.array(StockEntrySchema).max(200),
  stockMax: z.literal(INVENTORY_MAX),
});
export type ShopState = z.infer<typeof ShopStateSchema>;

/** Stock as the list the client gets, in catalogue order. Items no longer in the catalogue are kept at the end. */
export function stockList(stock: Stock, items: readonly CatalogueItem[]): StockEntry[] {
  const order = new Map(items.map((item, i) => [item.id, i]));
  return Object.entries(stock)
    .map(([itemId, count]) => ({ itemId, count }))
    .sort((a, b) => (order.get(a.itemId) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.itemId) ?? Number.MAX_SAFE_INTEGER) || a.itemId.localeCompare(b.itemId));
}
