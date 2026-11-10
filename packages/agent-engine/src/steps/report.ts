import type { ReportInput, StepContext } from "../jobs/steps.ts";
import type { PipelineDeps } from "./deps.ts";
import { logTail } from "./review.ts";

export const REPORT_DIFF_MAX_LINES = 300;
export const REPORT_LOG_MAX_LINES = 60;
const REPORT_LOG_MAX_CHARS = 8_000;
const TITLE_MAX_CHARS = 200;

/** One row of "Run facts". */
export interface StepFact {
  step: string;
  status: "running" | "ok" | "failed" | "cancelled";
  durationMs?: number;
  credits?: number;
  tokens?: number;
}

/** One line of plain text: control characters and runs of whitespace become one space, cut at `maxChars`. */
export function oneLine(text: string, maxChars = 500): string {
  const flat = text.replace(/[\u0000-\u001f\u007f\s]+/g, " ").trim();
  return flat.length > maxChars ? `${flat.slice(0, maxChars - 1)}…` : flat;
}

/**
 * Untrusted text as an inline code span. Inside a code span Markdown and HTML are not interpreted, by any
 * renderer, and the mailbox renderer has no escape syntax, so a code span is the one form that is safe in both.
 */
export function inlineCode(text: string, maxChars = 500): string {
  const t = oneLine(text, maxChars).replace(/`/g, "'");
  return `\`${t === "" ? "(empty)" : t}\``;
}

/**
 * Untrusted text in a fenced block. A line that starts with three backticks would close the block in the
 * mailbox renderer (it does not know longer fences), so such lines get a zero-width space in front.
 */
export function codeBlock(text: string, lang = ""): string {
  const safe = text.replace(/^([ \t]*)(`{3,})/gm, "$1\u200b$2");
  return `\`\`\`${lang}\n${safe}\n\`\`\``;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  const m = Math.floor(s / 60);
  return `${m} min ${String(Math.round(s - m * 60)).padStart(2, "0")} s`;
}

interface DiffStats {
  files: number;
  added: number;
  deleted: number;
}

export function diffStats(diff: string): DiffStats {
  const lines = diff === "" ? [] : diff.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
  let files = 0;
  let added = 0;
  let deleted = 0;
  for (const l of lines) {
    if (l.startsWith("diff --git ")) files += 1;
    else if (l.startsWith("+") && !l.startsWith("+++")) added += 1;
    else if (l.startsWith("-") && !l.startsWith("---")) deleted += 1;
  }
  return { files, added, deleted };
}

function cutDiff(diff: string): string {
  const lines = diff.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
  if (lines.length <= REPORT_DIFF_MAX_LINES) return lines.join("\n");
  return `${lines.slice(0, REPORT_DIFF_MAX_LINES).join("\n")}\n[diff truncated: showing ${REPORT_DIFF_MAX_LINES} of ${lines.length} lines; the full patch is attached to the job]`;
}

function num(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/**
 * Builds report.md (requirement 8.1) in the Markdown subset the mailbox renders: headings, flat lists,
 * fenced code, bold and code spans. Text from the user or a model only appears in code spans, fenced
 * blocks and the plain-text title, so the report never carries Markdown or HTML of its own making.
 */
export function buildReport(input: ReportInput, facts: readonly StepFact[] = []): { title: string; markdown: string } {
  const out: string[] = [];
  out.push("# AGENT LIFE report", "");

  out.push("## Summary", "");
  out.push(`- **Goal:** ${inlineCode(input.goal)}`);
  if (input.task) {
    out.push(`- **Task:** ${inlineCode(input.task.title)}`);
    if (input.task.acceptance) out.push(`- **Done when:** ${inlineCode(input.task.acceptance, 300)}`);
  }
  out.push(`- **Verdict:** ${input.verdict === "pass" ? "PASS" : "FAIL"}`);
  out.push("");

  if (input.failureReason) {
    out.push("## Failure", "", codeBlock(input.failureReason.slice(0, 2000)), "");
  }

  out.push("## Plan", "");
  if (input.plan) {
    input.plan.tasks.forEach((t, i) => {
      const files = t.files.length ? ` - files: ${inlineCode(t.files.slice(0, 5).join(", "), 200)}` : "";
      const chosen = input.task && input.task.id === t.id ? "; implemented" : "";
      out.push(`${i + 1}. ${inlineCode(t.title, 200)} (risk: ${t.risk}${chosen})${files}`);
    });
  } else {
    out.push("No plan was produced.");
  }
  out.push("");

  out.push("## Change", "");
  if (input.diff) {
    const s = diffStats(input.diff);
    out.push(`${s.files} ${s.files === 1 ? "file" : "files"} changed, +${s.added} -${s.deleted}.`, "", codeBlock(cutDiff(input.diff), "diff"));
  } else {
    out.push("No change was produced.");
  }
  out.push("");

  out.push("## Tests", "");
  if (input.test) {
    const code = input.test.exitCode === undefined ? "" : ` (exit code ${input.test.exitCode})`;
    out.push(`${input.test.passed ? "Passed" : "Failed"}${code}. Last lines of the log:`, "");
    out.push(codeBlock(logTail(input.test.log, REPORT_LOG_MAX_LINES, REPORT_LOG_MAX_CHARS)));
  } else {
    out.push("The tests did not run.");
  }
  out.push("");

  out.push("## Review", "");
  if (input.review) {
    out.push(`Verdict: ${input.review.verdict.toUpperCase()}, risk: ${input.review.risk}.`);
    if (input.review.notes.length) {
      out.push("");
      for (const n of input.review.notes) out.push(`- ${inlineCode(n)}`);
    }
  } else {
    out.push("No review was done.");
  }
  out.push("");

  out.push("## Run facts", "");
  if (facts.length) {
    for (const f of facts) {
      const parts = [f.status, f.durationMs === undefined ? undefined : formatDuration(f.durationMs), f.credits === undefined ? undefined : `${num(f.credits)} credits`];
      out.push(`- **${f.step}:** ${parts.filter((p): p is string => p !== undefined).join(", ")}`);
    }
    if (facts.some((f) => f.credits !== undefined)) {
      out.push("", `Total credits: ${num(facts.reduce((sum, f) => sum + (f.credits ?? 0), 0))}.`);
    }
  } else {
    out.push("No step data.");
  }

  const title = `Report: ${oneLine(input.goal, TITLE_MAX_CHARS)}`;
  return { title: title.length > TITLE_MAX_CHARS ? `${title.slice(0, TITLE_MAX_CHARS - 1)}…` : title, markdown: out.join("\n") + "\n" };
}

/** Durations from the job's step records, credits and tokens from the run logs (same keys as the export). */
export function collectFacts(deps: PipelineDeps, taskId: string): StepFact[] {
  const job = deps.store.getJob(taskId);
  if (!job) return [];
  const logs = new Map<string, Record<string, unknown>[]>();
  return job.steps.map((rec, i) => {
    let lines = logs.get(rec.step);
    if (!lines) {
      lines = deps.store.readRunLog(taskId, rec.step);
      logs.set(rec.step, lines);
    }
    let credits: number | undefined;
    let tokens: number | undefined;
    for (const l of lines) {
      if (l["kind"] !== "usage" || l["n"] !== i) continue;
      if (typeof l["credits"] === "number") credits = (credits ?? 0) + l["credits"];
      if (typeof l["tokens"] === "number") tokens = (tokens ?? 0) + l["tokens"];
    }
    return {
      step: rec.step,
      status: rec.status,
      ...(rec.durationMs === undefined ? {} : { durationMs: rec.durationMs }),
      ...(credits === undefined ? {} : { credits }),
      ...(tokens === undefined ? {} : { tokens: Math.round(tokens) }),
    };
  });
}

/** Report step: the template filled with the job's data. The runner calls it for failed jobs too (requirement 8.2). */
export async function reportStep(deps: PipelineDeps, ctx: StepContext, input: ReportInput): Promise<{ title: string; markdown: string }> {
  return buildReport(input, collectFacts(deps, ctx.taskId));
}
