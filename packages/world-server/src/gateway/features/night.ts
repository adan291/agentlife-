// The night shift: the night board in the lobby, the night look (dimmed rooms) and the morning summaries in the lobby
// mailbox.
import type { WebSocket } from "ws";
import { LOBBY_ROOM, morningReportId, morningTitle } from "@agentlife/shared";
import type { MorningSummary, NightState, Report, ServerMsg } from "@agentlife/shared";
import type { EngineLink } from "../../engine-link.ts";
import { errorText } from "../context.ts";
import type { GatewayContext, Handlers } from "../context.ts";
import type { EconomyFeature } from "./economy.ts";
import type { FloorsFeature } from "./floors.ts";
import type { ProgressFeature } from "./progress.ts";

/** Summaries written within this long count as news when the gateway first sees them; older ones are history. */
const FRESH_SUMMARY_MS = 24 * 60 * 60 * 1000;

export function createNight(
  ctx: GatewayContext,
  deps: {
    economy: Pick<EconomyFeature, "grantEcto">;
    progress: Pick<ProgressFeature, "recordFact" | "recordNightScheduled">;
    floors: Pick<FloorsFeature, "pushFloors" | "rememberNight">;
  },
) {
  const { engine, send, sendError } = ctx;
  /** Summary reports the user has not opened the lobby mailbox for yet. */
  const unopenedSummaries = new Set<string>();
  let lastClock = "";

  /**
   * Copies the engine's morning summaries into the lobby mailbox. A summary that is new, and recent, is announced like a
   * delivered report (badge, toast) when the user is in the lobby, and again on the next welcome into the lobby until
   * the mailbox is opened. Never throws.
   */
  const syncSummaries = async (): Promise<void> => {
    if (!engine?.getNightSummaries) return;
    let list: MorningSummary[];
    try {
      list = await engine.getNightSummaries();
    } catch {
      return; // keep what the mailbox has
    }
    const lobby = ctx.floorOf(LOBBY_ROOM);
    const news: Report[] = [];
    // A night in which at least one job finished pays once, whenever the summary is first seen.
    for (const s of list) {
      if (s.counts.done < 1) continue;
      deps.economy.grantEcto("night_summary", s.nightKey, s.writtenAt);
      await deps.progress.recordFact({ fact: { source: "night_summary", ref: s.nightKey, ts: s.writtenAt }, roles: [] });
    }
    for (const s of [...list].reverse()) {
      const id = morningReportId(s.nightKey);
      const report: Report = { reportId: id, taskId: id, title: morningTitle(s.nightKey), markdown: s.markdown, ts: s.writtenAt, kind: "night" };
      const known = lobby.reports.has(id);
      lobby.reports.set(id, report);
      if (!known && Date.now() - s.writtenAt < FRESH_SUMMARY_MS) news.push(report);
    }
    for (const r of news) {
      unopenedSummaries.add(r.reportId);
      ctx.toUser(LOBBY_ROOM, { type: "report", report: r });
    }
    if (news.length > 0) {
      lobby.unread = "report_ready";
      deps.floors.pushFloors();
    }
  };

  /** Tells the client whether the night window is open (dimmed rooms, moon clock). Sent when it changed, or when forced. Never throws. */
  const pushNightClock = async (force = false): Promise<void> => {
    if (!engine?.getNight || !ctx.session()) return;
    let state: NightState;
    try {
      state = await engine.getNight();
    } catch {
      return;
    }
    const msg: ServerMsg = { type: "night_clock", open: state.open, start: state.config.start, end: state.config.end };
    deps.floors.rememberNight(state);
    const key = JSON.stringify(msg);
    if (!force && key === lastClock) return;
    lastClock = key;
    const current = ctx.session();
    if (current) send(current.ws, msg);
  };

  const sendNight = async (ws: WebSocket): Promise<void> => {
    if (!engine?.getNight) return sendError(ws, "engine_unavailable", "the night shift needs the real engine");
    try {
      const state = await engine.getNight();
      deps.floors.rememberNight(state);
      send(ws, { type: "night", state });
    } catch {
      sendError(ws, "engine_unavailable", "cannot read the night schedule");
    }
  };

  /** Add, remove or move a night job. The board is in the lobby, so the user must be there; the answer is the new schedule. */
  const nightCommand = async (ws: WebSocket, run: (link: EngineLink) => Promise<void>): Promise<void> => {
    if (!engine?.getNight) return sendError(ws, "engine_unavailable", "the night shift needs the real engine");
    if (ctx.userRoom() !== LOBBY_ROOM) return sendError(ws, "bad_message", "the night board is in the lobby");
    try {
      await run(engine);
    } catch (e) {
      sendError(ws, "night_error", errorText(e, "the night schedule was not changed"));
    }
    await sendNight(ws);
  };

  /** A morning summary nobody opened yet is announced again to a client that just arrived in the lobby. */
  const welcome = (ws: WebSocket, roomId: string): void => {
    if (roomId !== LOBBY_ROOM) return;
    const f = ctx.floors.get(roomId);
    for (const id of unopenedSummaries) {
      const report = f?.reports.get(id);
      if (report) send(ws, { type: "report", report });
    }
  };

  const handlers: Handlers = {
    night_state: (_msg, { ws }) => void sendNight(ws),
    night_add: (msg, { ws }) =>
      void nightCommand(ws, async (link) => {
        if (!link.addNightJob) return;
        await link.addNightJob(msg.job);
        await deps.progress.recordNightScheduled();
      }),
    night_remove: (msg, { ws }) => void nightCommand(ws, (link) => link.removeNightJob?.(msg.id) ?? Promise.resolve()),
    night_move: (msg, { ws }) => void nightCommand(ws, (link) => link.moveNightJob?.(msg.id, msg.direction) ?? Promise.resolve()),
  };

  return {
    syncSummaries,
    pushNightClock,
    sendNight,
    /** The user opened the lobby mailbox: the summaries are read. */
    summariesOpened: () => unopenedSummaries.clear(),
    welcome,
    handlers,
  };
}
export type NightFeature = ReturnType<typeof createNight>;
