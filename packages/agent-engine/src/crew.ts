import { CrewEventSchema, OkResponseSchema, SPEC_NAME_RE, phaseGroup } from "@agentlife/shared";
import type { BuildPhase, CrewEvent } from "@agentlife/shared";
import { createActivityEmitter } from "./activity.ts";
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
  /** Latest conductor phase, if one was reported since the engine started. */
  phase(): BuildPhase | undefined;
}

/**
 * Turns build-session reports into Builder agent events. Only `agent.*` events are emitted, under
 * the task id `build:<session>`, so job views, approvals and reports are never touched.
 */
export function createCrewRelay(opts: CrewRelayOptions): CrewRelay {
  const now = opts.now ?? Date.now;
  let lastSayAt = Number.NEGATIVE_INFINITY;
  let current: BuildPhase | undefined;
  // Builder lines for the activity terminal follow the same 1 per second rule as the roles.
  const activity = createActivityEmitter({ append: opts.append, now });

  return {
    phase: () => current,
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
          activity.line(taskId, "builder", `Started ${label}`);
          return;
        }
        case "activity": {
          state(ev.activity === "think" ? "thinking" : "working", ev.text);
          if (ev.text && now() - lastSayAt >= SAY_THROTTLE_MS) say(ev.text);
          if (ev.text) activity.progress(taskId, "builder", ev.text);
          return;
        }
        case "finished": {
          const ok = ev.ok !== false;
          say(ok ? "done" : "failed");
          activity.line(taskId, "builder", ok ? `Finished ${ev.session}` : `Failed ${ev.session}`);
          state(ok ? "done" : "error");
          opts.append({ ...base, type: "agent.goto", anchor: "home" });
          state("idle");
          return;
        }
        case "phase": {
          const text = (ev.phase ?? "").trim().slice(0, 80);
          if (!text) return;
          current = { text, ...(ev.spec && SPEC_NAME_RE.test(ev.spec) ? { spec: ev.spec } : {}), at: now() };
          const group = phaseGroup(text);
          if (group === "running" || group === "verifying") {
            opts.append({ ...base, type: "agent.goto", anchor: "desk" });
            state("working", text);
          } else {
            state(group === "stopped" ? "error" : "done");
            opts.append({ ...base, type: "agent.goto", anchor: "home" });
            state("idle");
          }
          say(text);
          activity.line(taskId, "builder", `Phase: ${text}`);
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
