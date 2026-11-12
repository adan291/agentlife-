import { OVERVIEW_TIMELINE_MAX, statusOfJobState } from "@agentlife/shared";
import type { Approval, FloorInfo, FloorStatus, JobKind, JobState, OverviewFloor, ProjectRole, Report } from "@agentlife/shared";

/** The part of a floor's state the floor list and the overview are built from. */
export interface FloorSnapshot {
  approvals: ReadonlyMap<string, Approval>;
  reports: ReadonlyMap<string, Report>;
  currentTaskId: string | null;
  jobState: JobState | undefined;
  queuePosition: number | undefined;
  unread: "report_ready" | "failed" | null;
  /** Kind and target of the current job (absent kind means `change`). */
  jobKind?: JobKind | undefined;
  jobTarget?: string | undefined;
  /** State entries of the current job, from the engine's events. */
  timeline?: readonly { ts: number; state: JobState }[] | undefined;
}

/** Status of a floor: the state of its latest job, with an unread report or failure shown until the mailbox is opened. */
export function floorStatusOf(f: FloorSnapshot | undefined): Pick<FloorStatus, "status" | "who" | "queuePosition"> {
  const base: { status: FloorStatus["status"]; who?: ProjectRole; queuePosition?: number } = f?.jobState
    ? statusOfJobState(f.jobState, f.queuePosition)
    : { status: "idle" };
  const status = base.status === "idle" && f?.unread ? f.unread : base.status;
  return {
    status,
    ...(status === "working" && base.who ? { who: base.who } : {}),
    ...(status === "queued" && base.queuePosition ? { queuePosition: base.queuePosition } : {}),
  };
}

/**
 * The read-only summary of every project floor for the list view and the command palette (list-mode, D13). Pure.
 * Carries ids, names, states, counts, verdicts and times only; the lobby and the HR office are not project floors.
 */
export function overviewOf(infos: readonly FloorInfo[], floors: ReadonlyMap<string, FloorSnapshot>): OverviewFloor[] {
  const out: OverviewFloor[] = [];
  for (const info of infos) {
    if (info.kind !== "project") continue;
    const projectId = info.roomId.slice("project:".length);
    const f = floors.get(info.roomId);
    const timeline = (f?.timeline ?? []).slice(-OVERVIEW_TIMELINE_MAX).map((e) => ({ ts: e.ts, state: e.state }));
    const waiting = [...(f?.approvals.values() ?? [])].filter((a) => a.status === "pending").length;
    let last: Report | undefined;
    for (const r of f?.reports.values() ?? []) if (!last || (r.ts ?? 0) >= (last.ts ?? 0)) last = r;
    out.push({
      roomId: info.roomId,
      projectId,
      name: info.name,
      ...floorStatusOf(f),
      ...(f?.currentTaskId && f.jobState && timeline.length > 0
        ? {
            job: {
              taskId: f.currentTaskId,
              ...(f.jobKind && f.jobKind !== "change" ? { kind: f.jobKind } : {}),
              ...(f.jobTarget ? { target: f.jobTarget } : {}),
              state: f.jobState,
              startedAt: timeline[0]!.ts,
              timeline,
            },
          }
        : {}),
      waiting,
      ...(last
        ? {
            lastReport: {
              reportId: last.reportId,
              taskId: last.taskId,
              ...(last.verdict ? { verdict: last.verdict } : {}),
              ...(last.ts === undefined ? {} : { at: last.ts }),
              ...(last.delivery ? { delivery: last.delivery.state } : {}),
            },
          }
        : {}),
    });
  }
  return out;
}
