// Outfits (ghost-skins): parts to buy and to unlock, and what the user and the team members wear.
import type { WebSocket } from "ws";
import { HR_ROOM, LOBBY_ROOM, applyWear } from "@agentlife/shared";
import type { UnlockedPart } from "../../economy-store.ts";
import { SHOP_CLOSED } from "../context.ts";
import type { GatewayContext, Handlers, MsgOf } from "../context.ts";

const OUTFITS_CLOSED = "The hotel has no wardrobe: it needs the real engine.";

export function createOutfits(ctx: GatewayContext) {
  const { economy, progress } = ctx.options;
  const worn = ctx.options.outfits;
  const { send, sendError } = ctx;

  /** The parts, the wardrobe and the balance. Nothing is sent when the hotel has no wardrobe. */
  const sendWardrobe = (ws: WebSocket): void => {
    const state = economy?.wardrobe();
    if (state) send(ws, { type: "wardrobe", state });
  };

  /** The whole outfits file: the user's and every member's. Nothing is sent when the hotel has no wardrobe. */
  const sendOutfits = (ws: WebSocket): void => {
    if (worn && economy?.hasWardrobe) send(ws, { type: "outfits", state: worn.state() });
  };

  /** The wardrobe on request: closed like the shop when there is none. */
  const askWardrobe = (ws: WebSocket): void => {
    if (!economy?.hasWardrobe) return sendError(ws, "shop_error", SHOP_CLOSED);
    sendWardrobe(ws);
  };

  /** One outfit purchase at the shop counter in the lobby, with the same refusals and the same order of writes as furniture. */
  const buyOutfit = (ws: WebSocket, partId: string): void => {
    if (!economy?.hasWardrobe) return sendError(ws, "shop_error", SHOP_CLOSED);
    if (ctx.userRoom() !== LOBBY_ROOM) return sendError(ws, "shop_error", "The shop counter is in the lobby.");
    const result = economy.buyPart(partId);
    if (!result.ok) return sendError(ws, "shop_error", result.reason);
    send(ws, { type: "wallet", balance: economy.balance });
    sendWardrobe(ws);
  };

  const toastUnlocked = (ws: WebSocket, unlocked: readonly UnlockedPart[]): void => {
    for (const { part, badgeName } of unlocked) send(ws, { type: "part_unlocked", partId: part.id, name: part.name, slot: part.slot, badge: badgeName });
  };

  /**
   * Gives the parts that these badges unlock, once each, and tells the connected user (a toast per part, then the new
   * wardrobe). A badge of the user or of any team member counts. A part that cannot be saved is tried again at the next
   * welcome.
   */
  const unlockOutfits = (badgeIds: ReadonlySet<string>): void => {
    const unlocked = economy?.unlockParts(badgeIds) ?? [];
    const current = ctx.session();
    if (unlocked.length === 0 || !current) return;
    toastUnlocked(current.ws, unlocked);
    sendWardrobe(current.ws);
  };

  /** Every badge the user and the team members have, from the progress view. */
  const earnedBadgeIds = (): Set<string> => {
    const view = progress?.view();
    const ids = new Set<string>();
    if (!view) return ids;
    for (const b of view.user.badges) ids.add(b.id);
    for (const m of view.members) for (const b of m.badges) ids.add(b.id);
    return ids;
  };

  /** The wardrobe for a client that just arrived, after the parts that badges earned in the meantime unlocked. */
  const welcome = (ws: WebSocket): void => {
    if (!economy?.hasWardrobe) return;
    toastUnlocked(ws, economy.unlockParts(earnedBadgeIds()));
    sendWardrobe(ws);
    sendOutfits(ws);
  };

  /** A member who is not on the team any more (let go here or elsewhere) does not keep the outfit. */
  const pruneTeam = (projectId: string, memberIds: ReadonlySet<string>): void => {
    const current = ctx.session();
    if (worn?.pruneProject(projectId, memberIds) && current) sendOutfits(current.ws);
  };

  /**
   * Puts a part on the user or on a team member, or takes the slot off. The shared rules decide (the part exists, is in
   * the wardrobe, belongs to the slot); a member must be on the project's team and is dressed in the HR office, the user
   * anywhere. A refusal says why and changes nothing; a change answers with the new outfits.
   */
  const wearOutfit = async (ws: WebSocket, msg: MsgOf<"outfit_wear">): Promise<void> => {
    const wardrobe = economy?.wardrobe();
    if (!worn || !wardrobe) return sendError(ws, "outfit_error", OUTFITS_CLOSED);
    const who = msg.who;
    if (who !== "user") {
      if (ctx.userRoom() !== HR_ROOM) return sendError(ws, "outfit_error", "Team members are dressed at the HR desk.");
      const hr = ctx.engine?.hr;
      if (!hr) return sendError(ws, "outfit_error", "The HR office needs the real engine.");
      let ids: string[];
      try {
        ids = (await hr.team(who.project)).members.map((m) => m.id);
      } catch {
        return sendError(ws, "outfit_error", "Could not read that project's team.");
      }
      if (!ids.includes(who.member)) return sendError(ws, "outfit_error", "That team member is not on this project's team.");
    }
    const result = applyWear(wardrobe.parts, wardrobe.owned, worn.outfitOf(who), msg.slot, msg.partId);
    if (!result.ok) return sendError(ws, "outfit_error", result.reason);
    const kept = worn.set(who, result.outfit);
    if (!kept.ok) return sendError(ws, "outfit_error", kept.reason);
    sendOutfits(ws);
  };

  const handlers: Handlers = {
    wardrobe_state: (_msg, { ws }) => askWardrobe(ws),
    outfit_buy: (msg, { ws }) => buyOutfit(ws, msg.partId),
    outfit_wear: (msg, { ws }) => void wearOutfit(ws, msg),
  };

  return { sendWardrobe, unlockOutfits, pruneTeam, welcome, handlers };
}
export type OutfitsFeature = ReturnType<typeof createOutfits>;
