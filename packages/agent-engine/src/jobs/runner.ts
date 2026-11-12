import { randomUUID } from "node:crypto";
import {
  BranchReviewSchema,
  PlanSchema,
  ReviewSchema,
  targetProblem,
  type AgentId,
  type AgentState,
  type ApprovalDecision,
  type EngineJobView,
  type JobKind,
  type JobState,
  type Plan,
  type Review,
  type SemanticAnchor,
} from "@agentlife/shared";
import { testResultLine, type ActivityEmitter } from "../activity.ts";
import type { LimitsConfig } from "../config.ts";
import { DEFAULT_MAX_CONCURRENT_JOBS } from "../config.ts";
import { ConflictError, DiffRejectedError, JobCancelledError, NotFoundError, StepTimeoutError } from "../errors.ts";
import { noopLogger, type Logger } from "../log.ts";
import type { AgentRuntime, Role } from "../runtimes/types.ts";
import type { Store } from "../store.ts";
import { createStepTracker, defaultWorkTitle } from "../work.ts";
import { assertTransitionFor, canTransitionFor, hasApproval, hasTestStep, type PathRule } from "./kinds.ts";
import { auditLine, auditVerdict } from "./audit.ts";
import type { FinishedJob, PlanTask, ReportInput, StepContext, Steps, TestResult, Verdict } from "./steps.ts";
import { isTerminal } from "./transitions.ts";

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

/** Wording of the plan step per kind (`review-branch` has no plan). `change` keeps the original texts. */
const PLAN_WORDS: Record<JobKind, { reading: string; analysing: string; chatter: string; summary: string }> = {
  change: { reading: "Reading the repo", analysing: "Analysing the repo", chatter: "analysing the repository", summary: "Plan for" },
  "review-branch": { reading: "Reading the repo", analysing: "Analysing the repo", chatter: "analysing the repository", summary: "Plan for" },
  "write-tests": { reading: "Reading the code to test", analysing: "Planning the tests", chatter: "planning tests", summary: "Test plan for" },
  document: { reading: "Researching the topic", analysing: "Researching the topic", chatter: "researching a topic", summary: "Documentation plan for" },
  "audit-deps": { reading: "Reading the repo", analysing: "Analysing the repo", chatter: "analysing the repository", summary: "Plan for" },
};

/** What the review step is given when the pipeline has no test step (`document`). Never shown as a test result. */
const NO_TEST_STEP: TestResult = { passed: true, skipped: true, log: "not part of this job" };

export interface StartOptions {
  kind?: JobKind;
  /** Branch (`review-branch`), path or module (`write-tests`), topic or path (`document`). */
  target?: string;
  /**
   * Night shift (requirement 2.1): decides whether the plan may be approved without the user. A plan inside the scope is
   * approved at once and the change is held to the same scope; a plan outside it leaves the approval pending with the
   * reason in its summary, and nothing is built. Only for kinds that have an approval step.
   */
  preApproval?: PreApproval;
}

export interface PreApproval {
  /** `{ ok: true }` when every file of the plan is inside the scope. A throw counts as `ok: false`. */
  check(plan: Plan): { ok: true } | { ok: false; reason: string };
  /** The scope as a path rule. Applied to the Developer's diff of a job that this pre-approval approved. */
  paths: PathRule;
}

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
  /**
   * Called once a job has its report and is delivered, with what the report was made from (not for jobs recovered after a
   * restart). The Library learns from it. Runs without being awaited; a throw or a rejection is logged and never changes the job.
   */
  onFinished?: (job: FinishedJob) => void | Promise<void>;
}

interface Active {
  id: string;
  kind: JobKind;
  target?: string;
  preApproval?: PreApproval;
  /** Set when a pre-approval approved the plan: the Developer's diff must stay inside it. */
  pathRule?: PathRule;
  ac: AbortController;
  pending?: { approvalId: string; resolve: (d: ApprovalDecision) => void } | undefined;
  data: Omit<ReportInput, "goal" | "verdict">;
  lastStep?: StepKey;
  done: Promise<void>;
  /** True while the job holds one of the hotel's job slots. */
  slot?: boolean;
  /** Set while the job waits in the queue; called when a slot is given to it. */
  grant?: () => void;
  /** Place last announced with `task.queued`. */
  queuePosition?: number;
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
  if (input.kind && input.kind !== "change") lines.push(`**Kind:** ${input.kind}`);
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
 * Drives the jobs of the hotel through the state machine. A project has at most one job at a time; across the hotel at
 * most `limits.maxConcurrentJobs` run at once and the others wait in a queue (`task.queued` events).
 * Steps are injected; the runner owns state transitions, events, artifacts, timeouts, cancellation and approvals.
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
  private readonly onFinished: RunnerOptions["onFinished"];
  private readonly maxJobs: number;
  private readonly active = new Map<string, Active>();
  private readonly finished = new Map<string, Promise<void>>();
  /** Jobs waiting for a slot, oldest first. */
  private readonly waiting: Active[] = [];
  private running = 0;

  constructor(opts: RunnerOptions) {
    this.store = opts.store;
    this.steps = opts.steps;
    this.limits = opts.limits;
    this.log = opts.logger ?? noopLogger;
    this.ambient = opts.ambient;
    this.newId = opts.newId ?? (() => `task-${randomUUID().slice(0, 8)}`);
    this.reportTimeoutMs = opts.reportTimeoutMs ?? DEFAULT_REPORT_TIMEOUT_MS;
    this.activity = opts.activity;
    this.onFinished = opts.onFinished;
    this.maxJobs = opts.limits.maxConcurrentJobs ?? DEFAULT_MAX_CONCURRENT_JOBS;
  }

  // ---- public API ----

  /**
   * Starts a job. Throws ConflictError("busy") when the project already has a job that is not finished. When the
   * hotel already runs its limit of jobs, the job is created and waits in the queue.
   * `kind` defaults to `change`; the other kinds need a `target` (a branch, a module path or a topic).
   */
  start(repoId: string, goal: string, opts: StartOptions = {}): string {
    const kind = opts.kind ?? "change";
    const problem = targetProblem(kind, opts.target);
    if (problem) throw new ConflictError("invalid_target", problem);
    if (kind === "review-branch" && !this.steps.reviewBranch) {
      throw new ConflictError("unsupported_kind", "this engine cannot review branches");
    }
    if (kind === "audit-deps" && !this.steps.auditDeps) {
      throw new ConflictError("unsupported_kind", "this engine cannot audit dependencies");
    }
    if (opts.preApproval && !hasApproval(kind)) {
      throw new ConflictError("no_approval", `a ${kind} job has no approval step to pre-approve`);
    }
    if (this.activeJobOn(repoId)) throw new ConflictError("busy", "this project already has a job");
    const id = this.newId();
    this.store.appendEvent({
      type: "task.created",
      taskId: id,
      repoId,
      goal,
      ...(kind === "change" ? {} : { kind, ...(opts.target ? { target: opts.target } : {}) }),
    });
    const data: Active["data"] = kind === "change" ? {} : { kind, ...(opts.target ? { target: opts.target } : {}) };
    const a: Active = {
      id,
      kind,
      ...(opts.target ? { target: opts.target } : {}),
      ...(opts.preApproval ? { preApproval: opts.preApproval } : {}),
      ac: new AbortController(),
      data,
      done: Promise.resolve(),
    };
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
    if (!a || !canTransitionFor(view.kind ?? "change", view.state, "cancelled")) {
      throw new ConflictError("not_cancellable", `task is ${view.state}`);
    }
    a.ac.abort(new JobCancelledError());
    await a.done;
  }

  /** Resolves when the job's loop has settled. Never rejects. */
  done(taskId: string): Promise<void> {
    return this.finished.get(taskId) ?? Promise.resolve();
  }

  /** Any job that is not finished, if there is one. */
  activeJobId(): string | undefined {
    return this.store.listJobs().find((j) => !isTerminal(j.state))?.taskId;
  }

  /** The job of this project that is not finished (running, waiting for approval or queued), if any. */
  activeJobOn(repoId: string): string | undefined {
    return this.store.listJobs().find((j) => j.repoId === repoId && !isTerminal(j.state))?.taskId;
  }

  /** Jobs that are waiting for a slot, in the order they will start. */
  queuedJobs(): string[] {
    return this.waiting.map((a) => a.id);
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

  private kindOf(id: string): JobKind {
    return this.store.getJob(id)?.kind ?? "change";
  }

  private transition(id: string, to: JobState, reason?: string): void {
    const from = this.state(id);
    try {
      assertTransitionFor(this.kindOf(id), from, to);
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
      await this.acquireSlot(a);
      await this.pipeline(a, repoId, goal);
    } catch (e) {
      try {
        await this.handleError(a, goal, e);
      } catch (e2) {
        this.log.error("error handling failed", { taskId: a.id, error: errorText(e2) });
      }
    } finally {
      this.active.delete(a.id);
      this.releaseSlot(a);
    }
  }

  /** Takes a job slot, or waits in the queue for one. Rejects with the cancel reason when the job is cancelled while it waits. */
  private acquireSlot(a: Active): Promise<void> {
    if (this.running < this.maxJobs && this.waiting.length === 0) {
      this.running++;
      a.slot = true;
      return Promise.resolve();
    }
    this.waiting.push(a);
    this.announceQueue();
    return new Promise<void>((resolve, reject) => {
      const onAbort = (): void => {
        const i = this.waiting.indexOf(a);
        if (i >= 0) this.waiting.splice(i, 1);
        delete a.grant;
        this.announceQueue();
        reject(a.ac.signal.reason);
      };
      if (a.ac.signal.aborted) return onAbort();
      a.ac.signal.addEventListener("abort", onAbort, { once: true });
      a.grant = () => {
        a.ac.signal.removeEventListener("abort", onAbort);
        delete a.grant;
        resolve();
      };
    });
  }

  /** Gives the slot back and starts the jobs that can run now. */
  private releaseSlot(a: Active): void {
    if (a.slot) {
      a.slot = false;
      this.running--;
    }
    let granted = false;
    while (this.running < this.maxJobs && this.waiting.length > 0) {
      const next = this.waiting.shift()!;
      this.running++;
      next.slot = true;
      granted = true;
      next.grant?.();
    }
    if (granted) this.announceQueue();
  }

  /** Tells every queued job its place (1 is next), so the floors can show the queue. Only changed places are announced. */
  private announceQueue(): void {
    this.waiting.forEach((w, i) => {
      if (w.queuePosition === i + 1) return;
      w.queuePosition = i + 1;
      this.store.appendEvent({ type: "task.queued", taskId: w.id, position: i + 1 });
    });
  }

  private async handleError(a: Active, goal: string, e: unknown): Promise<void> {
    const id = a.id;
    if (a.ac.signal.aborted && a.ac.signal.reason instanceof JobCancelledError) {
      if (a.pending) {
        const approvalId = a.pending.approvalId;
        a.pending = undefined;
        this.store.appendEvent({ type: "approval.resolved", taskId: id, agentId: "architect", approvalId, decision: "reject" });
      }
      if (canTransitionFor(this.kindOf(id), this.state(id), "cancelled")) this.transition(id, "cancelled", "Cancelled by user");
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
    if (a.kind === "review-branch") return this.reviewBranchPipeline(a, repoId, goal);
    if (a.kind === "audit-deps") return this.auditPipeline(a, repoId, goal);
    const planned = await this.planAndApprove(a, repoId, goal);
    if (!planned) return;
    await this.buildAndReview(a, repoId, goal, planned.plan, planned.task);
  }

  /** The pre-approval verdict for a plan. A policy that throws never approves. Undefined when the job has no policy. */
  private preApprove(a: Active, plan: Plan): { ok: true } | { ok: false; reason: string } | undefined {
    if (!a.preApproval) return undefined;
    try {
      const verdict = a.preApproval.check(plan);
      if (verdict.ok) a.pathRule = a.preApproval.paths;
      return verdict;
    } catch (e) {
      this.log.warn("pre-approval failed", { taskId: a.id, error: errorText(e) });
      return { ok: false, reason: "the scope could not be checked" };
    }
  }

  /**
   * `audit-deps`: the sandbox lists outdated and vulnerable packages, then the report. No model, nothing is written and
   * nothing needs approval, so the job is never deliverable.
   */
  private async auditPipeline(a: Active, repoId: string, goal: string): Promise<void> {
    const id = a.id;
    const T = this.limits.timeoutsMs;
    const auditDeps = this.steps.auditDeps?.bind(this.steps);
    if (!auditDeps) throw new Error("this engine cannot audit dependencies");

    this.transition(id, "testing");
    this.goto(id, "qa", "computer");
    this.agent(id, "qa", "working", "Auditing dependencies");
    this.note(id, "qa", "Auditing dependencies");
    this.others(id, ["qa"]);
    const audit = await this.runStep(a, repoId, goal, "test", T.test, "Dependency audit", (c) => auditDeps(c));
    a.data.audit = audit;
    this.note(id, "qa", auditLine(audit));
    this.store.saveArtifact({ taskId: id, agentId: "qa", kind: "audit", title: "Dependency audit", filename: "audit.json", content: JSON.stringify(audit, null, 2) });

    const verdict: Verdict = auditVerdict(audit);
    this.agent(id, "qa", "done", "Audit finished");
    this.transition(id, "report_ready", `verdict:${verdict}`);
    await this.finish(a, goal, verdict);
  }

  /** Steps 1 and 2 of `change`, `write-tests` and `document`: the plan (or research) and the human approval. */
  private async planAndApprove(a: Active, repoId: string, goal: string): Promise<{ plan: Plan; task: PlanTask } | undefined> {
    const id = a.id;
    const { signal } = a.ac;
    const T = this.limits.timeoutsMs;
    const words = PLAN_WORDS[a.kind];

    // 1. Architect analyses.
    this.transition(id, "analyzing");
    this.goto(id, "architect", "board");
    this.agent(id, "architect", "thinking", words.reading);
    this.note(id, "architect", words.analysing);
    this.others(id, ["architect"]);
    this.chatter(a, "architect", words.chatter);
    const plan: Plan = PlanSchema.parse(await this.runStep(a, repoId, goal, "analyze", T.analyze, defaultWorkTitle("analyze", repoId), (c) => this.steps.analyze(c)));
    a.data.plan = plan;
    const task = plan.tasks[0];
    if (!task) throw new Error("plan has no tasks");
    a.data.task = task;
    this.note(id, "architect", `Plan ready: ${plan.tasks.length} ${plan.tasks.length === 1 ? "task" : "tasks"}`);
    this.store.saveArtifact({
      taskId: id,
      agentId: "architect",
      kind: "plan",
      title: "Plan",
      filename: "plan.json",
      content: JSON.stringify(plan, null, 2),
    });

    // 2. Human approval. Nothing below runs before resolveApproval, or before a pre-approval that covers the plan.
    this.transition(id, "awaiting_plan_approval");
    this.goto(id, "architect", "mailbox");
    this.agent(id, "architect", "waiting_approval", "Plan ready for approval");
    this.others(id, ["architect"]);
    const pre = this.preApprove(a, plan);
    const approvalId = `appr-${id}`;
    this.store.appendEvent({
      type: "approval.requested",
      taskId: id,
      agentId: "architect",
      approvalId,
      kind: "plan",
      summary: trunc(
        `${words.summary}: ${goal}\n` +
          plan.tasks.map((t, i) => `${i + 1}. ${t.title} (risk: ${t.risk})`).join("\n") +
          `\nApproving builds task 1: ${task.title}` +
          (pre?.ok ? `\nNight shift: approved automatically, the plan stays inside the pre-approved scope.` : "") +
          (pre && !pre.ok ? `\nNight shift: not approved automatically (${pre.reason}). Nothing is built until you decide.` : ""),
        4000,
      ),
      // One option per plan task. The decision itself stays approve/reject; the first task is built.
      options: plan.tasks.map((t) => trunc(`${t.id}: ${t.title}`, 200)),
    });
    let decision: ApprovalDecision;
    if (pre?.ok) {
      signal.throwIfAborted();
      this.store.appendEvent({ type: "approval.resolved", taskId: id, agentId: "architect", approvalId, decision: "approve" });
      this.note(id, "architect", "Plan approved automatically (night shift)");
      decision = "approve";
    } else {
      if (pre) this.note(id, "architect", "Plan outside the pre-approved scope, waiting for you");
      decision = await new Promise<ApprovalDecision>((resolve, reject) => {
        if (signal.aborted) return reject(signal.reason);
        a.pending = { approvalId, resolve };
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    }
    if (decision === "reject") {
      this.note(id, "architect", "Plan rejected");
      this.transition(id, "cancelled", "Plan rejected");
      this.others(id, []);
      for (const ag of AGENTS) this.goto(id, ag, "home");
      return undefined;
    }
    this.note(id, "architect", "Approved task 1");
    this.agent(id, "architect", "done", "Plan approved");
    this.goto(id, "architect", "home");
    return { plan, task };
  }

  /**
   * Steps 3 and 4: develop, test, review (one retry after a QA fail), then the report. A `document` job has no test
   * step: its review is the check. The engine's path rule for the kind is applied by the develop step.
   */
  private async buildAndReview(a: Active, repoId: string, goal: string, plan: Plan, task: PlanTask): Promise<void> {
    const id = a.id;
    const T = this.limits.timeoutsMs;
    const withTests = hasTestStep(a.kind);
    let feedback: string[] = [];
    let verdict: Verdict = "fail";
    for (let attempt = 1; attempt <= MAX_DEVELOP_ATTEMPTS; attempt++) {
      this.transition(id, "developing");
      this.goto(id, "developer", "desk");
      this.agent(id, "developer", "working", attempt === 1 ? "Editing files" : "Fixing review notes");
      this.note(id, "developer", attempt === 1 ? "Editing files" : `Fixing review notes (attempt ${attempt})`);
      this.chatter(a, "developer", "editing the code");
      const { diff } = await this.runStep(a, repoId, goal, "develop", T.develop, task.title, (c) =>
        this.steps.develop(c, { plan, task, attempt, feedback }),
      );
      a.data.diff = diff;
      this.store.saveArtifact({ taskId: id, agentId: "developer", kind: "diff", title: `Patch (attempt ${attempt})`, filename: `diff-${attempt}.patch`, content: diff });
      this.agent(id, "developer", "done", "Patch ready");
      this.note(id, "developer", "Patch ready");

      let test: TestResult = NO_TEST_STEP;
      if (withTests) {
        this.transition(id, "testing");
        this.goto(id, "qa", "computer");
        this.agent(id, "qa", "working", "Running tests");
        this.note(id, "qa", "Running tests");
        test = await this.runStep(a, repoId, goal, "test", T.test, task.title, (c) => this.steps.test(c, { diff }));
        a.data.test = test;
        this.note(id, "qa", testResultLine(test));
        this.store.saveArtifact({ taskId: id, agentId: "qa", kind: "test_log", title: `Test log (attempt ${attempt})`, filename: `test_log-${attempt}.txt`, content: test.log });
      }
      const checked = test;

      this.transition(id, "reviewing");
      this.goto(id, "qa", "desk");
      this.agent(id, "qa", "thinking", "Reviewing the patch");
      this.note(id, "qa", "Reviewing the patch");
      this.chatter(a, "qa", "reviewing the patch");
      const review: Review = ReviewSchema.parse(
        await this.runStep(a, repoId, goal, "review", T.review, task.title, (c) => this.steps.review(c, { plan, task, diff, test: checked })),
      );
      a.data.review = review;
      this.note(id, "qa", `Review: ${review.verdict} (risk ${review.risk})`);
      this.store.saveArtifact({ taskId: id, agentId: "qa", kind: "review", title: `Review (attempt ${attempt})`, filename: `review-${attempt}.json`, content: JSON.stringify(review, null, 2) });

      verdict = review.verdict === "pass" && checked.passed ? "pass" : "fail";
      if (verdict === "pass") break;
      feedback = [...(checked.passed ? [] : ["The tests failed."]), ...review.notes];
    }

    // 4. Report.
    this.agent(id, "qa", "done", "Review finished");
    this.transition(id, "report_ready", `verdict:${verdict}`);
    await this.finish(a, goal, verdict);
  }

  /**
   * `review-branch`: QA reads the branch diff (read-only), the engine tests the branch in Docker, then the report.
   * Nothing is written and nothing needs approval, so the job is never deliverable.
   */
  private async reviewBranchPipeline(a: Active, repoId: string, goal: string): Promise<void> {
    const id = a.id;
    const T = this.limits.timeoutsMs;
    const branch = a.target;
    const reviewBranch = this.steps.reviewBranch?.bind(this.steps);
    if (!branch) throw new Error("no branch to review");
    if (!reviewBranch) throw new Error("this engine cannot review branches");

    this.transition(id, "reviewing");
    this.goto(id, "qa", "desk");
    this.agent(id, "qa", "thinking", "Reading the branch");
    this.note(id, "qa", "Reviewing the branch");
    this.others(id, ["qa"]);
    this.chatter(a, "qa", "reviewing a branch");
    const result = await this.runStep(a, repoId, goal, "review", T.review, `Review of ${branch}`, (c) => reviewBranch(c, { branch }));
    const review = BranchReviewSchema.parse(result.review);
    a.data.branchReview = review;
    a.data.diff = result.diff;
    a.data.comparedWith = result.base;
    this.note(id, "qa", `Review: ${review.verdict} (risk ${review.risk})`);
    this.store.saveArtifact({ taskId: id, agentId: "qa", kind: "diff", title: "Branch diff", filename: "diff-1.patch", content: result.diff });
    this.store.saveArtifact({ taskId: id, agentId: "qa", kind: "review", title: "Branch review", filename: "review-1.json", content: JSON.stringify(review, null, 2) });

    this.transition(id, "testing");
    this.goto(id, "qa", "computer");
    this.agent(id, "qa", "working", "Running tests");
    this.note(id, "qa", "Running tests");
    const test: TestResult = await this.runStep(a, repoId, goal, "test", T.test, `Tests of ${branch}`, (c) => this.steps.test(c, { diff: result.diff }));
    a.data.test = test;
    this.note(id, "qa", testResultLine(test));
    this.store.saveArtifact({ taskId: id, agentId: "qa", kind: "test_log", title: "Test log", filename: "test_log-1.txt", content: test.log });

    const verdict: Verdict = review.verdict === "pass" && test.passed ? "pass" : "fail";
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
        a.data.task?.title ?? `Report: ${goal}`,
        (c) => this.steps.report(c, input),
      );
    } catch (e) {
      this.log.warn("report step failed, using fallback", { taskId: id, error: errorText(e) });
      report = fallbackReport(input);
    }
    this.agent(id, "architect", "done", "Report ready");
    this.note(id, "architect", "Report ready");
    this.deliver(id, report);
    this.announceFinished({ taskId: id, repoId: this.store.getJob(id)?.repoId ?? "", goal, input, report });
  }

  /** Hands a finished job to `onFinished` without waiting for it. */
  private announceFinished(job: FinishedJob): void {
    if (!this.onFinished || job.repoId === "") return;
    try {
      void Promise.resolve(this.onFinished(job)).catch((e: unknown) => this.log.warn("after-job hook failed", { taskId: job.taskId, error: errorText(e) }));
    } catch (e) {
      this.log.warn("after-job hook failed", { taskId: job.taskId, error: errorText(e) });
    }
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
    title: string,
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
    // Steps without a model call announce their work here; the others do it in runRole.
    if (step === "test" || step === "report") {
      createStepTracker({ store: this.store, taskId: a.id, repoId, agentId: STEP_ROLE[step], step, title })?.start();
    }
    try {
      const result = await Promise.race([
        fn({ taskId: a.id, repoId, goal, signal: ac.signal, timeoutMs, stepIndex, title, kind: a.kind, ...(a.target ? { target: a.target } : {}), ...(a.pathRule ? { pathRule: a.pathRule } : {}) }),
        aborted,
      ]);
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
