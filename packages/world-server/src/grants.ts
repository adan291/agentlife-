import type { AgentEvent, GrantReason, JobKind } from "@agentlife/shared";

/** An event that earns Ecto. The wallet decides whether it was counted before. */
export interface GrantCandidate {
  reason: GrantReason;
  /** Task id of the job it was earned for. */
  ref: string;
  /** Epoch ms of the event. */
  ts: number;
}

/** Tasks whose facts are kept. The gateway replays the latest 50 jobs after a restart; this is ten times that. */
export const TRACKED_TASKS_MAX = 500;

interface TaskFacts {
  kind: JobKind;
  verdict: "pass" | "fail" | undefined;
  /** The job went through `failed` at some point: it earns nothing even though it still ends with a report. */
  failed: boolean;
}

export type { TaskFacts };

/**
 * Follows the engine's events and says which of them earn Ecto (furni-shop requirement 1.2):
 * - a job that reached `delivered`, never failed, and whose QA verdict was pass (`job_passed`), except a branch review,
 * - a branch review that reached `delivered` and never failed, whatever it found (`review_finished`),
 * - the branch of a job fetched into the user's repository (`branch_delivered`).
 * It knows nothing about floors, sockets or the wallet. A job whose creation it did not see earns nothing: it never
 * guesses a kind or a verdict. Every candidate repeats when the events are replayed; the wallet counts each once.
 */
export class GrantTracker {
  private readonly tasks = new Map<string, TaskFacts>();

  /** What was seen of a task (kind, QA verdict, whether it failed), or undefined when its creation was not seen. XP uses the same facts as Ecto. */
  facts(taskId: string): Readonly<TaskFacts> | undefined {
    return this.tasks.get(taskId);
  }

  observe(ev: AgentEvent): GrantCandidate[] {
    switch (ev.type) {
      case "task.created": {
        this.tasks.set(ev.taskId, { kind: ev.kind ?? "change", verdict: undefined, failed: false });
        if (this.tasks.size > TRACKED_TASKS_MAX) {
          const oldest = this.tasks.keys().next();
          if (!oldest.done) this.tasks.delete(oldest.value);
        }
        return [];
      }
      case "task.failed": {
        const facts = this.tasks.get(ev.taskId);
        if (facts) facts.failed = true;
        return [];
      }
      case "task.state_changed": {
        const facts = this.tasks.get(ev.taskId);
        if (!facts) return [];
        if (ev.state === "failed") facts.failed = true;
        if (ev.state === "report_ready" && ev.reason?.startsWith("verdict:")) {
          const v = ev.reason.slice("verdict:".length);
          if (v === "pass" || v === "fail") facts.verdict = v;
        }
        if (ev.state !== "delivered" || facts.failed) return [];
        if (facts.kind === "review-branch") return [{ reason: "review_finished", ref: ev.taskId, ts: ev.ts }];
        return facts.verdict === "pass" ? [{ reason: "job_passed", ref: ev.taskId, ts: ev.ts }] : [];
      }
      case "delivery.done":
        return [{ reason: "branch_delivered", ref: ev.taskId, ts: ev.ts }];
      default:
        return [];
    }
  }
}
