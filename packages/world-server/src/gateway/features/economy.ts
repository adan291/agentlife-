// Ecto: grants from verified events, the shop counter in the lobby (furni-shop).
import type { WebSocket } from "ws";
import { LOBBY_ROOM } from "@agentlife/shared";
import type { GrantReason, LedgerEntry } from "@agentlife/shared";
import { GrantTracker } from "../../grants.ts";
import { SHOP_CLOSED } from "../context.ts";
import type { GatewayContext, Handlers } from "../context.ts";

export function createEconomy(ctx: GatewayContext) {
  const economy = ctx.options.economy;
  /** Which jobs passed, failed and were delivered: the facts behind grants, XP and the ghosts' reactions. */
  const tracker = new GrantTracker();

  /**
   * Counts a grant once (the wallet remembers each `reason` and `ref`) and, when it paid, tells the user who is connected
   * so the top bar and the toast follow. A grant while nobody is connected is in the balance the next time.
   */
  const grantEcto = (reason: GrantReason, ref: string, ts: number, amount?: number): LedgerEntry | undefined => {
    if (!economy) return undefined;
    const entry = economy.grant(reason, ref, ts, amount);
    const current = ctx.session();
    if (entry && current) ctx.send(current.ws, { type: "wallet", balance: economy.balance, grant: { amount: entry.amount, reason } });
    return entry;
  };

  /** The catalogue, the balance and the stock. Without an economy the shop is closed. */
  const sendShop = (ws: WebSocket): void => {
    if (!economy) return ctx.sendError(ws, "shop_error", SHOP_CLOSED);
    ctx.send(ws, { type: "shop", state: economy.shop() });
  };

  /** One purchase at the shop counter in the lobby. A refusal says why and changes nothing; a purchase answers with the new balance and shop. */
  const buyItem = (ws: WebSocket, itemId: string): void => {
    if (!economy) return ctx.sendError(ws, "shop_error", SHOP_CLOSED);
    if (ctx.userRoom() !== LOBBY_ROOM) return ctx.sendError(ws, "shop_error", "The shop counter is in the lobby.");
    const result = economy.buy(itemId);
    if (!result.ok) return ctx.sendError(ws, "shop_error", result.reason);
    ctx.send(ws, { type: "wallet", balance: economy.balance });
    ctx.send(ws, { type: "shop", state: economy.shop() });
  };

  /** The balance for a client that just arrived. */
  const welcome = (ws: WebSocket): void => {
    if (economy) ctx.send(ws, { type: "wallet", balance: economy.balance });
  };

  const handlers: Handlers = {
    shop_state: (_msg, { ws }) => sendShop(ws),
    shop_buy: (msg, { ws }) => buyItem(ws, msg.itemId),
  };

  return { economy, tracker, grantEcto, sendShop, welcome, handlers };
}
export type EconomyFeature = ReturnType<typeof createEconomy>;
