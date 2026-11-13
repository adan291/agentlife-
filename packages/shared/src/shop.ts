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

/** A definition the template needs: the shop never sells it. */
function isTemplatePiece(def: FurniDef): boolean {
  return def.interaction !== undefined || def.id === "agent_desk";
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

export const StockSchema = z.record(CatalogueItemIdSchema, z.number().int().min(1).max(INVENTORY_MAX));
export type Stock = z.infer<typeof StockSchema>;

export const InventoryFileSchema = z.object({ version: z.literal(1), stock: StockSchema });
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

export const StockEntrySchema = z.object({ itemId: CatalogueItemIdSchema, count: z.number().int().min(1).max(INVENTORY_MAX) });
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
