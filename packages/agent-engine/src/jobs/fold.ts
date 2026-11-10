import type { AgentEvent, EngineJobView, JobState, StepName } from "@agentlife/shared";

/** Step that is running while the job is in a given state. */
const STATE_STEP: Partial<Record<JobState, StepName>> = {
  analyzing: "analyze",
  developing: "develop",
  testing: "test",
  reviewing: "review",
  report_ready: "report",
};

/**
 * Convention: the engine records the QA verdict as the reason of the transition into
 * `report_ready` ("verdict:pass" or "verdict:fail"). `task.failed` also sets verdict fail.
 */
export const VERDICT_REASON_PREFIX = "verdict:";

function closeRunning(view: EngineJobView, ts: number, status: "ok" | "failed" | "cancelled"): void {
  for (const s of view.steps) {
    if (s.status === "running") {
      s.status = status;
      s.endedAt = ts;
      s.durationMs = Math.max(0, ts - s.startedAt);
    }
  }
}

/**
 * Pure reducer: returns the view after applying one event. Never mutates `view`.
 * Events of a job that has no `task.created` yet are ignored.
 */
export function applyEvent(view: EngineJobView | undefined, ev: AgentEvent): EngineJobView | undefined {
  if (ev.type === "task.created") {
    return {
      taskId: ev.taskId,
      repoId: ev.repoId,
      goal: ev.goal,
      state: "created",
      steps: [],
      approvals: [],
      artifacts: [],
    };
  }
  if (!view) return undefined;
  const next = structuredClone(view);
  switch (ev.type) {
    case "task.state_changed": {
      const status = ev.state === "failed" ? "failed" : ev.state === "cancelled" ? "cancelled" : "ok";
      closeRunning(next, ev.ts, status);
      next.state = ev.state;
      const step = STATE_STEP[ev.state];
      if (step) next.steps.push({ step, startedAt: ev.ts, status: "running" });
      if (ev.state === "report_ready" && ev.reason?.startsWith(VERDICT_REASON_PREFIX)) {
        const v = ev.reason.slice(VERDICT_REASON_PREFIX.length);
        if (v === "pass" || v === "fail") next.verdict = v;
      }
      return next;
    }
    case "task.failed":
      next.verdict = "fail";
      return next;
    case "task.completed":
      closeRunning(next, ev.ts, "ok");
      return next;
    case "artifact.created":
      next.artifacts.push({ artifactId: ev.artifactId, kind: ev.kind, title: ev.title });
      return next;
    case "approval.requested":
      next.approvals.push({ approvalId: ev.approvalId, kind: ev.kind, summary: ev.summary, status: "pending" });
      return next;
    case "approval.resolved": {
      const a = next.approvals.find((x) => x.approvalId === ev.approvalId);
      if (a) a.status = ev.decision === "approve" ? "approved" : "rejected";
      return next;
    }
    default:
      return next;
  }
}

/** Fold one job's events (in seq order) into its view. */
export function foldJob(events: readonly AgentEvent[]): EngineJobView | undefined {
  let view: EngineJobView | undefined;
  for (const ev of events) view = applyEvent(view, ev);
  return view;
}
