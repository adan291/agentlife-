import { CrewEventSchema, OkResponseSchema } from "@agentlife/shared";
import type { CrewEvent } from "@agentlife/shared";
import { parseBody, sendJson, type Route } from "./http/server.ts";
import type { NewEvent } from "./store.ts";

/** Minimum gap between two Builder speech bubbles caused by `activity` events (requirement 2.5). */
export const SAY_THROTTLE_MS = 3000;

export interface CrewRelayOptions {
  append: (ev: NewEvent) => unknown;
  now?: () => number;
}

export interface CrewRelay {
  handle(ev: CrewEvent): void;
}

/**
 * Turns build-session reports into Builder agent events. Only `agent.*` events are emitted, under
 * the task id `build:<session>`, so job views, approvals and reports are never touched.
 */
export function createCrewRelay(opts: CrewRelayOptions): CrewRelay {
  const now = opts.now ?? Date.now;
  let lastSayAt = Number.NEGATIVE_INFINITY;

  return {
    handle(ev) {
      const taskId = `build:${ev.session}`;
      const base = { taskId, agentId: "builder" as const };
      const state = (s: "idle" | "thinking" | "working" | "done" | "error", text?: string) =>
        opts.append({ ...base, type: "agent.state_changed", state: s, ...(text ? { text } : {}) });
      const say = (text: string) => {
        lastSayAt = now();
        opts.append({ ...base, type: "agent.say", text });
      };

      switch (ev.kind) {
        case "started": {
          const label = [ev.session, ev.spec, ev.model ? `(${ev.model})` : undefined].filter(Boolean).join(" ");
          opts.append({ ...base, type: "agent.goto", anchor: "desk" });
          state("working", label);
          say(label);
          return;
        }
        case "activity": {
          state(ev.activity === "think" ? "thinking" : "working", ev.text);
          if (ev.text && now() - lastSayAt >= SAY_THROTTLE_MS) say(ev.text);
          return;
        }
        case "finished": {
          const ok = ev.ok !== false;
          say(ok ? "done" : "failed");
          state(ok ? "done" : "error");
          opts.append({ ...base, type: "agent.goto", anchor: "home" });
          state("idle");
          return;
        }
      }
    },
  };
}

export function createCrewRoute(relay: CrewRelay): Route {
  return {
    method: "POST",
    pattern: /^\/crew\/events$/,
    handle: async ({ req, res }) => {
      relay.handle(await parseBody(req, CrewEventSchema));
      sendJson(res, 202, OkResponseSchema, { ok: true });
    },
  };
}
