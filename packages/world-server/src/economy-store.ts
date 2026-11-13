import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CatalogueFileSchema,
  EconomyConfigSchema,
  INVENTORY_MAX,
  InventoryFileSchema,
  WalletSchema,
  applyGrant,
  applyPurchase,
  checkCatalogue,
  emptyInventory,
  floorsWithPieces,
  furniOf,
  grantKey,
  movePlaced,
  newWallet,
  pickUpToStock,
  piecesOf,
  placeFromStock,
  returnFloors,
  returnHidden,
  stockCount,
  stockList,
} from "@agentlife/shared";
import type { CatalogueItem, EconomyConfig, GrantReason, Inventory, LedgerEntry, Placement, PlacedFurni, ShopState, Wallet } from "@agentlife/shared";
import { readJsonFile, writeJsonFile } from "./json-file.ts";

const here = dirname(fileURLToPath(import.meta.url));
export const CONFIG_DIR = join(here, "..", "config");
const DATA_DIR = join(here, "..", "..", "..", "data");

/** `data/wallet.json` at the repository root, or `AGENTLIFE_WALLET_FILE`. */
export function defaultWalletFile(env: NodeJS.ProcessEnv = process.env): string {
  return env["AGENTLIFE_WALLET_FILE"] ?? join(DATA_DIR, "wallet.json");
}

/** `data/inventory.json` at the repository root, or `AGENTLIFE_INVENTORY_FILE`. */
export function defaultInventoryFile(env: NodeJS.ProcessEnv = process.env): string {
  return env["AGENTLIFE_INVENTORY_FILE"] ?? join(DATA_DIR, "inventory.json");
}

/** Reads and checks `config/economy.json`. Throws with the reason when it is wrong. */
export function loadEconomyConfig(file: string = join(CONFIG_DIR, "economy.json")): EconomyConfig {
  return EconomyConfigSchema.parse(JSON.parse(readFileSync(file, "utf8")));
}

/** Reads and checks `config/catalogue-furni.json` against the furniture definitions. Throws with every problem when it is wrong. */
export function loadCatalogue(file: string = join(CONFIG_DIR, "catalogue-furni.json")): CatalogueItem[] {
  const items = CatalogueFileSchema.parse(JSON.parse(readFileSync(file, "utf8"))).items;
  const problems = checkCatalogue(items);
  if (problems.length > 0) throw new Error(`${file}:\n  ${problems.join("\n  ")}`);
  return items;
}

export interface EconomyOptions {
  walletFile: string;
  /** Default: `defaultInventoryFile()`. */
  inventoryFile?: string;
  config: EconomyConfig;
  /** What the shop sells. Default: `loadCatalogue()`. */
  catalogue?: readonly CatalogueItem[];
  now?: () => number;
  onLog?: (message: string) => void;
}

export type BuyResult = { ok: true; entry: LedgerEntry } | { ok: false; reason: string };

/**
 * A change to the inventory that has been worked out but not kept yet. `commit` writes the file and then updates the
 * memory; it throws when the file cannot be written, and then nothing changed. The hotel calls it between its own checks
 * and its change of the room, so a floor and the inventory never disagree.
 */
export interface InventoryPlan {
  commit(): void;
}
export type PlacePlan = { ok: true; piece: PlacedFurni; commit(): void } | { ok: false; reason: string };
export type ChangePlan = ({ ok: true } & InventoryPlan) | { ok: false; reason: string };

/**
 * The user's Ecto and what they bought: the balance in `data/wallet.json`, the stock and the pieces placed on the floors
 * in `data/inventory.json`, the grants that fill the wallet and the purchases that empty it. The rules are the shared ones
 * (`applyGrant`, `applyPurchase`, `placeFromStock`...); this class owns the files. A wallet that has no file yet is
 * created and written at once, so its `since` (the moment older events stop paying) survives a restart even before the
 * first grant.
 */
export class Economy {
  private wallet: Wallet;
  private inventory: Inventory;
  private readonly file: string;
  private readonly inventoryFile: string;
  private readonly config: EconomyConfig;
  private readonly items: readonly CatalogueItem[];
  private readonly now: () => number;
  private readonly log: (message: string) => void;

  constructor(opts: EconomyOptions) {
    this.file = opts.walletFile;
    this.inventoryFile = opts.inventoryFile ?? defaultInventoryFile();
    this.config = opts.config;
    this.items = opts.catalogue ?? loadCatalogue();
    this.log = opts.onLog ?? (() => undefined);
    this.now = opts.now ?? Date.now;
    const loaded = readJsonFile(this.file, WalletSchema, { now: this.now, onLog: this.log });
    this.wallet = loaded ?? newWallet(this.now());
    if (!loaded) this.trySave(this.file, this.wallet);
    const file = readJsonFile(this.inventoryFile, InventoryFileSchema, { now: this.now, onLog: this.log });
    this.inventory = file ? { stock: file.stock, placed: file.placed, seq: file.seq } : emptyInventory();
  }

  get balance(): number {
    return this.wallet.balance;
  }

  /** The last ledger entries, oldest first. */
  get ledger(): readonly LedgerEntry[] {
    return this.wallet.ledger;
  }

  /** Epoch ms from which events pay. */
  get since(): number {
    return this.wallet.since;
  }

  /** The whole shop for the client: catalogue, balance and stock. */
  shop(): ShopState {
    return { balance: this.wallet.balance, items: [...this.items], stock: stockList(this.inventory.stock, this.items), stockMax: INVENTORY_MAX };
  }

  /** Items in stock (bought and not placed). */
  get stockTotal(): number {
    return stockCount(this.inventory.stock);
  }

  private trySave(file: string, value: unknown): boolean {
    try {
      writeJsonFile(file, value);
      return true;
    } catch (e) {
      this.log(`cannot write ${file}: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  }

  private inventoryFileOf(inv: Inventory): { version: 1; stock: Inventory["stock"]; placed: Inventory["placed"]; seq: number } {
    return { version: 1, stock: inv.stock, placed: inv.placed, seq: inv.seq };
  }

  /**
   * Grants the amount `config/economy.json` sets for the reason, once per `reason` and `ref`. A daily quest has no fixed
   * amount: `quest_done` takes the quest's reward as `amount`. Returns the ledger entry
   * when the balance went up, and undefined when nothing was counted (already counted, older than the wallet, or the
   * file could not be written: then nothing is counted and a later replay tries again).
   */
  grant(reason: GrantReason, ref: string, ts: number, amount?: number): LedgerEntry | undefined {
    const fixed = reason === "quest_done" ? undefined : this.config.grants[reason];
    const paid = amount ?? fixed;
    if (paid === undefined) return undefined;
    const result = applyGrant(this.wallet, { reason, ref, amount: paid, ts });
    if (result.wallet === this.wallet) return undefined;
    const before = this.wallet;
    this.wallet = result.wallet;
    if (!this.trySave(this.file, this.wallet)) {
      this.wallet = before;
      return undefined;
    }
    return result.entry;
  }

  /** True when this grant is already in the wallet (counted before), whatever its amount was. A payout that was paid before a crash is settled by it. */
  hasGranted(reason: GrantReason, ref: string): boolean {
    return this.wallet.granted.includes(grantKey(reason, ref));
  }

  /**
   * Buys one item for the price in the catalogue. A refusal says why and changes nothing. The inventory file is written
   * first and the wallet second: a crash between them gives an item for free, never an empty wallet for nothing. If the
   * second write fails the first is written back, memory is restored and the purchase is refused.
   */
  buy(itemId: string): BuyResult {
    const item = this.items.find((i) => i.id === itemId);
    const result = applyPurchase(this.wallet, this.inventory.stock, item, this.now());
    if (!result.ok) return { ok: false, reason: result.reason };
    const before = this.inventory;
    const next: Inventory = { ...before, stock: result.stock };
    if (!this.trySave(this.inventoryFile, this.inventoryFileOf(next))) return { ok: false, reason: "Could not save your purchase." };
    if (!this.trySave(this.file, result.wallet)) {
      this.trySave(this.inventoryFile, this.inventoryFileOf(before));
      return { ok: false, reason: "Could not save your purchase." };
    }
    this.wallet = result.wallet;
    this.inventory = next;
    return { ok: true, entry: result.entry };
  }

  // ---- bought furniture on the floors (task 3) ----

  /** A plan that keeps `next` as the inventory once committed. */
  private planOf(next: Inventory): InventoryPlan {
    return {
      commit: () => {
        if (!this.trySave(this.inventoryFile, this.inventoryFileOf(next))) throw new Error("cannot write the inventory");
        this.inventory = next;
      },
    };
  }

  /** The bought pieces on a project floor as the room draws them. Pieces whose item left the catalogue are not listed. */
  placedFurni(projectId: string): PlacedFurni[] {
    return piecesOf(this.inventory, projectId).flatMap((p) => furniOf(p, this.items) ?? []);
  }

  /** Takes one item from the stock to the floor at `to`. The hotel checks the spot before `commit` is called. */
  planPlace(projectId: string, itemId: string, to: Placement): PlacePlan {
    const r = placeFromStock(this.inventory, projectId, itemId, to);
    if (!r.ok) return { ok: false, reason: r.reason };
    const piece = furniOf(r.piece, this.items);
    if (!piece) return { ok: false, reason: "That item is not in the shop any more." };
    return { ok: true, piece, ...this.planOf(r.inventory) };
  }

  /** A placed piece goes back to the stock. */
  planPickUp(projectId: string, id: string): ChangePlan {
    const r = pickUpToStock(this.inventory, projectId, id);
    return r.ok ? { ok: true, ...this.planOf(r.inventory) } : { ok: false, reason: r.reason };
  }

  /** A placed piece stands somewhere else. */
  planMove(projectId: string, id: string, to: Placement): ChangePlan {
    const r = movePlaced(this.inventory, projectId, id, to);
    return r.ok ? { ok: true, ...this.planOf(r.inventory) } : { ok: false, reason: r.reason };
  }

  /**
   * Every piece placed on a floor of a project that no longer exists goes back to the stock. Called when the engine's
   * project list is read. Returns true when something came back. A write failure is logged and tried again next time.
   */
  returnAbsentFloors(projectIds: ReadonlySet<string>): boolean {
    const gone = floorsWithPieces(this.inventory).filter((id) => !projectIds.has(id));
    return this.keep(returnFloors(this.inventory, gone));
  }

  /** Pieces of a floor that the room could not take (`visible` holds the item ids it shows) go back to the stock. */
  returnHiddenPieces(projectId: string, visible: ReadonlySet<string>): boolean {
    return this.keep(returnHidden(this.inventory, projectId, visible));
  }

  private keep(next: Inventory): boolean {
    if (next === this.inventory) return false;
    if (!this.trySave(this.inventoryFile, this.inventoryFileOf(next))) return false;
    this.inventory = next;
    return true;
  }
}
