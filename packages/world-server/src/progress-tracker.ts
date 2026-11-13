import { PROJECT_ROLES, splitAgentId } from "@agentlife/shared";
import type { AgentEvent, ProgressFact, ProjectRole, ScopedAgentId } from "@agentlife/shared";
import type { GrantTracker } from "./grants.ts";

/** A fact the engine's events made, and who it happened to. */
export interface TrackedFact {
  fact: ProgressFact;
  /** Project of the job; absent for a fact that happens to the user only. */
  projectId?: string;
  /** Roles whose team member the fact happened to (the gateway looks up who holds each role in the project). */
  roles: ProjectRole[];
}

/** Tasks whose facts are kept. The gateway replays the latest 50 jobs after a restart; this is ten times that. */
export const TRACKED_TASKS_MAX = 500;
const APPROVALS_MAX = 500;

interface TaskTrack {
  repoId: string;
  /** Roles that finished a step in this job: they get the credit when it ends. */
  roles: Set<ProjectRole>;
  /** Epoch ms when the latest step of each role started (from `agent.work`). */
  starts: Map<ProjectRole, number>;
}

function projectRole(id: ScopedAgentId): ProjectRole | undefined {
  const agent = splitAgentId(id).agentId;
  return (PROJECT_ROLES as readonly string[]).includes(agent) ? (agent as ProjectRole) : undefined;
}

/**
 * Follows the engine's events and says which of them are facts for XP, stats, badges and quests (team-progress, see the
 * spec's design.md for the table). What counts as "a job that passed" is read from the furni-shop `GrantTracker`, so
 * Ecto and XP never disagree. It knows nothing about floors, sockets or the file. Every fact repeats when the events
 * are replayed; the file counts each key once. A job whose creation it did not see makes no fact: it never guesses.
 */
export class ProgressTracker {
  private readonly tasks = new Map<string, TaskTrack>();
  /** Approvals of kind `plan` that wait for the user (a plan the night shift approved by itself is not one). */
  private readonly userPlans = new Set<string>();

  /** Call after `grants.observe(ev)` for the same event. */
  observe(ev: AgentEvent, grants: Pick<GrantTracker, "facts">): TrackedFact[] {
    switch (ev.type) {
      case "task.created": {
        this.tasks.set(ev.taskId, { repoId: ev.repoId, roles: new Set(), starts: new Map() });
        if (this.tasks.size > TRACKED_TASKS_MAX) {
          const oldest = this.tasks.keys().next();
          if (!oldest.done) this.tasks.delete(oldest.value);
        }
        return [];
      }
      case "agent.work": {
        const role = projectRole(ev.agentId);
        const task = this.tasks.get(ev.taskId);
        if (task && role) task.starts.set(role, ev.startedAt);
        return [];
      }
      case "agent.state_changed": {
        if (ev.state !== "done") return [];
        const role = projectRole(ev.agentId);
        const task = this.tasks.get(ev.taskId);
        if (!task || !role) return [];
        task.roles.add(role);
        const start = task.starts.get(role);
        const stepMs = start !== undefined && ev.ts >= start ? ev.ts - start : undefined;
        return [
          { fact: { source: "step_done", ref: `${ev.taskId}.${role}`, ts: ev.ts, ...(stepMs === undefined ? {} : { stepMs }) }, projectId: task.repoId, roles: [role] },
        ];
      }
      case "approval.requested": {
        if (ev.kind === "plan" && !ev.summary.includes("approved automatically")) {
          this.userPlans.add(ev.approvalId);
          if (this.userPlans.size > APPROVALS_MAX) {
            const oldest = this.userPlans.values().next();
            if (!oldest.done) this.userPlans.delete(oldest.value);
          }
        }
        return [];
      }
      case "approval.resolved":
        return ev.decision === "approve" && this.userPlans.has(ev.approvalId)
          ? [{ fact: { source: "plan_approved", ref: ev.approvalId, ts: ev.ts }, roles: [] }]
          : [];
      case "delivery.done":
        return [{ fact: { source: "branch_delivered", ref: ev.taskId, ts: ev.ts }, roles: [] }];
      case "task.state_changed": {
        if (ev.state !== "delivered") return [];
        const facts = grants.facts(ev.taskId);
        const task = this.tasks.get(ev.taskId);
        if (!facts || !task) return [];
        const base = { projectId: task.repoId, roles: [...task.roles] };
        const make = (source: "job_passed" | "review_passed" | "job_not_passed" | "review_finished"): TrackedFact => ({
          fact: { source, ref: ev.taskId, ts: ev.ts },
          ...base,
        });
        const passed = !facts.failed && facts.verdict === "pass";
        if (facts.kind === "review-branch") {
          // A review that asks for changes is still a finished review; it is not a pass.
          return [...(facts.failed ? [] : [make("review_finished")]), make(passed ? "review_passed" : "job_not_passed")];
        }
        return [make(passed ? "job_passed" : "job_not_passed")];
      }
      default:
        return [];
    }
  }
}
