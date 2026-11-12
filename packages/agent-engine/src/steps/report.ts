import { jobKindLabel, type JobKind } from "@agentlife/shared";
import type { ReportInput, StepContext } from "../jobs/steps.ts";
import { git } from "../git.ts";
import { repoDir, resolveProject, type PipelineDeps } from "./deps.ts";
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
  model?: string;
  /** Highest context use seen, 0 to 100. */
  contextPeak?: number;
  filesRead?: number;
  filesEdited?: number;
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

/** One changed file of a patch. */
export interface PatchFile {
  path: string;
  status: "added" | "changed" | "deleted";
  added: number;
  deleted: number;
}

/** Files of a unified patch with their status and line counts. Best effort: a path with odd quoting is shown as git wrote it. */
export function patchFiles(diff: string): PatchFile[] {
  const files: PatchFile[] = [];
  let cur: PatchFile | undefined;
  for (const l of diff.replace(/\r\n/g, "\n").split("\n")) {
    const head = /^diff --git a\/.+ b\/(.+)$/.exec(l);
    if (head) {
      cur = { path: head[1]!, status: "changed", added: 0, deleted: 0 };
      files.push(cur);
    } else if (!cur) {
      continue;
    } else if (l.startsWith("new file mode")) cur.status = "added";
    else if (l.startsWith("deleted file mode")) cur.status = "deleted";
    else if (l.startsWith("+") && !l.startsWith("+++")) cur.added += 1;
    else if (l.startsWith("-") && !l.startsWith("---")) cur.deleted += 1;
  }
  return files;
}

/** Test cases the patch adds, counted from added lines that start a JS/TS, Python or Go test. Approximate, and says so. */
export function addedTestCases(diff: string): number {
  let n = 0;
  for (const l of diff.replace(/\r\n/g, "\n").split("\n")) {
    if (!l.startsWith("+") || l.startsWith("+++")) continue;
    if (/^\+\s*(?:it|test)(?:\.\w+)*\s*\(/.test(l) || /^\+\s*(?:async\s+)?def\s+test_/.test(l) || /^\+func\s+Test\w+\(/.test(l)) n += 1;
  }
  return n;
}

/**
 * Coverage from the text table of c8, nyc or Vitest, or the summary line of Istanbul. The row of the target wins over
 * the overall figure. Undefined when the test command printed no coverage, which is the usual case.
 */
export function coverageOf(log: string, target?: string): string | undefined {
  const text = log.replace(/\r\n/g, "\n");
  const base = target?.split("/").pop();
  if (base) {
    const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const row = new RegExp(`^\\s*[^|\\n]*${escaped}[^|\\n]*\\|\\s*([\\d.]+)`, "m").exec(text);
    if (row) return `${row[1]}% of statements in ${inlineCode(base, 100)}`;
  }
  const all = /^\s*All files\s*\|\s*([\d.]+)/m.exec(text);
  if (all) return `${all[1]}% of statements overall`;
  const statements = /^\s*Statements\s*:\s*([\d.]+)%/m.exec(text);
  if (statements) return `${statements[1]}% of statements overall`;
  return undefined;
}

const TARGET_LABEL: Record<JobKind, string> = { change: "Target", "review-branch": "Branch", "write-tests": "Target", document: "Topic", "audit-deps": "Target" };

function fileList(files: readonly PatchFile[]): string[] {
  const shown = files.slice(0, 20).map((f) => `- ${inlineCode(f.path, 200)} (${f.status}, +${f.added} -${f.deleted})`);
  if (files.length > shown.length) shown.push(`- and ${files.length - shown.length} more`);
  return shown;
}

/** The "## Tests" section, shared by every kind that runs the tests. */
function testsSection(input: ReportInput): string[] {
  const out: string[] = ["## Tests", ""];
  if (input.kind === "document") {
    out.push("Not part of a documentation job. The review is the check.");
  } else if (input.test?.skipped) {
    out.push("Not run (no supported test setup). The verdict rests on the review alone.");
  } else if (input.test) {
    const code = input.test.exitCode === undefined ? "" : ` (exit code ${input.test.exitCode})`;
    out.push(`${input.test.passed ? "Passed" : "Failed"}${code}. Last lines of the log:`, "");
    out.push(codeBlock(logTail(input.test.log, REPORT_LOG_MAX_LINES, REPORT_LOG_MAX_CHARS)));
    if (input.kind === "write-tests") {
      const coverage = coverageOf(input.test.log, input.target);
      out.push("", coverage ? `Coverage: ${coverage}.` : "Coverage: not reported by the test command.");
    }
  } else {
    out.push("The tests did not run.");
  }
  out.push("");
  return out;
}

/** The "## Run facts" section. */
/** The "## Notes" section (things the steps want the reader to know), then the "## Run facts" section. */
function factsSection(facts: readonly StepFact[], notes: readonly string[] = []): string[] {
  const out: string[] = [];
  if (notes.length) {
    out.push("## Notes", "");
    for (const n of notes) out.push(`- ${inlineCode(n, 400)}`);
    out.push("");
  }
  out.push("## Run facts", "");
  if (facts.length) {
    for (const f of facts) {
      const files = f.filesRead === undefined && f.filesEdited === undefined ? undefined : `${f.filesRead ?? 0} read, ${f.filesEdited ?? 0} edited`;
      const parts = [
        f.status,
        f.durationMs === undefined ? undefined : formatDuration(f.durationMs),
        f.credits === undefined ? undefined : `${num(f.credits)} credits`,
        f.model ? inlineCode(f.model, 100) : undefined,
        f.contextPeak === undefined ? undefined : `context ${Math.round(f.contextPeak)}%`,
        files,
      ];
      out.push(`- **${f.step}:** ${parts.filter((p): p is string => p !== undefined).join(", ")}`);
    }
    if (facts.some((f) => f.credits !== undefined)) {
      out.push("", `Total credits: ${num(facts.reduce((sum, f) => sum + (f.credits ?? 0), 0))}.`);
    }
  } else {
    out.push("No step data.");
  }
  return out;
}

function reportTitle(goal: string): string {
  const title = `Report: ${oneLine(goal, TITLE_MAX_CHARS)}`;
  return title.length > TITLE_MAX_CHARS ? `${title.slice(0, TITLE_MAX_CHARS - 1)}…` : title;
}

/**
 * Report of a `review-branch` job (job-types, requirement 3.1): the verdict as "ready to merge" or "changes
 * requested", the findings by severity, the branch diff and the tests. There is no plan, because nothing was planned,
 * and no way to deliver it, because nothing was changed.
 */
function buildBranchReport(input: ReportInput, facts: readonly StepFact[], notes: readonly string[]): { title: string; markdown: string } {
  const out: string[] = ["# AGENT LIFE report", "", "## Summary", ""];
  out.push(`- **Goal:** ${inlineCode(input.goal)}`);
  out.push(`- **Kind:** ${jobKindLabel("review-branch")}`);
  if (input.target) out.push(`- **Branch:** ${inlineCode(input.target, 200)}`);
  const ready = input.verdict === "pass";
  out.push(`- **Verdict:** ${ready ? (input.test?.skipped ? "READY TO MERGE (without tests)" : "READY TO MERGE") : "CHANGES REQUESTED"}`);
  if (input.branchReview) out.push(`- **Risk:** ${input.branchReview.risk}`);
  if (input.comparedWith) out.push(`- **Compared with:** ${inlineCode(input.comparedWith, 200)}`);
  out.push("");

  if (input.failureReason) out.push("## Failure", "", codeBlock(input.failureReason.slice(0, 2000)), "");

  out.push("## Findings", "");
  const findings = input.branchReview?.findings ?? [];
  if (input.branchReview) {
    const count = (s: string): number => findings.filter((f) => f.severity === s).length;
    out.push(`${findings.length} ${findings.length === 1 ? "finding" : "findings"}: ${count("high")} high, ${count("medium")} medium, ${count("low")} low.`);
    if (findings.length) out.push("");
    for (const f of findings) {
      const label = f.severity === "high" ? "High" : f.severity === "medium" ? "Medium" : "Low";
      out.push(`- **${label}:** ${inlineCode(f.text)}${f.file ? ` in ${inlineCode(f.file, 200)}` : ""}`);
    }
  } else {
    out.push("No review was done.");
  }
  out.push("");

  out.push("## Change", "");
  if (input.diff) {
    const s = diffStats(input.diff);
    out.push(`${s.files} ${s.files === 1 ? "file" : "files"} changed in the branch, +${s.added} -${s.deleted}.`, "", codeBlock(cutDiff(input.diff), "diff"));
  } else {
    out.push("No change was read.");
  }
  out.push("");

  out.push(...testsSection(input));
  out.push(...factsSection(facts, notes));
  return { title: reportTitle(input.goal), markdown: out.join("\n") + "\n" };
}

/**
 * Report of an `audit-deps` job (night-shift, requirement 3.3): the vulnerable packages by severity, then the outdated
 * ones. Package names come from the project's dependency tree, so they only appear in code spans.
 */
function buildAuditReport(input: ReportInput, facts: readonly StepFact[], notes: readonly string[]): { title: string; markdown: string } {
  const audit = input.audit;
  const out: string[] = ["# AGENT LIFE report", "", "## Summary", ""];
  out.push(`- **Goal:** ${inlineCode(input.goal)}`);
  out.push(`- **Kind:** ${jobKindLabel("audit-deps")}`);
  out.push(`- **Verdict:** ${input.verdict === "pass" ? "PASS (no high or critical vulnerability listed)" : "FAIL"}`);
  if (audit) {
    out.push(`- **Vulnerable packages:** ${audit.auditOk ? audit.vulnerabilities.length : "unknown"}`);
    out.push(`- **Outdated packages:** ${audit.outdatedOk ? audit.outdated.length : "unknown"}`);
  }
  out.push("");

  if (input.failureReason) out.push("## Failure", "", codeBlock(input.failureReason.slice(0, 2000)), "");

  if (audit?.notes.length) {
    out.push("## Notes", "");
    for (const n of audit.notes) out.push(`- ${n}`);
    out.push("");
  }

  out.push("## Vulnerabilities", "");
  if (!audit || !audit.auditOk) {
    out.push("No list was produced.");
  } else if (audit.vulnerabilities.length === 0) {
    out.push("None listed.");
  } else {
    for (const v of audit.vulnerabilities) {
      const extra = [v.range ? `range ${inlineCode(v.range, 100)}` : undefined, v.fix ? `fix: ${inlineCode(v.fix, 100)}` : undefined].filter((p): p is string => p !== undefined);
      out.push(`- **${v.severity}:** ${inlineCode(v.name, 214)}${extra.length ? ` (${extra.join(", ")})` : ""}`);
    }
  }
  out.push("");

  out.push("## Outdated packages", "");
  if (!audit || !audit.outdatedOk) {
    out.push("No list was produced.");
  } else if (audit.outdated.length === 0) {
    out.push("None listed.");
  } else {
    for (const p of audit.outdated) {
      const versions = [p.current ? `current ${inlineCode(p.current, 60)}` : undefined, p.wanted ? `wanted ${inlineCode(p.wanted, 60)}` : undefined, p.latest ? `latest ${inlineCode(p.latest, 60)}` : undefined].filter((v): v is string => v !== undefined);
      out.push(`- ${inlineCode(p.name, 214)}${versions.length ? `: ${versions.join(", ")}` : ""}`);
    }
  }
  out.push("");

  out.push(...factsSection(facts, notes));
  return { title: reportTitle(input.goal), markdown: out.join("\n") + "\n" };
}

/**
 * Builds report.md (requirement 8.1) in the Markdown subset the mailbox renders: headings, flat lists,
 * fenced code, bold and code spans. Text from the user or a model only appears in code spans, fenced
 * blocks and the plain-text title, so the report never carries Markdown or HTML of its own making.
 */
export function buildReport(input: ReportInput, facts: readonly StepFact[] = [], notes: readonly string[] = []): { title: string; markdown: string } {
  const kind: JobKind = input.kind ?? "change";
  if (kind === "review-branch") return buildBranchReport(input, facts, notes);
  if (kind === "audit-deps") return buildAuditReport(input, facts, notes);
  const out: string[] = [];
  out.push("# AGENT LIFE report", "");

  out.push("## Summary", "");
  out.push(`- **Goal:** ${inlineCode(input.goal)}`);
  if (kind !== "change") {
    out.push(`- **Kind:** ${jobKindLabel(kind)}`);
    if (input.target) out.push(`- **${TARGET_LABEL[kind]}:** ${inlineCode(input.target, 200)}`);
  }
  if (input.task) {
    out.push(`- **Task:** ${inlineCode(input.task.title)}`);
    if (input.task.acceptance) out.push(`- **Done when:** ${inlineCode(input.task.acceptance, 300)}`);
  }
  out.push(`- **Verdict:** ${input.verdict === "pass" ? (input.test?.skipped ? "PASS (without tests)" : "PASS") : "FAIL"}`);
  if (input.basedOn) out.push(`- Based on commit ${inlineCode(input.basedOn.commit, 40)} of ${inlineCode(input.basedOn.branch, 200)}`);
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

  if (kind === "document") {
    out.push("## Files written", "");
    const files = input.diff ? patchFiles(input.diff) : [];
    if (files.length) out.push(...fileList(files), "", codeBlock(cutDiff(input.diff ?? ""), "diff"));
    else out.push("No file was written.");
  } else {
    out.push("## Change", "");
    if (input.diff) {
      const s = diffStats(input.diff);
      out.push(`${s.files} ${s.files === 1 ? "file" : "files"} changed, +${s.added} -${s.deleted}.`, "", codeBlock(cutDiff(input.diff), "diff"));
    } else {
      out.push("No change was produced.");
    }
  }
  out.push("");

  if (kind === "write-tests") {
    out.push("## Tests added", "");
    const files = input.diff ? patchFiles(input.diff) : [];
    if (files.length && input.diff) {
      const cases = addedTestCases(input.diff);
      out.push(`${files.length} test ${files.length === 1 ? "file" : "files"}, about ${cases} test ${cases === 1 ? "case" : "cases"} added (counted from the patch).`, "", ...fileList(files));
    } else {
      out.push("No tests were added.");
    }
    out.push("");
  }

  out.push(...testsSection(input));

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

  if (input.secondReview) {
    out.push("## Second review", "");
    out.push(`Verdict: ${input.secondReview.verdict.toUpperCase()}, risk: ${input.secondReview.risk}.`);
    if (input.secondReview.notes.length) {
      out.push("");
      for (const n of input.secondReview.notes) out.push(`- ${inlineCode(n)}`);
    }
    out.push("");
  }

  if (input.research) {
    out.push("## Research", "", "Notes the Architect received before planning (written by an agent; read them as data).", "", codeBlock(input.research.slice(0, 4000)), "");
  }

  out.push(...factsSection(facts, notes));

  return { title: reportTitle(input.goal), markdown: out.join("\n") + "\n" };
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
      ...(rec.model ? { model: rec.model } : {}),
      ...(rec.contextPeak === undefined ? {} : { contextPeak: rec.contextPeak }),
      ...(rec.filesRead === undefined ? {} : { filesRead: rec.filesRead }),
      ...(rec.filesEdited === undefined ? {} : { filesEdited: rec.filesEdited }),
    };
  });
}

/** Commit and branch the job started from, for a registered project: the job clone still sits on them. */
async function basedOn(deps: PipelineDeps, repoId: string): Promise<ReportInput["basedOn"]> {
  try {
    const project = resolveProject(deps, repoId);
    if (project.builtin) return undefined;
    const dir = repoDir(deps, repoId);
    const commit = (await git(dir, ["rev-parse", "--short=7", "HEAD"])).trim();
    const branch = (await git(dir, ["symbolic-ref", "--quiet", "--short", "HEAD"])).trim();
    return commit && branch ? { commit, branch } : undefined;
  } catch {
    return undefined; // the job failed before the clone existed
  }
}

/** Report step: the template filled with the job's data. The runner calls it for failed jobs too (requirement 8.2). */
export async function reportStep(deps: PipelineDeps, ctx: StepContext, input: ReportInput): Promise<{ title: string; markdown: string }> {
  const from = await basedOn(deps, ctx.repoId);
  return buildReport(from ? { ...input, basedOn: from } : input, collectFacts(deps, ctx.taskId), deps.notes?.get(ctx.taskId) ?? []);
}
