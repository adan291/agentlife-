import type { AgentEvent, ApprovalDecision, JobState, JobView, Repo } from "@agentlife/shared";
import { EventQueue } from "./engine-link.ts";
import type { EngineLink } from "./engine-link.ts";

export const FAKE_REPO: Repo = {
  id: "haunted-todo",
  name: "haunted-todo",
  description: "A tiny to-do app whose tests are haunted.",
};

export interface FakeEngineOptions {
  /** Pause between scripted steps in ms. Tests use 0. */
  stepMs?: number;
  clock?: () => number;
}

type Draft = AgentEvent extends infer E ? (E extends unknown ? Omit<E, "seq" | "ts" | "taskId"> : never) : never;

interface Job {
  view: JobView;
  approvalId: string;
  resolveApproval: (d: ApprovalDecision) => void;
  approval: Promise<ApprovalDecision>;
}

/**
 * Scripted engine for development. It produces the same event types as the real engine:
 * analyse, wait for the user's approval, develop, test, review, report.
 * It never continues past the approval until `resolveApproval` is called.
 */
export class FakeEngineLink implements EngineLink {
  private readonly queue = new EventQueue<AgentEvent>();
  private readonly jobs = new Map<string, Job>();
  private readonly stepMs: number;
  private readonly clock: () => number;
  private seq = 0;
  private taskCounter = 0;
  private stopped = false;
  private wake: (() => void) | null = null;

  constructor(options: FakeEngineOptions = {}) {
    this.stepMs = options.stepMs ?? 1500;
    this.clock = options.clock ?? Date.now;
  }

  listRepos(): Promise<Repo[]> {
    return Promise.resolve([FAKE_REPO]);
  }

  startJob(repoId: string, goal: string): Promise<{ taskId: string }> {
    if (repoId !== FAKE_REPO.id) return Promise.reject(new Error(`repo '${repoId}' is not allowlisted`));
    const taskId = `task-${++this.taskCounter}`;
    const approvalId = `appr-${taskId}`;
    let resolveApproval!: (d: ApprovalDecision) => void;
    const approval = new Promise<ApprovalDecision>((r) => {
      resolveApproval = r;
    });
    const job: Job = {
      view: { taskId, repoId, goal, state: "created", timeline: [] },
      approvalId,
      resolveApproval,
      approval,
    };
    this.jobs.set(taskId, job);
    void this.run(job).catch((e: unknown) => {
      this.emit(taskId, { type: "task.failed", reason: e instanceof Error ? e.message : String(e) });
    });
    return Promise.resolve({ taskId });
  }

  resolveApproval(approvalId: string, decision: ApprovalDecision): Promise<void> {
    const job = [...this.jobs.values()].find((j) => j.approvalId === approvalId);
    if (!job) return Promise.reject(new Error(`unknown approval '${approvalId}'`));
    job.resolveApproval(decision);
    return Promise.resolve();
  }

  getJob(taskId: string): Promise<JobView> {
    const job = this.jobs.get(taskId);
    if (!job) return Promise.reject(new Error(`unknown task '${taskId}'`));
    return Promise.resolve(structuredClone(job.view));
  }

  events(): AsyncIterable<AgentEvent> {
    return this.queue;
  }

  close(): void {
    this.stopped = true;
    for (const j of this.jobs.values()) j.resolveApproval("reject");
    this.wake?.();
    this.queue.close();
  }

  // ---- script ----

  private emit(taskId: string, draft: Draft): void {
    const ev = { seq: this.seq++, ts: this.clock(), taskId, ...draft } as AgentEvent;
    const job = this.jobs.get(taskId);
    if (job && ev.type === "task.state_changed") {
      job.view.state = ev.state;
      job.view.timeline.push({ ts: ev.ts, state: ev.state, ...(ev.reason ? { text: ev.reason } : {}) });
    }
    this.queue.push(ev);
  }

  private pause(): Promise<void> {
    if (this.stepMs <= 0 || this.stopped) return Promise.resolve();
    return new Promise((resolve) => {
      const t = setTimeout(() => {
        this.wake = null;
        resolve();
      }, this.stepMs);
      this.wake = () => {
        clearTimeout(t);
        this.wake = null;
        resolve();
      };
    });
  }

  private async run(job: Job): Promise<void> {
    const id = job.view.taskId;
    const state = (s: JobState, reason?: string) =>
      this.emit(id, reason === undefined ? { type: "task.state_changed", state: s } : { type: "task.state_changed", state: s, reason });
    const agent = (agentId: "architect" | "developer" | "qa", s: "idle" | "thinking" | "working" | "waiting_approval" | "done", text?: string) =>
      this.emit(id, text === undefined ? { type: "agent.state_changed", agentId, state: s } : { type: "agent.state_changed", agentId, state: s, text });
    const goto = (agentId: "architect" | "developer" | "qa", anchor: "desk" | "board" | "computer" | "mailbox" | "home") =>
      this.emit(id, { type: "agent.goto", agentId, anchor });
    const say = (agentId: "architect" | "developer" | "qa", text: string) => this.emit(id, { type: "agent.say", agentId, text });
    const step = async () => {
      await this.pause();
      return !this.stopped;
    };

    this.emit(id, { type: "task.created", repoId: job.view.repoId, goal: job.view.goal });
    state("created");

    // 1. Architect analyses.
    state("analyzing");
    goto("architect", "board");
    agent("architect", "thinking", "Reading the repo");
    if (!(await step())) return;
    say("architect", "Let me read the haunted-todo repo...");
    goto("architect", "desk");
    agent("architect", "working", "Drafting a plan");
    if (!(await step())) return;
    this.emit(id, { type: "artifact.created", agentId: "architect", kind: "plan", artifactId: `plan-${id}`, title: "Plan" });
    state("awaiting_plan_approval");
    agent("architect", "waiting_approval", "Plan ready for approval");
    goto("architect", "mailbox");
    this.emit(id, {
      type: "approval.requested",
      agentId: "architect",
      approvalId: job.approvalId,
      kind: "plan",
      summary: `Plan for: ${job.view.goal}\n1. Fix the failing test\n2. Keep the change small`,
      options: ["approve", "reject"],
    });

    // 2. Wait for the user. Nothing below runs before resolveApproval.
    const decision = await job.approval;
    if (this.stopped) return;
    this.emit(id, { type: "approval.resolved", agentId: "architect", approvalId: job.approvalId, decision });
    if (decision === "reject") {
      state("cancelled", "Plan rejected");
      this.emit(id, { type: "task.failed", reason: "Plan rejected" });
      agent("architect", "idle");
      goto("architect", "home");
      return;
    }
    agent("architect", "done", "Plan approved");
    goto("architect", "home");

    // 3. Developer develops.
    state("developing");
    goto("developer", "desk");
    agent("developer", "working", "Editing files");
    if (!(await step())) return;
    say("developer", "Patch is ready.");
    this.emit(id, { type: "artifact.created", agentId: "developer", kind: "diff", artifactId: `diff-${id}`, title: "Patch" });
    agent("developer", "done", "Patch ready");

    // 4. Tests.
    state("testing");
    goto("qa", "computer");
    agent("qa", "working", "Running tests");
    if (!(await step())) return;

    // 5. QA reviews.
    state("reviewing");
    goto("qa", "desk");
    agent("qa", "thinking", "Reviewing the patch");
    if (!(await step())) return;
    agent("qa", "done", "Review finished");

    // 6. Report.
    state("report_ready");
    goto("qa", "mailbox");
    this.emit(id, {
      type: "report.ready",
      agentId: "qa",
      reportId: `report-${id}`,
      title: `Report: ${job.view.goal}`,
      markdown: "# Report\n\n- Plan approved\n- Patch applied\n- **Tests passed** (3/3)\n",
    });
    state("delivered");
    this.emit(id, { type: "task.completed" });
    for (const a of ["architect", "developer", "qa"] as const) {
      agent(a, "idle");
      goto(a, "home");
    }
  }
}
