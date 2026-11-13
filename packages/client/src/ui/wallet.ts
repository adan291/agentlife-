import { grantText } from "@agentlife/shared";
import type { GrantReason } from "@agentlife/shared";

/** How long the grant toast stays. */
export const GRANT_TOAST_MS = 4000;

/** "120 Ecto": the whole balance, for the chip's label and tooltip. */
export function balanceText(balance: number): string {
  return `${balance} Ecto`;
}

/** The toast of a grant: "+20 Ecto: branch delivered". */
export function grantToastText(grant: { amount: number; reason: GrantReason }): string {
  return grantText(grant.amount, grant.reason);
}
