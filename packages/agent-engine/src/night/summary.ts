import { jobKindLabel, morningTitle, nightStatusLabel } from "@agentlife/shared";
import type { MorningCounts, MorningJob, MorningSummary, NightJob, NightRecord } from "@agentlife/shared";

/** One line of text: no line breaks, no runs of spaces, capped. Goals and reasons are the user's and the model's words. */
function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export function countJobs(jobs: readonly Pick<NightJob, "status" | "branch">[]): MorningCounts {
  const n = (f: (j: Pick<NightJob, "status" | "branch">) => boolean): number => jobs.filter(f).length;
  return {
    total: jobs.length,
    done: n((j) => j.status === "done"),
    failed: n((j) => j.status === "failed"),
    waiting: n((j) => j.status === "waiting"),
    timedOut: n((j) => j.status === "timed_out"),
    cancelled: n((j) => j.status === "cancelled"),
    skipped: n((j) => j.status === "skipped"),
    delivered: n((j) => j.branch !== undefined),
  };
}

function morningJob(job: NightJob): MorningJob {
  const minutes = job.startedAt !== undefined && job.endedAt !== undefined ? Math.max(0, Math.round((job.endedAt - job.startedAt) / 60_000)) : undefined;
  return {
    id: job.id,
    repoId: job.repoId,
    kind: job.kind,
    goal: oneLine(job.goal, 300),
    status: job.status,
    ...(job.verdict ? { verdict: job.verdict } : {}),
    ...(minutes === undefined ? {} : { minutes }),
    ...(job.reason ? { reason: oneLine(job.reason, 500) } : {}),
    ...(job.branch ? { branch: job.branch } : {}),
  };
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "3 jobs: 2 done, 1 waiting for you." Only the parts that are not zero. */
export function countsLine(c: MorningCounts): string {
  if (c.total === 0) return "No jobs.";
  const parts = [
    c.done ? `${c.done} done` : "",
    c.failed ? `${c.failed} failed` : "",
    c.waiting ? `${c.waiting} waiting for you` : "",
    c.timedOut ? `${c.timedOut} stopped by the time limit` : "",
    c.cancelled ? `${c.cancelled} cancelled` : "",
    c.skipped ? `${c.skipped} skipped` : "",
  ].filter(Boolean);
  return `${plural(c.total, "job", "jobs")}: ${parts.join(", ")}.`;
}

function minutesText(minutes: number | undefined): string {
  if (minutes === undefined) return "";
  return minutes === 0 ? "under a minute" : `${minutes} min`;
}

/** How a job ended, in a few words: "done (pass)", "failed", "waiting for you". */
function outcome(j: MorningJob): string {
  const label = nightStatusLabel(j.status);
  return j.status === "done" && j.verdict ? `${label} (${j.verdict})` : label;
}

/** What the user has to look at: a plan that waits, a failed job, a branch to review. */
function nextSteps(jobs: readonly MorningJob[]): string[] {
  const out: string[] = [];
  for (const j of jobs) {
    if (j.status === "waiting") out.push(`${j.repoId}: ${j.goal}. Open the mailbox on that floor to read the plan and approve or reject it.`);
    else if (j.branch) out.push(`${j.repoId}: review the branch ${j.branch}.`);
  }
  return out;
}

function markdownOf(key: string, counts: MorningCounts, jobs: readonly MorningJob[]): string {
  const lines: string[] = [`# ${morningTitle(key)}`, "", countsLine(counts), ""];
  const waiting = jobs.filter((j) => j.status === "waiting");
  if (waiting.length > 0) {
    lines.push("## Waiting for you", "");
    for (const j of waiting) lines.push(`- ${j.repoId}: ${j.goal}. ${j.reason ?? "The plan needs your approval."}`);
    lines.push("");
  }
  lines.push("## Jobs", "");
  if (jobs.length === 0) lines.push("Nothing was scheduled.");
  for (const j of jobs) {
    const time = minutesText(j.minutes);
    const head = `- ${j.repoId}, ${jobKindLabel(j.kind)}: ${j.goal}. ${outcome(j)}${time ? `, ${time}` : ""}.`;
    const tail = [j.reason && j.status !== "waiting" ? j.reason : "", j.branch ? `Branch: ${j.branch}.` : ""].filter(Boolean).join(" ");
    lines.push(tail ? `${head} ${tail}` : head);
  }
  const steps = nextSteps(jobs);
  if (steps.length > 0) {
    lines.push("", "## To do", "");
    for (const s of steps) lines.push(`- ${s}`);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * The summary of a night (requirement 4.1): one entry per job that belonged to it, the numbers counted here and a
 * Markdown text for the lobby mailbox. Pure: the same night gives the same summary.
 */
export function buildSummary(night: Pick<NightRecord, "key">, jobs: readonly NightJob[], writtenAt: number): MorningSummary {
  const ofNight = jobs.filter((j) => j.nightKey === night.key);
  const list = ofNight.map(morningJob);
  const counts = countJobs(ofNight);
  return { nightKey: night.key, writtenAt, counts, jobs: list, markdown: markdownOf(night.key, counts, list) };
}

/**
 * The facts of the Discord message (requirement 4.2): numbers and outcomes computed here, never by a model. The
 * local model only adds a three-sentence overview below them (`scripts/notify.ts --overview`).
 */
export function discordFacts(summary: MorningSummary): string {
  const lines = [`AGENT LIFE night shift ${summary.nightKey}`, countsLine(summary.counts)];
  for (const j of summary.jobs) {
    const time = minutesText(j.minutes);
    lines.push(`- ${j.repoId}, ${jobKindLabel(j.kind)}: ${oneLine(j.goal, 80)}: ${outcome(j)}${time ? `, ${time}` : ""}`);
  }
  const branches = summary.jobs.flatMap((j) => (j.branch ? [j.branch] : []));
  if (branches.length > 0) lines.push(`Branches to review: ${branches.join(", ")}`);
  if (summary.counts.waiting > 0) {
    const n = summary.counts.waiting;
    lines.push(`${n} ${n === 1 ? "plan waits" : "plans wait"} for your approval, in the mailbox of the project floor.`);
  }
  return lines.join("\n");
}
