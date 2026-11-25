// The Bug sack: reports from the browser, the list and the status of a group (spec bug-sack).
import type { WebSocket } from "ws";
import { BUG_REPORT_BYTES } from "@agentlife/shared";
import type { ShotUpload } from "../../bug-upload.ts";
import type { GatewayContext, Handlers, MsgOf } from "../context.ts";
import type { SlidingWindow } from "../rate.ts";

const BUGS_OFF = "The Bug sack is off on this server.";

export function createBugs(ctx: GatewayContext) {
  const bugs = ctx.options.bugs;
  const { send, sendError } = ctx;

  const sendBugs = (ws: WebSocket): void => {
    if (!bugs) return sendError(ws, "bug_error", BUGS_OFF);
    send(ws, { type: "bugs", groups: bugs.summaries(), open: bugs.openCount() });
  };

  /** A report from the browser. The server decides who it came from: a client cannot claim to be the engine. */
  const saveBugReport = (ws: WebSocket, msg: MsgOf<"bug_report">, bytes: number, window: SlidingWindow, shots: ShotUpload): void => {
    if (!bugs) return sendError(ws, "bug_error", BUGS_OFF);
    if (bytes > BUG_REPORT_BYTES) return sendError(ws, "bug_error", "That bug report is too big.");
    if (!window.take()) return sendError(ws, "bug_error", "Too many bug reports; try again in a minute.");
    const floor = msg.floor ?? ctx.userRoom();
    // The screenshot was uploaded before the report; without it the report is still kept.
    const screenshot = msg.upload ? shots.take(msg.upload) : undefined;
    const result = bugs.record(
      {
        component: "game",
        process: "client",
        kind: msg.kind,
        message: msg.message,
        ...(msg.stack ? { stack: msg.stack } : {}),
        ...(msg.note ? { note: msg.note } : {}),
        context: { ...(floor ? { floor } : {}), ...(msg.panel ? { panel: msg.panel } : {}), ...(msg.view ? { view: msg.view } : {}) },
        ...(msg.clientTime === undefined ? {} : { clientTime: msg.clientTime }),
      },
      screenshot ? { screenshot } : {},
    );
    send(ws, { type: "bug_saved", id: result.group.id, count: result.group.count });
  };

  const takeBugUpload = (ws: WebSocket, msg: MsgOf<"bug_upload">, shots: ShotUpload): void => {
    if (!bugs) return sendError(ws, "bug_error", BUGS_OFF);
    const problem = shots.push(msg);
    if (problem) sendError(ws, "bug_error", problem);
  };

  const sendBugShot = (ws: WebSocket, sample: string): void => {
    if (!bugs) return sendError(ws, "bug_error", BUGS_OFF);
    const png = bugs.readScreenshot(sample);
    if (!png) return sendError(ws, "bug_error", "That screenshot is not kept any more.");
    send(ws, { type: "bug_shot", sample, png: Buffer.from(png).toString("base64") });
  };

  const sendBugText = (ws: WebSocket, msg: MsgOf<"bug_copy">): void => {
    if (!bugs) return sendError(ws, "bug_error", BUGS_OFF);
    const made = bugs.exportMarkdown(msg.id !== undefined ? { id: msg.id } : { component: msg.component ?? "game" });
    if (!made) return sendError(ws, "bug_error", "No such bug.");
    send(ws, { type: "bug_text", text: made.text, count: made.count });
  };

  const sendBugDetail = (ws: WebSocket, id: string): void => {
    if (!bugs) return sendError(ws, "bug_error", BUGS_OFF);
    const group = bugs.get(id);
    if (!group) return sendError(ws, "bug_error", "No such bug.");
    send(ws, { type: "bug_detail", group });
  };

  const setBugStatus = (ws: WebSocket, id: string, status: "open" | "fixed" | "ignored"): void => {
    if (!bugs) return sendError(ws, "bug_error", BUGS_OFF);
    if (!bugs.setStatus(id, status)) return sendError(ws, "bug_error", "No such bug.");
    sendBugs(ws);
  };

  /** The user's client hears about every change at once, so the Menu count and the dot stay right. */
  const stopNews = bugs
    ? bugs.onChange((change) => {
        const current = ctx.session();
        if (!current) return;
        send(current.ws, { type: "bug_news", open: bugs.openCount(), change: change.kind, id: change.group.id });
      })
    : undefined;

  /** The Bug sack tells the client it exists (the Menu item and the count) as soon as the connection starts. */
  const welcome = (ws: WebSocket): void => {
    if (bugs) send(ws, { type: "bug_news", open: bugs.openCount(), change: "state" });
  };

  const handlers: Handlers = {
    bug_report: (msg, { ws, raw, conn }) => saveBugReport(ws, msg, Buffer.byteLength(raw), conn.bugWindow, conn.bugShots),
    bug_upload: (msg, { ws, conn }) => takeBugUpload(ws, msg, conn.bugShots),
    bug_shot_get: (msg, { ws }) => sendBugShot(ws, msg.sample),
    bug_copy: (msg, { ws }) => sendBugText(ws, msg),
    bugs_state: (_msg, { ws }) => sendBugs(ws),
    bug_get: (msg, { ws }) => sendBugDetail(ws, msg.id),
    bug_status: (msg, { ws }) => setBugStatus(ws, msg.id, msg.status),
  };

  return { sendBugs, welcome, handlers, close: () => stopNews?.() };
}
