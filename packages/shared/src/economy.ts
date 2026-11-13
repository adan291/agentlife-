import { z } from "zod";

/**
 * Ecto, the currency of the hotel (furni-shop). Everything here is pure: the world-server keeps the files and decides
 * which events pay; this module says what a grant does to a wallet. The shop (catalogue, stock, purchase) is `shop.ts`.
 * See the spec's design.md.
 */

/** Ledger entries kept in the wallet file, newest last. */
export const LEDGER_MAX = 200;
/** Keys of grants already counted, newest last. Far more than the jobs the gateway replays after a restart. */
export const GRANTED_KEYS_MAX = 2000;
/** The balance never passes this. */
export const BALANCE_MAX = 1_000_000;
export const GRANT_AMOUNT_MAX = 1000;

export const GRANT_REASONS = ["job_passed", "branch_delivered", "review_finished", "memory_accepted", "night_summary"] as const;
export const GrantReasonSchema = z.enum(GRANT_REASONS);
export type GrantReason = z.infer<typeof GrantReasonSchema>;

/** The words after "+20 Ecto:" in the toast. */
export const GRANT_LABELS: Readonly<Record<GrantReason, string>> = {
  job_passed: "job passed",
  branch_delivered: "branch delivered",
  review_finished: "branch review finished",
  memory_accepted: "note kept in the Library",
  night_summary: "night shift report",
};

/** "+20 Ecto: branch delivered". */
export function grantText(amount: number, reason: GrantReason): string {
  return `+${amount} Ecto: ${GRANT_LABELS[reason]}`;
}

/** What a grant was earned for: a task id, a night key. No colon, so `<reason>:<ref>` is unambiguous. */
export const GrantRefSchema = z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/);

// ---- config/economy.json ----

const GrantAmountSchema = z.number().int().min(1).max(GRANT_AMOUNT_MAX);
export const EconomyConfigSchema = z.object({
  version: z.literal(1),
  grants: z
    .object({
      job_passed: GrantAmountSchema,
      branch_delivered: GrantAmountSchema,
      review_finished: GrantAmountSchema,
      memory_accepted: GrantAmountSchema,
      night_summary: GrantAmountSchema,
    })
    .strict(),
});
export type EconomyConfig = z.infer<typeof EconomyConfigSchema>;

// ---- data/wallet.json ----

export const LedgerEntrySchema = z.object({
  /** Epoch ms of the event (a purchase: of the purchase). */
  ts: z.number().int().nonnegative(),
  /** Negative for a purchase. */
  amount: z.number().int().refine((n) => n !== 0, "an entry changes the balance"),
  reason: z.enum([...GRANT_REASONS, "purchase"]),
  /** Task id, night key or item id. */
  ref: z.string().min(1).max(100),
});
export type LedgerEntry = z.infer<typeof LedgerEntrySchema>;

export const WalletSchema = z.object({
  version: z.literal(1),
  /** Epoch ms when the wallet was created: older events earn nothing. */
  since: z.number().int().nonnegative(),
  balance: z.number().int().min(0).max(BALANCE_MAX),
  ledger: z.array(LedgerEntrySchema).max(LEDGER_MAX),
  granted: z.array(z.string().min(3).max(120)).max(GRANTED_KEYS_MAX),
});
export type Wallet = z.infer<typeof WalletSchema>;

export function newWallet(since: number): Wallet {
  return { version: 1, since, balance: 0, ledger: [], granted: [] };
}

export function grantKey(reason: GrantReason, ref: string): string {
  return `${reason}:${ref}`;
}

/** The last `max` items of a list (the oldest are dropped). */
export function keepLast<T>(list: readonly T[], max: number): T[] {
  return list.length > max ? list.slice(list.length - max) : [...list];
}

export interface GrantInput {
  reason: GrantReason;
  ref: string;
  amount: number;
  /** Epoch ms of the event that earned it. */
  ts: number;
}

export type GrantSkip = "counted" | "before_start" | "bad_ref" | "bad_amount";

export interface GrantResult {
  wallet: Wallet;
  /** Present when the balance went up. */
  entry?: LedgerEntry;
  /** Present when nothing was counted. */
  skipped?: GrantSkip;
}

/**
 * Adds a grant once. Nothing happens when the key was counted before, when the event is older than the wallet, or when
 * the input is not valid. A grant that would pass `BALANCE_MAX` is cut to it (its key is still counted).
 */
export function applyGrant(wallet: Wallet, grant: GrantInput): GrantResult {
  if (!GrantRefSchema.safeParse(grant.ref).success) return { wallet, skipped: "bad_ref" };
  if (!Number.isInteger(grant.amount) || grant.amount < 1) return { wallet, skipped: "bad_amount" };
  const key = grantKey(grant.reason, grant.ref);
  if (wallet.granted.includes(key)) return { wallet, skipped: "counted" };
  if (grant.ts < wallet.since) return { wallet, skipped: "before_start" };
  const granted = keepLast([...wallet.granted, key], GRANTED_KEYS_MAX);
  const amount = Math.min(grant.amount, BALANCE_MAX - wallet.balance);
  if (amount < 1) return { wallet: { ...wallet, granted } };
  const entry: LedgerEntry = { ts: grant.ts, amount, reason: grant.reason, ref: grant.ref };
  return { wallet: { ...wallet, balance: wallet.balance + amount, ledger: keepLast([...wallet.ledger, entry], LEDGER_MAX), granted }, entry };
}
