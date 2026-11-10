import { randomUUID } from "node:crypto";
import {
  PlanSchema,
  ReviewSchema,
  type AgentId,
  type AgentState,
  type ApprovalDecision,
  type EngineJobView,
  type JobState,
  type Plan,
  type Review,
  type SemanticAnchor,
} from "@agentlife/shared";
import { testResultLine, type ActivityEmitter } from "../activity.ts";
import type { LimitsConfig } from "../config.ts";
import { ConflictError, DiffRejectedError, JobCancelledError, NotFoundError, StepTimeoutError } from "../errors.ts";
import { noopLogger, type Logger } from "../log.ts";
import type { AgentRuntime, Role } from "../runtimes/types.ts";
import type { Store } from "../store.ts";
import type { ReportInput, StepContext, Steps, TestResult, Verdict } from "./steps.ts";
import { assertTransition, canTransition, isTerminal } from "./transitions.ts";

/** Develop runs at most this many times: the first try plus one retry after a QA fail (requirement 3.5). */
export const MAX_DEVELOP_ATTEMPTS = 2;
export const DEFAULT_REPORT_TIMEOUT_MS = 60_000;

type StepKey = "analyze" | "develop" | "test" | "review" | "report";
const STEP_ROLE: Record<StepKey, AgentId> = {
  analyze: "architect",
  develop: "developer",
  test: "qa",
  review: "qa",
  report: "architect",
};
const AGENTS: readonly AgentId[] = ["architect", "developer", "qa"];

export interface RunnerOptions {
  store: Store;
  steps: Steps;
  limits: LimitsConfig;
  logger?: Logger;
  /** Optional ambient chatter source (LlmRuntime). Failures never affect the job. */
  ambient?: AgentRuntime;
  newId?: () => string;
  reportTimeoutMs?: number;
  /** Writes milestone lines for the activity terminal. Without it no `agent.activity` events are emitted. */
  activity?: ActivityEmitter;
}

interface Active {
  id: string;
  ac: AbortController;
  pending?: { approvalId: string; resolve: (d: ApprovalDecision) => void } | undefined;
  data: Omit<ReportInput, "goal" | "verdict">;
  lastStep?: StepKey;
  done: Promise<void>;
}

function trunc(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Markdown used when the report step fails, after a job failure, and on restart recovery. */
export function fallbackReport(input: ReportInput): { title: string; markdown: string } {
  const lines = [`# Report`, ``, `**Goal:** ${input.goal}`, `**Verdict:** ${input.verdict}`];
  if (input.failureReason) lines.push(``, `**Failure:** ${input.failureReason}`);
  if (input.plan) {
    lines.push(``, `## Plan`);
    for (const t of input.plan.tasks) lines.push(`- ${t.title} (risk: ${t.risk})`);
  }
  if (input.test) lines.push(``, `## Tests`, input.test.passed ? `Tests passed.` : `Tests failed.`);
  if (input.review) {
    lines.push(``, `## Review`, `Verdict: ${input.review.verdict}, risk: ${input.review.risk}`);
    for (const n of input.review.notes) lines.push(`- ${n}`);
  }
  return { title: trunc(`Report: ${input.goal}`, 200), markdown: lines.join("\n") };
}

/**
 * Drives one job at a time through the state machine. Steps are injected; the runner owns state
 * transitions, events, artifacts, timeouts, cancellation and approvals.
 */
export class JobRunner {
  private readonly store: Store;
  private readonly steps: Steps;
  private readonly limits: LimitsConfig;
  private readonly log: Logger;
  private readonly ambient: AgentRuntime | undefined;
  private readonly newId: () => string;
  private readonly reportTimeoutMs: number;
  private readonly activity: ActivityEmitter | undefined;
  private readonly active = new Map<string, Active>();
  private readonly finished = new Map<string, Promise<void>>();

  constructor(opts: RunnerOptions) {
    this.store = opts.store;
    this.steps = opts.steps;
    this.limits = opts.limits;
    this.log = opts.logger ?? noopLogger;
    this.ambient = opts.ambient;
    this.newId = opts.newId ?? (() => `task-${randomUUID().slice(0, 8)}`);
    this.reportTimeoutMs = opts.reportTimeoutMs ?? DEFAULT_REPORT_TIMEOUT_MS;
    this.activity = opts.activity;
  }

  // ---- public API ----

  /** Starts a job. Throws ConflictError("busy") when a non-terminal job exists. */
  start(repoId: string, goal: string): string {
    if (this.store.listJobs().some((j) => !isTerminal(j.state))) {
      throw new ConflictError("busy", "another job is still running");
    }
    const id = this.newId();
    this.store.appendEvent({ type: "task.created", taskId: id, repoId, goal });
    const a: Active = { id, ac: new AbortController(), data: {}, done: Promise.resolve() };
    this.active.set(id, a);
    a.done = this.drive(a, repoId, goal);
    this.finished.set(id, a.done);
    return id;
  }

  /** Resolves the pending plan approval. 404 for unknown ids, 409 when it is not pending any more. */
  resolveApproval(approvalId: string, decision: ApprovalDecision): void {
    for (const a of this.active.values()) {
      if (a.pending?.approvalId === approvalId) {
        const { resolve } = a.pending;
        a.pending = undefined;
        this.store.appendEvent({ type: "approval.resolved", taskId: a.id, agentId: "architect", approvalId, decision });
        resolve(decision);
        return;
      }
    }
    const known = this.store.listJobs().some((j) => j.approvals.some((x) => x.approvalId === approvalId));
    if (known) throw new ConflictError("not_pending", "approval is not pending");
    throw new NotFoundError(`unknown approval '${approvalId}'`);
  }

  /** Cancels the job and resolves once it has settled. */
  async cancel(taskId: string): Promise<void> {
    const view = this.store.getJob(taskId);
    if (!view) throw new NotFoundError(`unknown task '${taskId}'`);
    const a = this.active.get(taskId);
    if (!a || !canTransition(view.state, "cancelled")) {
      throw new ConflictError("not_cancellable", `task is ${view.state}`);
    }
    a.ac.abort(new JobCancelledError());
    await a.done;
  }

  /** Resolves when the job's loop has settled. Never rejects. */
  done(taskId: string): Promise<void> {
    return this.finished.get(taskId) ?? Promise.resolve();
  }

  activeJobId(): string | undefined {
    return this.store.listJobs().find((j) => !isTerminal(j.state))?.taskId;
  }

  /** Requirement 5.3: jobs left non-terminal by a previous run end as failed (`engine_restarted`) with a report. */
  recover(): void {
    for (const v of this.store.listJobs()) {
      if (isTerminal(v.state)) continue;
      try {
        this.recoverOne(v);
      } catch (e) {
        this.log.error("recovery failed", { taskId: v.taskId, error: errorText(e) });
      }
    }
  }

  // ---- internals ----

  private recoverOne(v: EngineJobView): void {
    const id = v.taskId;
    const hasReport = this.store.eventsFor(id).some((e) => e.type === "report.ready");
    this.log.warn("recovering job", { taskId: id, state: v.state });
    if (!hasReport) {
      if (v.state !== "failed" && v.state !== "report_ready") {
        this.transition(id, "failed", "engine_restarted");
        this.store.appendEvent({ type: "task.failed", taskId: id, reason: "engine_restarted" });
      }
      const report = fallbackReport({ goal: v.goal, verdict: "fail", failureReason: "engine_restarted" });
      if (this.state(id) === "failed") this.transition(id, "report_ready", "verdict:fail");
      this.deliver(id, report);
    } else {
      this.deliver(id, undefined);
    }
  }

  private state(id: string): JobState {
    const v = this.store.getJob(id);
    if (!v) throw new NotFoundError(`unknown task '${id}'`);
    return v.state;
  }

  private transition(id: string, to: JobState, reason?: string): void {
    const from = this.state(id);
    try {
      assertTransition(from, to);
    } catch (e) {
      this.log.error("forbidden transition", { taskId: id, from, to });
      throw e;
    }
    this.store.appendEvent({
      type: "task.state_changed",
      taskId: id,
      state: to,
      ...(reason === undefined ? {} : { reason: trunc(reason, 500) }),
    });
  }

  private agent(id: string, agentId: AgentId, state: AgentState, text?: string): void {
    this.store.appendEvent({
      type: "agent.state_changed",
      taskId: id,
      agentId,
      state,
      ...(text === undefined ? {} : { text: trunc(text, 200) }),
    });
  }

  /** One milestone line for the activity terminal. */
  private note(id: string, agentId: AgentId, text: string): void {
    this.activity?.line(id, agentId, text);
  }

  private goto(id: string, agentId: AgentId, anchor: SemanticAnchor): void {
    this.store.appendEvent({ type: "agent.goto", taskId: id, agentId, anchor });
  }

  private others(id: string, except: AgentId[], state: AgentState = "idle"): void {
    for (const ag of AGENTS) if (!except.includes(ag)) this.agent(id, ag, state);
  }

  private chatter(a: Active, role: Role, prompt: string): void {
    const rt = this.ambient;
    if (!rt) return;
    void (async () => {
      for await (const ev of rt.run({ role, prompt, cwd: process.cwd(), timeoutMs: 5000, signal: a.ac.signal })) {
        if (ev.kind === "output" && this.active.has(a.id) && ev.text.trim()) {
          this.store.appendEvent({ type: "agent.say", taskId: a.id, agentId: role, text: trunc(ev.text.trim(), 300) });
        }
      }
    })().catch((e: unknown) => this.log.debug("ambient failed", { taskId: a.id, error: errorText(e) }));
  }

  private async drive(a: Active, repoId: string, goal: string): Promise<void> {
    try {
      await this.pipeline(a, repoId, goal);
    } catch (e) {
      try {
        await this.handleError(a, goal, e);
      } catch (e2) {
        this.log.error("error handling failed", { taskId: a.id, error: errorText(e2) });
      }
    } finally {
      this.active.delete(a.id);
    }
  }

  private async handleError(a: Active, goal: string, e: unknown): Promise<void> {
    const id = a.id;
    if (a.ac.signal.aborted && a.ac.signal.reason instanceof JobCancelledError) {
      if (a.pending) {
        const approvalId = a.pending.approvalId;
        a.pending = undefined;
        this.store.appendEvent({ type: "approval.resolved", taskId: id, agentId: "architect", approvalId, decision: "reject" });
      }
      if (canTransition(this.state(id), "cancelled")) this.transition(id, "cancelled", "Cancelled by user");
      this.note(id, "architect", "Job cancelled");
      this.others(id, []);
      for (const ag of AGENTS) this.goto(id, ag, "home");
      this.log.info("job cancelled", { taskId: id });
      return;
    }
    const reason = trunc(errorText(e), 500);
    if (e instanceof DiffRejectedError && e.diff) {
      // Requirement 5.4: the rejected patch is kept for the report.
      a.data.diff = e.diff;
      try {
        this.store.saveArtifact({ taskId: id, agentId: "developer", kind: "diff", title: "Rejected patch", filename: "diff-rejected.patch", content: e.diff });
      } catch (e2) {
        this.log.warn("could not store the rejected patch", { taskId: id, error: errorText(e2) });
      }
    }
    this.log.error("job failed", { taskId: id, ...(a.lastStep ? { step: a.lastStep } : {}), error: reason });
    if (this.state(id) !== "failed" && this.state(id) !== "report_ready") {
      this.transition(id, "failed", reason);
      this.store.appendEvent({ type: "task.failed", taskId: id, reason });
    }
    if (a.lastStep) this.agent(id, STEP_ROLE[a.lastStep], "error", reason);
    this.note(id, a.lastStep ? STEP_ROLE[a.lastStep] : "architect", `Job failed: ${reason}`);
    await this.finish(a, goal, "fail", reason);
  }

  private async pipeline(a: Active, repoId: string, goal: string): Promise<void> {
    const id = a.id;
    const { signal } = a.ac;
    const T = this.limits.timeoutsMs;

    // 1. Architect analyses.
    this.transition(id, "analyzing");
    this.goto(id, "architect", "board");
    this.agent(id, "architect", "thinking", "Reading the repo");
    this.note(id, "architect", "Analysing the repo");
    this.others(id, ["architect"]);
    this.chatter(a, "architect", "analysing the repository");
    const plan: Plan = PlanSchema.parse(await this.runStep(a, repoId, goal, "analyze", T.analyze, (c) => this.steps.analyze(c)));
    a.data.plan = plan;
    const task = plan.tasks[0];
    if (!task) throw new Error("plan has no tasks");
    a.data.task = task;
    this.note(id, "architect", `Plan ready: ${plan.tasks.length} ${plan.tasks.length === 1 ? "task" : "tasks"}`);    this.store.saveArtifact({
      taskId: id,
      agentId: "architect",
      kind: "plan",
      title: "Plan",
      filename: "plan.json",
      content: JSON.stringify(plan, null, 2),
    });

    // 2. Human approval. Nothing below runs before resolveApproval.
    this.transition(id, "awaiting_plan_approval");
    this.goto(id, "architect", "mailbox");
    this.agent(id, "architect", "waiting_approval", "Plan ready for approval");
    this.others(id, ["architect"]);
    const approvalId = `appr-${id}`;
    this.store.appendEvent({
      type: "approval.requested",
      taskId: id,
      agentId: "architect",
      approvalId,
      kind: "plan",
      summary: trunc(
        `Plan for: ${goal}\n` +
          plan.tasks.map((t, i) => `${i + 1}. ${t.title} (risk: ${t.risk})`).join("\n") +
          `\nApproving builds task 1: ${task.title}`,
        4000,
      ),
      // One option per plan task. The decision itself stays approve/reject; the first task is built.
      options: plan.tasks.map((t) => trunc(`${t.id}: ${t.title}`, 200)),
    });
    const decision = await new Promise<ApprovalDecision>((resolve, reject) => {
      if (signal.aborted) return reject(signal.reason);
      a.pending = { approvalId, resolve };
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
    if (decision === "reject") {
      this.note(id, "architect", "Plan rejected");
      this.transition(id, "cancelled", "Plan rejected");
      this.others(id, []);
      for (const ag of AGENTS) this.goto(id, ag, "home");
      return;
    }
    this.note(id, "architect", "Approved task 1");
    this.agent(id, "architect", "done", "Plan approved");
    this.goto(id, "architect", "home");

    // 3. Develop, test, review (one retry after a QA fail).
    let feedback: string[] = [];
    let verdict: Verdict = "fail";
    for (let attempt = 1; attempt <= MAX_DEVELOP_ATTEMPTS; attempt++) {
      this.transition(id, "developing");
      this.goto(id, "developer", "desk");
      this.agent(id, "developer", "working", attempt === 1 ? "Editing files" : "Fixing review notes");
      this.note(id, "developer", attempt === 1 ? "Editing files" : `Fixing review notes (attempt ${attempt})`);
      this.chatter(a, "developer", "editing the code");
      const { diff } = await this.runStep(a, repoId, goal, "develop", T.develop, (c) =>
        this.steps.develop(c, { plan, task, attempt, feedback }),
      );
      a.data.diff = diff;
      this.store.saveArtifact({ taskId: id, agentId: "developer", kind: "diff", title: `Patch (attempt ${attempt})`, filename: `diff-${attempt}.patch`, content: diff });
      this.agent(id, "developer", "done", "Patch ready");
      this.note(id, "developer", "Patch ready");

      this.transition(id, "testing");
      this.goto(id, "qa", "computer");
      this.agent(id, "qa", "working", "Running tests");
      this.note(id, "qa", "Running tests");
      const test: TestResult = await this.runStep(a, repoId, goal, "test", T.test, (c) => this.steps.test(c, { diff }));
      a.data.test = test;
      this.note(id, "qa", testResultLine(test));
      this.store.saveArtifact({ taskId: id, agentId: "qa", kind: "test_log", title: `Test log (attempt ${attempt})`, filename: `test_log-${attempt}.txt`, content: test.log });

      this.transition(id, "reviewing");
      this.goto(id, "qa", "desk");
      this.agent(id, "qa", "thinking", "Reviewing the patch");
      this.note(id, "qa", "Reviewing the patch");
      this.chatter(a, "qa", "reviewing the patch");
      const review: Review = ReviewSchema.parse(
        await this.runStep(a, repoId, goal, "review", T.review, (c) => this.steps.review(c, { plan, task, diff, test })),
      );
      a.data.review = review;
      this.note(id, "qa", `Review: ${review.verdict} (risk ${review.risk})`);      this.store.saveArtifact({ taskId: id, agentId: "qa", kind: "review", title: `Review (attempt ${attempt})`, filename: `review-${attempt}.json`, content: JSON.stringify(review, null, 2) });

      verdict = review.verdict === "pass" && test.passed ? "pass" : "fail";
      if (verdict === "pass") break;
      feedback = [...(test.passed ? [] : ["The tests failed."]), ...review.notes];
    }

    // 4. Report.
    this.agent(id, "qa", "done", "Review finished");
    this.transition(id, "report_ready", `verdict:${verdict}`);
    await this.finish(a, goal, verdict);
  }

  /** Builds the report with the report step (fallback on error), then delivers. State must be report_ready or failed. */
  private async finish(a: Active, goal: string, verdict: Verdict, failureReason?: string): Promise<void> {
    const id = a.id;
    if (this.state(id) === "failed") this.transition(id, "report_ready", "verdict:fail");
    this.goto(id, "architect", "mailbox");
    this.agent(id, "architect", "working", "Writing the report");
    const input: ReportInput = { goal, verdict, ...a.data, ...(failureReason ? { failureReason } : {}) };
    let report: { title: string; markdown: string };
    try {
      const view = this.store.getJob(id);
      report = await this.runStep(
        a,
        view?.repoId ?? "",
        goal,
        "report",
        this.reportTimeoutMs,
        (c) => this.steps.report(c, input),
      );
    } catch (e) {
      this.log.warn("report step failed, using fallback", { taskId: id, error: errorText(e) });
      report = fallbackReport(input);
    }
    this.agent(id, "architect", "done", "Report ready");
    this.note(id, "architect", "Report ready");
    this.deliver(id, report);
  }

  private deliver(id: string, report: { title: string; markdown: string } | undefined): void {
    if (report) {
      const title = trunc(report.title.trim() || "Report", 200);
      const markdown = trunc(report.markdown, 100_000);
      this.store.saveArtifact({ taskId: id, agentId: "architect", kind: "report", title, filename: "report.md", content: markdown });
      this.store.appendEvent({ type: "report.ready", taskId: id, agentId: "qa", reportId: `report-${id}`, title, markdown });
    }
    this.transition(id, "delivered");
    this.store.appendEvent({ type: "task.completed", taskId: id });
    this.others(id, []);
    for (const ag of AGENTS) this.goto(id, ag, "home");
  }

  /** Runs one step with a timeout and the job's cancel signal. Rejects at once when either fires. */
  private async runStep<T>(
    a: Active,
    repoId: string,
    goal: string,
    step: StepKey,
    timeoutMs: number,
    fn: (ctx: StepContext) => Promise<T>,
  ): Promise<T> {
    a.ac.signal.throwIfAborted();
    a.lastStep = step;
    const stepIndex = Math.max(0, (this.store.getJob(a.id)?.steps.length ?? 1) - 1);
    const ac = new AbortController();
    const onJobAbort = (): void => ac.abort(a.ac.signal.reason);
    a.ac.signal.addEventListener("abort", onJobAbort, { once: true });
    const timer = setTimeout(() => ac.abort(new StepTimeoutError(step)), timeoutMs);
    const aborted = new Promise<never>((_, reject) => {
      ac.signal.addEventListener("abort", () => reject(ac.signal.reason), { once: true });
    });
    const started = Date.now();
    try {
      const result = await Promise.race([fn({ taskId: a.id, repoId, goal, signal: ac.signal, timeoutMs, stepIndex }), aborted]);
      this.log.info("step finished", { taskId: a.id, step, durationMs: Date.now() - started, status: "ok" });
      return result;
    } catch (e) {
      this.log.warn("step failed", { taskId: a.id, step, durationMs: Date.now() - started, status: "failed", error: errorText(e) });
      throw e;
    } finally {
      clearTimeout(timer);
      a.ac.signal.removeEventListener("abort", onJobAbort);
      if (!ac.signal.aborted) ac.abort(new Error("step finished")); // stops anything still listening
    }
  }
}
