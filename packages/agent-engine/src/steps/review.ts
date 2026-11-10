import { ReviewSchema, type Plan, type Review } from "@agentlife/shared";
import type { PlanTask, StepContext, TestResult } from "../jobs/steps.ts";
import { fence, loadPromptTemplate, renderPrompt } from "../prompts.ts";
import { runRole, worktreeDir, type PipelineDeps } from "./deps.ts";
import { runStructured } from "./extract-json.ts";

/** Limits on what is put into the QA prompt, so one big diff or log cannot crowd out the instructions. */
export const QA_DIFF_MAX_CHARS = 60_000;
export const QA_LOG_MAX_LINES = 100;
export const QA_LOG_MAX_CHARS = 20_000;
const MAX_NOTES = 10;
const MAX_NOTE_CHARS = 500;

export interface ReviewInput {
  plan: Plan;
  task: PlanTask;
  diff: string;
  test: TestResult;
}

/** `passed (exit code 0)` or `FAILED (exit code 1)`. Built by the engine, never from model text. */
export function testStatusText(test: TestResult): string {
  const code = test.exitCode === undefined ? "" : ` (exit code ${test.exitCode})`;
  return `${test.passed ? "passed" : "FAILED"}${code}`;
}

/** The last lines of a test log, cut by line count and size. */
export function logTail(log: string, maxLines: number = QA_LOG_MAX_LINES, maxChars: number = QA_LOG_MAX_CHARS): string {
  let lines = log.replace(/\r\n/g, "\n").trimEnd().split("\n");
  let cut = false;
  if (lines.length > maxLines) {
    lines = lines.slice(-maxLines);
    cut = true;
  }
  let text = lines.join("\n");
  if (text.length > maxChars) {
    text = text.slice(-maxChars);
    cut = true;
  }
  return cut ? `[earlier output omitted]\n${text}` : text;
}

export function diffForPrompt(diff: string, maxChars: number = QA_DIFF_MAX_CHARS): string {
  return diff.length <= maxChars ? diff : `${diff.slice(0, maxChars)}\n[diff truncated: ${diff.length} characters in total]`;
}

/** Requirement 7.3: failed tests mean `fail`, whatever the model said. Notes are bounded. */
export function finalizeReview(review: Review, test: TestResult): Review {
  const notes = review.notes.slice(0, MAX_NOTES).map((n) => (n.length > MAX_NOTE_CHARS ? `${n.slice(0, MAX_NOTE_CHARS - 1)}…` : n));
  if (!test.passed) {
    const note = "The tests failed, so the verdict is fail.";
    return { ...review, verdict: "fail", notes: [note, ...notes].slice(0, MAX_NOTES) };
  }
  return { ...review, notes };
}

/**
 * QA step: the read-only QA agent gets the task, the diff and the test log (all as fenced data) and
 * answers with a review in a json block. One retry on an invalid reply, like the Architect.
 */
export async function reviewStep(deps: PipelineDeps, ctx: StepContext, input: ReviewInput): Promise<Review> {
  const cwd = worktreeDir(deps, ctx.taskId);
  const prompt = renderPrompt(loadPromptTemplate("qa"), {
    goal: fence(ctx.goal),
    task: fence(JSON.stringify(input.task, null, 2), "json"),
    testStatus: testStatusText(input.test),
    testLog: fence(logTail(input.test.log)),
    diff: fence(diffForPrompt(input.diff), "diff"),
  });
  const review = await runStructured({
    what: "review",
    schema: ReviewSchema,
    ask: (note) => runRole(deps, "qa", "review", ctx, note ? `${prompt}\n\n${note}` : prompt, cwd),
  });
  return finalizeReview(review, input.test);
}
