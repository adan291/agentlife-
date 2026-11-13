import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  BALANCE_MAX,
  EconomyConfigSchema,
  GRANTED_KEYS_MAX,
  GRANT_LABELS,
  GRANT_REASONS,
  LEDGER_MAX,
  ServerMsgSchema,
  WalletSchema,
  applyGrant,
  grantKey,
  grantText,
  newWallet,
} from "../src/index.ts";
import type { GrantInput, GrantReason, Wallet } from "../src/index.ts";

const SINCE = 1000;
const grant = (reason: GrantReason, ref: string, ts = SINCE + 1, amount = 20): GrantInput => ({ reason, ref, amount, ts });

describe("applyGrant", () => {
  it("adds the amount, writes a ledger entry and remembers the key", () => {
    const r = applyGrant(newWallet(SINCE), grant("job_passed", "task-1", 1500, 15));
    expect(r.entry).toEqual({ ts: 1500, amount: 15, reason: "job_passed", ref: "task-1" });
    expect(r.wallet.balance).toBe(15);
    expect(r.wallet.ledger).toEqual([r.entry]);
    expect(r.wallet.granted).toEqual([grantKey("job_passed", "task-1")]);
    expect(r.skipped).toBeUndefined();
  });

  it("counts each reason and ref once", () => {
    const once = applyGrant(newWallet(SINCE), grant("branch_delivered", "task-1")).wallet;
    const again = applyGrant(once, grant("branch_delivered", "task-1"));
    expect(again.skipped).toBe("counted");
    expect(again.wallet).toBe(once);
    // The same task earns for another reason, and another task for the same reason.
    expect(applyGrant(once, grant("job_passed", "task-1")).wallet.balance).toBe(40);
    expect(applyGrant(once, grant("branch_delivered", "task-2")).wallet.balance).toBe(40);
  });

  it("pays nothing for an event older than the wallet", () => {
    const r = applyGrant(newWallet(SINCE), grant("job_passed", "task-old", SINCE - 1));
    expect(r.skipped).toBe("before_start");
    expect(r.wallet.balance).toBe(0);
    expect(applyGrant(newWallet(SINCE), grant("job_passed", "task-new", SINCE)).wallet.balance).toBe(20);
  });

  it.each(["", "a b", "task:1", "x".repeat(101), "../x"])("refuses the ref %j", (ref) => {
    expect(applyGrant(newWallet(SINCE), grant("job_passed", ref)).skipped).toBe("bad_ref");
  });

  it.each([0, -5, 1.5, Number.NaN])("refuses the amount %j", (amount) => {
    expect(applyGrant(newWallet(SINCE), grant("job_passed", "task-1", SINCE, amount)).skipped).toBe("bad_amount");
  });

  it("cuts a grant at the balance limit and still counts it", () => {
    const rich: Wallet = { ...newWallet(SINCE), balance: BALANCE_MAX - 5 };
    const r = applyGrant(rich, grant("job_passed", "task-1"));
    expect(r.wallet.balance).toBe(BALANCE_MAX);
    expect(r.entry?.amount).toBe(5);
    const full = applyGrant(r.wallet, grant("job_passed", "task-2"));
    expect(full.wallet.balance).toBe(BALANCE_MAX);
    expect(full.entry).toBeUndefined();
    expect(full.wallet.granted).toContain(grantKey("job_passed", "task-2"));
  });

  it("keeps the last 200 ledger entries and the last 2000 keys", () => {
    let w = newWallet(SINCE);
    for (let i = 0; i < GRANTED_KEYS_MAX + 5; i++) w = applyGrant(w, grant("job_passed", `task-${i}`, SINCE + i, 1)).wallet;
    expect(w.ledger).toHaveLength(LEDGER_MAX);
    expect(w.ledger.at(-1)?.ref).toBe(`task-${GRANTED_KEYS_MAX + 4}`);
    expect(w.granted).toHaveLength(GRANTED_KEYS_MAX);
    expect(w.granted[0]).toBe(grantKey("job_passed", "task-5"));
    expect(w.balance).toBe(GRANTED_KEYS_MAX + 5);
    expect(WalletSchema.safeParse(w).success).toBe(true);
  });
});

describe("grant texts", () => {
  it("has a label for every reason, and the toast reads like the spec", () => {
    for (const reason of GRANT_REASONS) expect(GRANT_LABELS[reason].length).toBeGreaterThan(0);
    expect(grantText(20, "branch_delivered")).toBe("+20 Ecto: branch delivered");
  });
});

describe("property: balance and replay", () => {
  const reasonArb = fc.constantFrom(...GRANT_REASONS);
  const grantArb = fc.record({
    reason: reasonArb,
    ref: fc.constantFrom("task-a", "task-b", "task-c", "2026-11-12", "bad ref"),
    amount: fc.integer({ min: 1, max: 1000 }),
    ts: fc.integer({ min: 0, max: 3000 }),
  });

  it("any sequence of grants keeps 0 <= balance <= BALANCE_MAX, and replaying the sequence changes nothing", () => {
    fc.assert(
      fc.property(fc.array(grantArb, { maxLength: 40 }), (grants) => {
        const run = (start: Wallet, list: GrantInput[]): Wallet => list.reduce((w, g) => applyGrant(w, g).wallet, start);
        const once = run(newWallet(SINCE), grants);
        expect(once.balance).toBeGreaterThanOrEqual(0);
        expect(once.balance).toBeLessThanOrEqual(BALANCE_MAX);
        const replayed = run(once, grants);
        expect(replayed).toEqual(once);
        expect(WalletSchema.safeParse(once).success).toBe(true);
      }),
    );
  });

  it("the ledger always adds up to the balance while it holds every entry", () => {
    fc.assert(
      fc.property(fc.array(grantArb, { maxLength: 40 }), (grants) => {
        const w = grants.reduce((acc, g) => applyGrant(acc, g).wallet, newWallet(SINCE));
        expect(w.ledger.reduce((sum, e) => sum + e.amount, 0)).toBe(w.balance);
      }),
    );
  });
});

describe("config and messages", () => {
  it("accepts a table with all five reasons and nothing else", () => {
    const grants = { job_passed: 15, branch_delivered: 20, review_finished: 10, memory_accepted: 5, night_summary: 25 };
    expect(EconomyConfigSchema.safeParse({ version: 1, grants }).success).toBe(true);
    expect(EconomyConfigSchema.safeParse({ version: 1, grants: { ...grants, extra: 1 } }).success).toBe(false);
    expect(EconomyConfigSchema.safeParse({ version: 1, grants: { ...grants, job_passed: 0 } }).success).toBe(false);
    const { night_summary: _gone, ...missing } = grants;
    expect(EconomyConfigSchema.safeParse({ version: 1, grants: missing }).success).toBe(false);
  });

  it("the wallet message carries the balance and, for a grant, what was earned", () => {
    expect(ServerMsgSchema.safeParse({ type: "wallet", balance: 0 }).success).toBe(true);
    expect(ServerMsgSchema.safeParse({ type: "wallet", balance: 35, grant: { amount: 20, reason: "branch_delivered" } }).success).toBe(true);
    expect(ServerMsgSchema.safeParse({ type: "wallet", balance: -1 }).success).toBe(false);
    expect(ServerMsgSchema.safeParse({ type: "wallet", balance: 5, grant: { amount: 0, reason: "job_passed" } }).success).toBe(false);
    expect(ServerMsgSchema.safeParse({ type: "wallet", balance: 5, grant: { amount: 5, reason: "gift" } }).success).toBe(false);
  });
});
