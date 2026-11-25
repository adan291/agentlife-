// Wisps: something to catch while a job runs (waiting-fun).
import type { WebSocket } from "ws";
import { WISP_REWARD, projectIdOfRoom } from "@agentlife/shared";
import { Wisps } from "../../wisps.ts";
import type { Wisp } from "../../wisps.ts";
import type { GatewayContext, Handlers } from "../context.ts";
import type { EconomyFeature } from "./economy.ts";

export function createWisps(ctx: GatewayContext, deps: { economy: Pick<EconomyFeature, "grantEcto"> }) {
  const { hotel, send } = ctx;
  const economy = ctx.options.economy;
  /** Only a hotel with an economy has wisps: a wisp that pays nothing would be pointless. */
  const wisps = economy ? new Wisps(economy, ctx.options.wisps) : undefined;
  let wispTimer: NodeJS.Timeout | undefined;
  /** Drops the wisp when its life and grace are over. Only one wisp exists, so one timer. */
  let wispExpiry: NodeJS.Timeout | undefined;

  /** Where the user is: their floor and the job that runs on it (none when it is not running). */
  const wispSpot = (): { roomId: string | undefined; taskId: string | undefined } => {
    const roomId = ctx.userRoom();
    const f = roomId ? ctx.floors.get(roomId) : undefined;
    return { roomId, taskId: f?.jobActive ? (f.currentTaskId ?? undefined) : undefined };
  };

  /** The wisp is over. The user is told, except when a `welcome` told them already (`quiet`). */
  const endWisp = (wisp: Wisp | undefined, caught: boolean, quiet = false): void => {
    if (!wisp) return;
    clearTimeout(wispExpiry);
    wispExpiry = undefined;
    const current = ctx.session();
    if (current && !quiet) send(current.ws, { type: "wisp_gone", wispId: wisp.id, caught });
  };

  /** Makes a wisp on the user's floor when the rules allow one. Never throws. */
  const trySpawnWisp = (): void => {
    const current = ctx.session();
    if (!wisps || !current) return;
    const spot = wispSpot();
    if (spot.roomId === undefined || projectIdOfRoom(spot.roomId) === undefined) return;
    const sim = hotel.sim(spot.roomId);
    if (!sim) return;
    // A wisp past its life and grace that the timer has not dropped yet is reported gone before the next one appears.
    endWisp(wisps.sweep(), false);
    const wisp = wisps.spawn(spot, sim.freeTiles());
    if (!wisp) return;
    send(current.ws, { type: "wisp", wispId: wisp.id, x: wisp.x, y: wisp.y, ttlMs: wisps.life });
    clearTimeout(wispExpiry);
    wispExpiry = setTimeout(() => endWisp(wisps.clear(), false), wisps.holdMs);
    wispExpiry.unref();
  };

  const scheduleWisp = (): void => {
    if (!wisps) return;
    wispTimer = setTimeout(() => {
      trySpawnWisp();
      scheduleWisp();
    }, wisps.nextDelay());
    wispTimer.unref();
  };
  scheduleWisp();

  /** A click on a wisp. A wisp that is not there, is too late or is on another floor pays nothing; the answer is `wisp_gone` either way. */
  const catchWisp = (ws: WebSocket, wispId: string): void => {
    const gone = (caught: boolean): void => send(ws, { type: "wisp_gone", wispId, caught });
    if (!wisps) return gone(false);
    const result = wisps.take(wispId, wispSpot());
    if (!result.ok) return gone(false);
    clearTimeout(wispExpiry);
    wispExpiry = undefined;
    // The grant sends `wallet` with the toast data; a write that fails pays nothing and is not counted.
    gone(deps.economy.grantEcto("wisp_caught", result.ref, Date.now(), WISP_REWARD) !== undefined);
  };

  /** The wisp belongs to a floor and a job: when either is gone, so is the wisp. */
  const dropStale = (): void => {
    const wisp = wisps?.current;
    if (!wisp) return;
    const spot = wispSpot();
    if (spot.roomId !== wisp.roomId || spot.taskId !== wisp.taskId) endWisp(wisps?.clear(), false);
  };

  /** A welcome (new room, new connection) or a closed connection: the client forgets its wisp, so the server does too. */
  const forget = (): void => endWisp(wisps?.clear(), false, true);

  const handlers: Handlers = {
    wisp_catch: (msg, { ws }) => catchWisp(ws, msg.wispId),
  };

  return {
    dropStale,
    forget,
    handlers,
    close: () => {
      clearTimeout(wispTimer);
      clearTimeout(wispExpiry);
    },
  };
}
export type WispsFeature = ReturnType<typeof createWisps>;
