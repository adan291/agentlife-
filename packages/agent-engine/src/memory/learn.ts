import { mkdirSync } from "node:fs";
import { z } from "zod";
import {
  MEMORY_PROPOSALS_MAX,
  MEMORY_TEXT_MAX,
  MemoryDraftSchema,
  type MemoryDraft,
  type MemoryEntry,
  type MemoryProposal,
} from "@agentlife/shared";
import type { FinishedJob } from "../jobs/steps.ts";
import { noopLogger, type Logger } from "../log.ts";
import { fence, loadPromptTemplate, renderPrompt } from "../prompts.ts";
import type { AgentRuntime } from "../runtimes/types.ts";
import { runStructured } from "../steps/extract-json.ts";
import { MemoryRejectedError } from "./safety.ts";
import type { MemoryStore } from "./store.ts";

/** Names the pieces of a job the notebook keeper may read; each is cut so one long log cannot crowd out the rules. */
const GOAL_CHARS = 300;
const PLAN_CHARS = 1500;
const REVIEW_CHARS = 1500;
const REPORT_CHARS = 3000;
const EXISTING_CHARS = 3000;
const EXISTING_ENTRIES = 20;

/** The model may send more than it is asked for; the engine reads the list and keeps the first few. */
const ReplySchema = z.object({ entries: z.array(MemoryDraftSchema).max(20) });

const cut = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);

/** Sections of a report worth reading for lessons; the diff and the test log are not. */
const REPORT_SECTIONS = new Set(["Summary", "Failure", "Findings", "Review", "Notes"]);

/** The parts of report.md the keeper reads: summary, failure, findings, review and notes. */
export function reportDigest(markdown: string, max: number = REPORT_CHARS): string {
  const parts = markdown.replace(/\r\n/g, "\n").split(/^## /m).slice(1);
  const kept = parts.filter((p) => REPORT_SECTIONS.has((p.split("\n", 1)[0] ?? "").trim()));
  return cut(kept.map((p) => `## ${p.trimEnd()}`).join("\n\n"), max);
}

function planText(job: FinishedJob): string {
  const plan = job.input.plan;
  if (!plan) return "(no plan)";
  const lines = plan.tasks.map((t, i) => `${i + 1}. ${t.title} (risk ${t.risk})${job.input.task?.id === t.id ? ", this one was built" : ""}: ${t.why}`);
  return cut(lines.join("\n"), PLAN_CHARS);
}

function reviewText(job: FinishedJob): string {
  const { review, branchReview } = job.input;
  if (review) return cut([`verdict ${review.verdict}, risk ${review.risk}`, ...review.notes.map((n) => `- ${n}`)].join("\n"), REVIEW_CHARS);
  if (branchReview) {
    const findings = branchReview.findings.map((f) => `- ${f.severity}: ${f.text}${f.file ? ` (${f.file})` : ""}`);
    return cut([`verdict ${branchReview.verdict}, risk ${branchReview.risk}`, ...findings].join("\n"), REVIEW_CHARS);
  }
  return "(no review)";
}

/** Jobs worth learning from: they have a plan or a review to read. An audit lists today's package versions, which are not lasting facts. */
export function worthLearning(job: FinishedJob): boolean {
  if (job.input.kind === "audit-deps") return false;
  return job.input.plan !== undefined || job.input.review !== undefined || job.input.branchReview !== undefined;
}

export interface MemoryLearnerOptions {
  store: MemoryStore;
  /** Runs the keeper: the Night intern runtime (local model first), or any runtime in tests. */
  runtime: AgentRuntime;
  /** The kiro-cli agent used when the local model cannot answer (see `service-agents.ts`). */
  agent: string;
  /** The model asked first: the Ollama tag of the intern, or the cheap model. */
  model?: string;
  /** The persona, for the local model, which has no agent file. */
  system?: string;
  /** An empty directory the keeper runs in. Created when missing. */
  cwd: string;
  /** Time for one model call. Default 90 s. */
  timeoutMs?: number;
  rawLogPath?: string;
  logger?: Logger;
}

export interface LearnResult {
  /** Entries waiting for the user (the report shows them as "Remember this?"). Empty when they were stored. */
  proposed: MemoryProposal[];
  /** Entries stored right away because the project auto-remembers. */
  stored: MemoryEntry[];
}

/**
 * Learning after a job (project-memory requirement 2): once a job has its report, a cheap read-only model reads the
 * plan, the review and parts of the report and proposes at most five entries. The proposal is validated against a schema
 * and every entry goes through the store's checks (no paths, no secrets, no repeats). Nothing is stored unless the user
 * accepts it, or the project is set to auto-remember. A model that fails, answers badly or is not there costs the job
 * nothing: the error is logged and no entry is proposed.
 */
export class MemoryLearner {
  private readonly o: MemoryLearnerOptions;
  private readonly log: Logger;
  private readonly running = new Set<Promise<void>>();
  private readonly learning = new Map<string, string>();

  constructor(opts: MemoryLearnerOptions) {
    this.o = opts;
    this.log = opts.logger ?? noopLogger;
  }

  /** Learns from a finished job in the background. Never throws. */
  start(job: FinishedJob): void {
    if (!worthLearning(job)) return;
    this.learning.set(job.taskId, job.repoId);
    const p: Promise<void> = this.learn(job)
      .then(() => undefined)
      .catch((e: unknown) => this.log.warn("learning from the job failed", { taskId: job.taskId, error: e instanceof Error ? e.message : String(e) }))
      .finally(() => {
        this.running.delete(p);
        this.learning.delete(job.taskId);
      });
    this.running.add(p);
  }

  /** Ids of the jobs of a project whose lessons are being written right now. */
  learningOf(projectId: string): string[] {
    return [...this.learning].filter(([, repo]) => repo === projectId).map(([taskId]) => taskId);
  }

  /** Resolves when the lessons being learned have been stored or given up. */
  async idle(): Promise<void> {
    while (this.running.size > 0) await Promise.all([...this.running]);
  }

  async learn(job: FinishedJob): Promise<LearnResult> {
    const none: LearnResult = { proposed: [], stored: [] };
    if (!worthLearning(job)) return none;
    const { store } = this.o;
    const existing = store.list(job.repoId).slice(0, EXISTING_ENTRIES);
    const kind = job.input.kind ?? "change";
    const prompt = renderPrompt(loadPromptTemplate("memory-propose"), {
      existing: fence(cut(existing.length ? existing.map((e) => `- [${e.kind}] ${e.text}`).join("\n") : "(none)", EXISTING_CHARS)),
      summary: fence(`kind: ${kind}\nresult: ${job.input.verdict === "pass" ? "passed" : "failed"}${job.input.failureReason ? `\nfailure: ${cut(job.input.failureReason, 300)}` : ""}`),
      goal: fence(cut(job.goal, GOAL_CHARS)),
      plan: fence(planText(job)),
      review: fence(reviewText(job)),
      report: fence(reportDigest(job.report.markdown)),
      max: String(MEMORY_PROPOSALS_MAX),
      textMax: String(MEMORY_TEXT_MAX),
    });
    mkdirSync(this.o.cwd, { recursive: true });
    const timeoutMs = this.o.timeoutMs ?? 90_000;
    // The whole conversation (local model, then the fallback) may take two calls.
    const signal = AbortSignal.timeout(timeoutMs * 3);
    const ask = async (note?: string): Promise<string> => {
      const out: string[] = [];
      for await (const ev of this.o.runtime.run({
        role: "qa",
        step: "memory",
        prompt: note ? `${prompt}\n\n${note}` : prompt,
        cwd: this.o.cwd,
        timeoutMs,
        signal,
        agent: this.o.agent,
        ...(this.o.model ? { model: this.o.model } : {}),
        ...(this.o.system ? { system: this.o.system } : {}),
        ...(this.o.rawLogPath ? { rawLogPath: this.o.rawLogPath } : {}),
      })) {
        if (ev.kind === "output") out.push(ev.text);
        if (ev.kind === "fallback") this.log.info("the notebook keeper fell back to another model", { taskId: job.taskId, from: ev.from, to: ev.to });
      }
      return out.join("\n");
    };
    const reply = await runStructured({ what: "memory proposal", schema: ReplySchema, ask });
    // Entries are written by a model from untrusted text: trim each, and let the store apply its checks.
    const drafts: MemoryDraft[] = reply.entries.slice(0, MEMORY_PROPOSALS_MAX).map((d) => ({ kind: d.kind, text: d.text.trim() }));
    const proposals = store.propose(job.repoId, job.taskId, drafts);
    if (!store.autoRemember(job.repoId)) return { proposed: proposals, stored: [] };

    const stored: MemoryEntry[] = [];
    const left: MemoryProposal[] = [];
    for (const p of [...proposals].reverse()) {
      try {
        stored.push(store.accept(job.repoId, p.id));
      } catch (e) {
        if (!(e instanceof MemoryRejectedError)) throw e;
        left.push(p); // e.g. the Library is full: the user decides
      }
    }
    return { proposed: left.reverse(), stored };
  }
}
