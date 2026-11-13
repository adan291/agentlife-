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
  newWallet,
  stockCount,
  stockList,
} from "@agentlife/shared";
import type { CatalogueItem, EconomyConfig, GrantReason, LedgerEntry, ShopState, Stock, Wallet } from "@agentlife/shared";
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
 * The user's Ecto and what they bought: the balance in `data/wallet.json`, the stock in `data/inventory.json`, the
 * grants that fill the wallet and the purchases that empty it. The rules are the shared ones (`applyGrant`,
 * `applyPurchase`); this class owns the files. A wallet that has no file yet is created and written at once, so its
 * `since` (the moment older events stop paying) survives a restart even before the first grant.
 */
export class Economy {
  private wallet: Wallet;
  private stock: Stock;
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
    this.stock = readJsonFile(this.inventoryFile, InventoryFileSchema, { now: this.now, onLog: this.log })?.stock ?? {};
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
    return { balance: this.wallet.balance, items: [...this.items], stock: stockList(this.stock, this.items), stockMax: INVENTORY_MAX };
  }

  /** Items in stock (bought and not placed). */
  get stockTotal(): number {
    return stockCount(this.stock);
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

  /**
   * Grants the amount `config/economy.json` sets for the reason, once per `reason` and `ref`. Returns the ledger entry
   * when the balance went up, and undefined when nothing was counted (already counted, older than the wallet, or the
   * file could not be written: then nothing is counted and a later replay tries again).
   */
  grant(reason: GrantReason, ref: string, ts: number): LedgerEntry | undefined {
    const result = applyGrant(this.wallet, { reason, ref, amount: this.config.grants[reason], ts });
    if (result.wallet === this.wallet) return undefined;
    const before = this.wallet;
    this.wallet = result.wallet;
    if (!this.trySave(this.file, this.wallet)) {
      this.wallet = before;
      return undefined;
    }
    return result.entry;
  }

  /**
   * Buys one item for the price in the catalogue. A refusal says why and changes nothing. The inventory file is written
   * first and the wallet second: a crash between them gives an item for free, never an empty wallet for nothing. If the
   * second write fails the first is written back, memory is restored and the purchase is refused.
   */
  buy(itemId: string): BuyResult {
    const item = this.items.find((i) => i.id === itemId);
    const result = applyPurchase(this.wallet, this.stock, item, this.now());
    if (!result.ok) return { ok: false, reason: result.reason };
    const stockBefore = this.stock;
    if (!this.trySave(this.inventoryFile, { version: 1, stock: result.stock })) return { ok: false, reason: "Could not save your purchase." };
    if (!this.trySave(this.file, result.wallet)) {
      this.trySave(this.inventoryFile, { version: 1, stock: stockBefore });
      return { ok: false, reason: "Could not save your purchase." };
    }
    this.wallet = result.wallet;
    this.stock = result.stock;
    return { ok: true, entry: result.entry };
  }
}
