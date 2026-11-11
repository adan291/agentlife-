import type {
  AgentEvent,
  AgentId,
  ApprovalDecision,
  ArtifactView,
  JobDetails,
  JobState,
  JobView,
  Repo,
  StepName,
  StepRecord,
} from "@agentlife/shared";
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

/** Numbers of one step as the real engine reports them (`agent.work`). */
interface StepWork {
  model?: string;
  contextPeak?: number;
  filesRead: number;
  filesEdited: number;
}

interface Job {
  view: JobView;
  approvalId: string;
  resolveApproval: (d: ApprovalDecision) => void;
  approval: Promise<ApprovalDecision>;
  artifacts: ArtifactView[];
  stepWork: Map<StepName, StepWork>;
}

const STEP_OF_STATE: Partial<Record<JobState, StepName>> = {
  analyzing: "analyze",
  developing: "develop",
  testing: "test",
  reviewing: "review",
  report_ready: "report",
};

const FAKE_TASK_TITLE = "Fix the failing test";
const FAKE_PLAN = {
  tasks: [
    { id: "t1", title: FAKE_TASK_TITLE, why: "One test is skipped because of a known bug.", files: ["src/todo.ts"], acceptance: "All tests pass.", risk: "low" },
    { id: "t2", title: "Keep the change small", why: "Smaller diffs are easier to review.", files: ["src/todo.ts"], acceptance: "At most 10 changed lines.", risk: "low" },
  ],
};
const FAKE_DIFF = `--- a/src/todo.ts
+++ b/src/todo.ts
@@ -1,3 +1,3 @@
 export function isOverdue(dueAt: number, now: number): boolean {
-  return dueAt <= now;
+  return dueAt < now;
 }
`;
const FAKE_REVIEW = { verdict: "pass", notes: ["Change is small and covered by tests."], risk: "low" };

type Role = "architect" | "developer" | "qa";

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

  roleModels(): Promise<Partial<Record<AgentId, string>>> {
    return Promise.resolve({ architect: "fake", developer: "fake", qa: "fake" });
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
      artifacts: [],
      stepWork: new Map(),
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

  /** Steps are derived from the timeline; the numbers are the ones the script reported. */
  getJobDetails(taskId: string): Promise<JobDetails> {
    const job = this.jobs.get(taskId);
    if (!job) return Promise.reject(new Error(`unknown task '${taskId}'`));
    const tl = job.view.timeline;
    const steps: StepRecord[] = [];
    tl.forEach((entry, i) => {
      const step = STEP_OF_STATE[entry.state];
      if (!step) return;
      const next = tl[i + 1];
      const w = job.stepWork.get(step);
      steps.push({
        step,
        startedAt: entry.ts,
        status: next ? "ok" : "running",
        ...(next ? { endedAt: next.ts, durationMs: Math.max(0, next.ts - entry.ts) } : {}),
        ...(w?.model ? { model: w.model } : {}),
        ...(w?.contextPeak === undefined ? {} : { contextPeak: w.contextPeak }),
        filesRead: w?.filesRead ?? 0,
        filesEdited: w?.filesEdited ?? 0,
      });
    });
    const hasDevelop = steps.some((s) => s.step === "develop");
    return Promise.resolve({
      job: {
        taskId,
        repoId: job.view.repoId,
        goal: job.view.goal,
        state: job.view.state,
        steps,
        approvals: [],
        artifacts: job.artifacts.map((a) => ({ artifactId: a.artifactId, kind: a.kind, title: a.title })),
        ...(hasDevelop ? { branch: `agentlife/${taskId}` } : {}),
      },
      artifacts: structuredClone(job.artifacts),
    });
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
    if (job && ev.type === "agent.work") {
      job.stepWork.set(ev.step, {
        ...(ev.model ? { model: ev.model } : {}),
        ...(ev.contextPct === undefined ? {} : { contextPeak: ev.contextPct }),
        filesRead: ev.filesRead,
        filesEdited: ev.filesEdited,
      });
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
    let stepStartedAt = this.clock();
    const state = (s: JobState, reason?: string) => {
      if (STEP_OF_STATE[s]) stepStartedAt = this.clock();
      this.emit(id, reason === undefined ? { type: "task.state_changed", state: s } : { type: "task.state_changed", state: s, reason });
    };
    const agent = (agentId: Role, s: "idle" | "thinking" | "working" | "waiting_approval" | "done", text?: string) =>
      this.emit(id, text === undefined ? { type: "agent.state_changed", agentId, state: s } : { type: "agent.state_changed", agentId, state: s, text });
    const goto = (agentId: Role, anchor: "desk" | "board" | "computer" | "mailbox" | "home") =>
      this.emit(id, { type: "agent.goto", agentId, anchor });
    const say = (agentId: Role, text: string) => this.emit(id, { type: "agent.say", agentId, text });
    const act = (agentId: Role, text: string) => this.emit(id, { type: "agent.activity", agentId, text });
    const work = (agentId: Role, step: StepName, title: string, nums: { read?: number; edited?: number; context?: number; model?: string } = {}) =>
      this.emit(id, {
        type: "agent.work",
        agentId,
        step,
        title,
        ...(nums.model ? { model: nums.model } : {}),
        ...(nums.context === undefined ? {} : { contextPct: nums.context }),
        filesRead: nums.read ?? 0,
        filesEdited: nums.edited ?? 0,
        startedAt: stepStartedAt,
      });
    const artifact = (agentId: Role, kind: string, artifactId: string, title: string, content: string) => {
      job.artifacts.push({ artifactId, kind, title, content, truncated: false });
      this.emit(id, { type: "artifact.created", agentId, kind, artifactId, title });
    };
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
    act("architect", "Analysing the repo");
    work("architect", "analyze", `Analysing ${job.view.repoId}`, { model: "fake", context: 4 });
    if (!(await step())) return;
    say("architect", "Let me read the haunted-todo repo...");
    act("architect", "Reading: src/todo.ts");
    goto("architect", "desk");
    agent("architect", "working", "Drafting a plan");
    work("architect", "analyze", `Analysing ${job.view.repoId}`, { model: "fake", read: 2, context: 18.5 });
    if (!(await step())) return;
    artifact("architect", "plan", `plan-${id}`, "Plan", JSON.stringify(FAKE_PLAN, null, 2));
    state("awaiting_plan_approval");
    act("architect", "Plan ready: 2 tasks");
    agent("architect", "waiting_approval", "Plan ready for approval");
    goto("architect", "mailbox");
    this.emit(id, {
      type: "approval.requested",
      agentId: "architect",
      approvalId: job.approvalId,
      kind: "plan",
      summary: `Plan for: ${job.view.goal}\n1. ${FAKE_TASK_TITLE}\n2. Keep the change small`,
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
    act("architect", "Approved task 1");
    goto("architect", "home");

    // 3. Developer develops.
    state("developing");
    goto("developer", "desk");
    agent("developer", "working", "Editing files");
    act("developer", "Editing: src/todo.ts");
    work("developer", "develop", FAKE_TASK_TITLE, { model: "fake", read: 1, context: 12 });
    if (!(await step())) return;
    say("developer", "Patch is ready.");
    work("developer", "develop", FAKE_TASK_TITLE, { model: "fake", read: 1, edited: 1, context: 24 });
    artifact("developer", "diff", `diff-${id}`, "Patch (attempt 1)", FAKE_DIFF);
    agent("developer", "done", "Patch ready");
    act("developer", "Patch ready");

    // 4. Tests.
    state("testing");
    goto("qa", "computer");
    agent("qa", "working", "Running tests");
    act("qa", "Running tests");
    work("qa", "test", FAKE_TASK_TITLE);
    if (!(await step())) return;
    act("qa", "Tests passed 3/3");
    artifact("qa", "test_log", `test-${id}`, "Test log (attempt 1)", "      Tests  3 passed (3)\n");

    // 5. QA reviews.
    state("reviewing");
    goto("qa", "desk");
    agent("qa", "thinking", "Reviewing the patch");
    act("qa", "Reviewing the patch");
    work("qa", "review", FAKE_TASK_TITLE, { model: "fake", context: 6 });
    if (!(await step())) return;
    work("qa", "review", FAKE_TASK_TITLE, { model: "fake", read: 1, context: 15.5 });
    artifact("qa", "review", `review-${id}`, "Review (attempt 1)", JSON.stringify(FAKE_REVIEW, null, 2));
    agent("qa", "done", "Review finished");
    act("qa", "Review: pass (risk low)");

    // 6. Report.
    state("report_ready", "verdict:pass");
    goto("qa", "mailbox");
    work("architect", "report", FAKE_TASK_TITLE);
    const markdown = "# Report\n\n- Plan approved\n- Patch applied\n- **Tests passed** (3/3)\n";
    const title = `Report: ${job.view.goal}`.slice(0, 200);
    artifact("architect", "report", `report-art-${id}`, title, markdown);
    this.emit(id, { type: "report.ready", agentId: "qa", reportId: `report-${id}`, title, markdown });
    state("delivered");
    this.emit(id, { type: "task.completed" });
    for (const a of ["architect", "developer", "qa"] as const) {
      agent(a, "idle");
      goto(a, "home");
    }
  }
}
