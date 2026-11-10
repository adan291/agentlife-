import type { AgentEvent } from "@agentlife/shared";
import type { Store } from "../store.ts";
import type { Route } from "./server.ts";

export const DEFAULT_HEARTBEAT_MS = 15_000;
/** A client that lets this many bytes pile up unread is dropped; it can reconnect with Last-Event-ID. */
const MAX_BUFFERED_BYTES = 8 * 1024 * 1024;

export interface SseOptions {
  heartbeatMs?: number;
}

function parseSeq(raw: string | null | undefined): number | undefined | "invalid" {
  if (raw === null || raw === undefined || raw === "") return undefined;
  if (!/^\d{1,15}$/.test(raw)) return "invalid";
  return Number(raw);
}

/**
 * `GET /events?since=<seq>`: replay stored events with a greater seq, then live events, no gaps or duplicates.
 * `Last-Event-ID` is used when `since` is absent. Each message: `id: <seq>`, `event: agent`, `data: <json>`.
 */
export function createEventsRoute(store: Store, opts: SseOptions = {}): Route {
  const heartbeatMs = opts.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  return {
    method: "GET",
    pattern: /^\/events$/,
    handle: ({ req, res, url }) => {
      const header = req.headers["last-event-id"];
      const fromQuery = parseSeq(url.searchParams.get("since"));
      const fromHeader = parseSeq(Array.isArray(header) ? header[0] : header);
      if (fromQuery === "invalid" || fromHeader === "invalid") {
        res.writeHead(400, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "invalid_body", message: "since must be a non-negative integer", issues: [{ path: "since", message: "invalid" }] }));
        return;
      }
      let last = fromQuery ?? fromHeader ?? 0;

      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });
      res.write(": connected\n\n");

      let replaying = true;
      let closed = false;
      const buffer: AgentEvent[] = [];
      const cleanup = (): void => {
        if (closed) return;
        closed = true;
        store.bus.off("event", onEvent);
        clearInterval(timer);
      };
      const send = (ev: AgentEvent): void => {
        if (closed || ev.seq <= last) return;
        last = ev.seq;
        res.write(`id: ${ev.seq}\nevent: agent\ndata: ${JSON.stringify(ev)}\n\n`);
        if (res.writableLength > MAX_BUFFERED_BYTES) {
          cleanup();
          res.destroy();
        }
      };
      function onEvent(ev: AgentEvent): void {
        if (replaying) buffer.push(ev);
        else send(ev);
      }
      const timer = setInterval(() => {
        if (!closed) res.write(": hb\n\n");
      }, heartbeatMs);
      timer.unref();
      req.on("close", cleanup);
      res.on("close", cleanup);

      // Subscribe first, then replay, then flush what arrived meanwhile; `send` drops anything already sent.
      store.bus.on("event", onEvent);
      for (const ev of store.eventsSince(last)) send(ev);
      replaying = false;
      for (const ev of buffer.splice(0)) send(ev);
    },
  };
}
