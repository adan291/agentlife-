import { ROLE_INFO } from "@agentlife/shared";
import type { FloorStatus, JobKind, JobView, NightJob, NightState, OverviewFloor, ShowablePanel } from "@agentlife/shared";
import { formatDuration } from "./duration.ts";
import { stepName, stepperFor } from "./stepper.ts";
import type { StepperStep } from "./stepper.ts";

/** The kinds of job a user starts from the list or the palette, each with the furniture that holds its form. */
export interface JobChoice {
  kind: JobKind;
  /** Name in the palette ("New <name> job in <project>") and on the row buttons. */
  name: string;
  panel: ShowablePanel;
}

export const JOB_CHOICES: readonly JobChoice[] = [
  { kind: "change", name: "change", panel: "computer" },
  { kind: "review-branch", name: "branch review", panel: "review" },
  { kind: "write-tests", name: "test-writing", panel: "tests" },
  { kind: "document", name: "documentation", panel: "library" },
];

/** Name of a job kind in a row ("Change", "Branch review"). Absent means a change. */
export function kindLabel(kind: JobKind | undefined): string {
  switch (kind ?? "change") {
    case "change":
      return "Change";
    case "review-branch":
      return "Branch review";
    case "write-tests":
      return "Test writing";
    case "document":
      return "Documentation";
    case "audit-deps":
      return "Dependency audit";
  }
}

/** "just now", "42s ago", "3m 05s ago": how long ago something happened. */
export function ago(at: number, now: number): string {
  const ms = Math.max(0, now - at);
  return ms < 5000 ? "just now" : `${formatDuration(ms)} ago`;
}

/** The job of a floor as the stepper sees it. The goal is not part of the overview, so it is left empty. */
export function jobViewOf(floor: OverviewFloor): JobView | null {
  const job = floor.job;
  if (!job) return null;
  return {
    taskId: job.taskId,
    repoId: floor.projectId,
    goal: "",
    ...(job.kind ? { kind: job.kind } : {}),
    ...(job.target ? { target: job.target } : {}),
    state: job.state,
    timeline: job.timeline.map((e) => ({ ts: e.ts, state: e.state })),
  };
}

/** The steps of the floor's current or last job, as the stepper shows them (empty without a job). */
export function stepsOf(floor: OverviewFloor): StepperStep[] {
  return stepperFor(jobViewOf(floor));
}

/** One line about the job: "Change · Build (Developer)", "Branch review · Failed at Test", "Change · Your turn". */
export function jobLine(floor: OverviewFloor): string {
  const job = floor.job;
  if (!job) return "No job yet";
  const steps = stepsOf(floor);
  const target = job.target ? ` ${job.target}` : "";
  const head = `${kindLabel(job.kind)}${target}`;
  const current = steps.find((s) => s.status === "current");
  const failed = steps.find((s) => s.status === "failed");
  if (current) {
    if (current.yourTurn) return `${head} · Your turn`;
    const who = floor.who ? ROLE_INFO[floor.who].name : ROLE_INFO[current.agentId].name;
    const queued = floor.status === "queued" ? ` · queued${floor.queuePosition ? ` (place ${floor.queuePosition})` : ""}` : "";
    return `${head} · ${stepName(current)} (${who})${queued}`;
  }
  if (failed) return `${head} · Failed at ${failed.label}${failed.note && failed.note !== "Failed" ? ` (${failed.note})` : ""}`;
  return `${head} · Done`;
}

/** Number of night jobs of a project that still wait for a night or for the user. */
export function nightCount(night: NightState | null, projectId: string): number {
  if (!night) return 0;
  return night.jobs.filter((j: NightJob) => j.repoId === projectId && (j.status === "scheduled" || j.status === "waiting")).length;
}

/** Text of the status chip of a row (the same words as the elevator panel). */
export function statusLine(floor: Pick<FloorStatus, "status" | "who" | "queuePosition">): string {
  switch (floor.status) {
    case "idle":
      return "Idle";
    case "working":
      return floor.who ? `Working: ${ROLE_INFO[floor.who].name}` : "Working";
    case "waiting_approval":
      return "Waiting for you";
    case "report_ready":
      return "Report ready";
    case "failed":
      return "Failed";
    case "queued":
      return floor.queuePosition ? `Queued (place ${floor.queuePosition})` : "Queued";
  }
}

/** "Last report: pass, 3m ago". Empty when the floor has no report. */
export function reportLine(floor: OverviewFloor, now: number): string {
  const r = floor.lastReport;
  if (!r) return "";
  const verdict = r.verdict === "pass" ? "pass" : r.verdict === "fail" ? "fail" : "no verdict";
  return `Last report: ${verdict}${r.at === undefined ? "" : `, ${ago(r.at, now)}`}`;
}

/** What the row's badge says about waiting approvals ("Waiting for you", "2 waiting for you"). Empty when none. */
export function waitingBadge(floor: OverviewFloor): string {
  if (floor.waiting <= 0) return "";
  return floor.waiting === 1 ? "Waiting for you" : `${floor.waiting} waiting for you`;
}

/** Rows that need the user first, then the busy ones, then the rest, each group in the hotel's floor order. */
export function sortFloors(floors: readonly OverviewFloor[]): OverviewFloor[] {
  const rank = (f: OverviewFloor): number => (f.waiting > 0 || f.status === "waiting_approval" ? 0 : f.status === "report_ready" || f.status === "failed" ? 1 : f.status === "working" || f.status === "queued" ? 2 : 3);
  return floors.map((f, i) => ({ f, i })).sort((a, b) => rank(a.f) - rank(b.f) || a.i - b.i).map((x) => x.f);
}
