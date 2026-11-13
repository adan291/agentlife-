import { describe, expect, it } from "vitest";
import { GRANT_REASONS } from "@agentlife/shared";
import { GRANT_TOAST_MS, balanceText, grantToastText } from "../src/ui/wallet.ts";

describe("Ecto texts", () => {
  it("writes the balance with its unit", () => {
    expect(balanceText(0)).toBe("0 Ecto");
    expect(balanceText(120)).toBe("120 Ecto");
  });

  it("writes the toast like the spec: amount and reason", () => {
    expect(grantToastText({ amount: 20, reason: "branch_delivered" })).toBe("+20 Ecto: branch delivered");
    expect(grantToastText({ amount: 15, reason: "job_passed" })).toBe("+15 Ecto: job passed");
  });

  it("has a readable toast for every reason, and the toast stays long enough to read", () => {
    for (const reason of GRANT_REASONS) expect(grantToastText({ amount: 5, reason })).toMatch(/^\+5 Ecto: .{4,}$/);
    expect(GRANT_TOAST_MS).toBeGreaterThanOrEqual(3000);
  });
});
