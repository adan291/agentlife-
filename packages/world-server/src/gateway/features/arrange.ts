// Edit mode: moving, placing, picking up and resetting the furniture of the room the user is in (furni-move, furni-shop,
// ui-tidy).
import type { WebSocket } from "ws";
import { projectIdOfRoom } from "@agentlife/shared";
import type { ArrangeResult, Layout, Placement } from "@agentlife/shared";
import type { GatewayContext, Handlers } from "../context.ts";

const NO_SHOP_TO_PLACE: ArrangeResult = { ok: false, code: "no_stock", reason: "You have nothing to place: the shop is closed." };
const PROJECT_FLOORS_ONLY: ArrangeResult = { ok: false, code: "not_editable", reason: "Bought furniture can only stand on project floors." };

export function createArrange(ctx: GatewayContext) {
  const { hotel } = ctx;
  const { economy, layouts } = ctx.options;

  /**
   * One change of the furniture of the room the user is in (every room can be arranged). The rules are the shared ones
   * (`checkMove`); a refusal names the rule and changes nothing. The new pieces and anchors go to the user after the walks
   * already queued, so the avatars do not jump. `stock` also sends the shop (the inventory tray shows the stock).
   * `projectId` is undefined outside project floors; only bought pieces need it, and they stay on project floors.
   */
  const arrange = (
    ws: WebSocket,
    change: (roomId: string, projectId: string | undefined, save: (layout: Layout) => void) => ArrangeResult,
    stock = false,
  ): void => {
    const roomId = ctx.userRoom();
    if (roomId === undefined) return ctx.sendError(ws, "layout_error", "That room cannot be arranged.");
    const result = change(roomId, projectIdOfRoom(roomId), (layout) => layouts?.set(roomId, layout));
    if (!result.ok) return ctx.sendError(ws, "layout_error", result.reason);
    const { furni, anchors } = result.room;
    ctx.enqueue(() => {
      ctx.toUser(roomId, { type: "room_layout", roomId, furni, anchors });
      if (stock && economy) ctx.toUser(roomId, { type: "shop", state: economy.shop() });
    });
  };

  /** A move of a piece. A bought piece is kept in the inventory file, a piece of the template in the layout file. */
  const moveItem = (roomId: string, projectId: string | undefined, itemId: string, to: Placement, save: (layout: Layout) => void): ArrangeResult => {
    if (projectId === undefined || !hotel.isExtra(roomId, itemId)) return hotel.moveFurniture(roomId, itemId, to, save);
    const plan = economy?.planMove(projectId, itemId, to);
    if (!plan?.ok) return { ok: false, code: "unknown_item", reason: plan?.reason ?? "That piece is not in this room." };
    return hotel.moveFurniture(roomId, itemId, to, () => plan.commit());
  };

  /** Stands a bought item on the floor. The inventory file is written only after the hotel accepted the spot. */
  const placeItem = (roomId: string, projectId: string | undefined, itemId: string, to: Placement): ArrangeResult => {
    if (projectId === undefined) return PROJECT_FLOORS_ONLY;
    if (!economy) return NO_SHOP_TO_PLACE;
    const plan = economy.planPlace(projectId, itemId, to);
    if (!plan.ok) return { ok: false, code: "no_stock", reason: plan.reason };
    return hotel.placeFurniture(roomId, plan.piece, () => plan.commit());
  };

  /** Takes a bought piece back into the inventory. Pieces of the template are refused by the hotel. */
  const pickUpItem = (roomId: string, projectId: string | undefined, itemId: string): ArrangeResult => {
    if (projectId === undefined) return PROJECT_FLOORS_ONLY;
    return hotel.pickUpFurniture(roomId, itemId, () => {
      const plan = economy?.planPickUp(projectId, itemId);
      if (!plan?.ok) throw new Error(plan?.reason ?? "not one of yours");
      plan.commit();
    });
  };

  const handlers: Handlers = {
    furni_move: ({ itemId, x, y, dir }, { ws }) => arrange(ws, (roomId, projectId, save) => moveItem(roomId, projectId, itemId, { x, y, dir }, save)),
    furni_place: ({ itemId, x, y, dir }, { ws }) => arrange(ws, (roomId, projectId) => placeItem(roomId, projectId, itemId, { x, y, dir }), true),
    furni_pickup: ({ itemId }, { ws }) => arrange(ws, (roomId, projectId) => pickUpItem(roomId, projectId, itemId), true),
    furni_reset: (_msg, { ws }) => arrange(ws, (roomId, _projectId, save) => hotel.resetLayout(roomId, save)),
  };

  return { handlers };
}
