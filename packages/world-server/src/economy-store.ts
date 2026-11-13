import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EconomyConfigSchema, WalletSchema, applyGrant, newWallet } from "@agentlife/shared";
import type { EconomyConfig, GrantReason, LedgerEntry, Wallet } from "@agentlife/shared";
import { readJsonFile, writeJsonFile } from "./json-file.ts";

const here = dirname(fileURLToPath(import.meta.url));
export const CONFIG_DIR = join(here, "..", "config");
const DATA_DIR = join(here, "..", "..", "..", "data");

/** `data/wallet.json` at the repository root, or `AGENTLIFE_WALLET_FILE`. */
export function defaultWalletFile(env: NodeJS.ProcessEnv = process.env): string {
  return env["AGENTLIFE_WALLET_FILE"] ?? join(DATA_DIR, "wallet.json");
}

/** Reads and checks `config/economy.json`. Throws with the reason when it is wrong. */
export function loadEconomyConfig(file: string = join(CONFIG_DIR, "economy.json")): EconomyConfig {
  return EconomyConfigSchema.parse(JSON.parse(readFileSync(file, "utf8")));
}

export interface EconomyOptions {
  walletFile: string;
  config: EconomyConfig;
  now?: () => number;
  onLog?: (message: string) => void;
}

/**
 * The user's Ecto: the balance in `data/wallet.json` and the grants that fill it. The rules are the shared ones
 * (`applyGrant`); this class owns the file. A wallet that has no file yet is created and written at once, so its
 * `since` (the moment older events stop paying) survives a restart even before the first grant.
 */
export class Economy {
  private wallet: Wallet;
  private readonly file: string;
  private readonly config: EconomyConfig;
  private readonly log: (message: string) => void;

  constructor(opts: EconomyOptions) {
    this.file = opts.walletFile;
    this.config = opts.config;
    this.log = opts.onLog ?? (() => undefined);
    const now = opts.now ?? Date.now;
    const loaded = readJsonFile(this.file, WalletSchema, { now, onLog: this.log });
    this.wallet = loaded ?? newWallet(now());
    if (!loaded) this.trySave();
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

  private trySave(): boolean {
    try {
      writeJsonFile(this.file, this.wallet);
      return true;
    } catch (e) {
      this.log(`cannot write the wallet: ${e instanceof Error ? e.message : String(e)}`);
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
    if (!this.trySave()) {
      this.wallet = before;
      return undefined;
    }
    return result.entry;
  }
}
