import type { Approval, JobDetails, JobView, PanelName, Repo, Report, ServerMsg } from "@agentlife/shared";

export interface PanelData {
  repos: Repo[];
  job: JobView | null;
  approvals: Approval[];
  reports: Report[];
  /** The job card (steps, artifact contents) of `job`, once the server answered `job_details`. */
  details: JobDetails | null;
}

/** Pure state behind the panels: which one is open and the latest data from the server. */
export class PanelState {
  open: PanelName | null = null;
  data: PanelData = { repos: [], job: null, approvals: [], reports: [], details: null };
  /** Last engine error shown in the computer panel. */
  engineError: string | null = null;
  /** Artifact of the job card that is open in the viewer (instead of the card). */
  viewing: string | null = null;

  /** Returns true when the message changed something the panels show. */
  apply(msg: ServerMsg): boolean {
    switch (msg.type) {
      case "welcome":
        this.open = null;
        this.viewing = null;
        return true;
      case "open_panel":
        this.open = msg.panel;
        this.viewing = null;
        if (msg.panel === "computer") this.engineError = null;
        return true;
      case "repos":
        this.data.repos = msg.repos;
        this.engineError = null;
        return true;
      case "job_update":
        if (this.data.job && this.data.job.taskId !== msg.job.taskId) {
          this.data.approvals = [];
          this.data.reports = [];
          this.data.details = null;
          this.viewing = null;
        }
        this.data.job = msg.job;
        return true;
      case "job_details":
        // An answer for a job that is not the current one (a slow reply after a new job started) is dropped.
        if (this.data.job && this.data.job.taskId !== msg.details.job.taskId) return false;
        this.data.details = msg.details;
        return true;
      case "approval":
        this.data.approvals = upsert(this.data.approvals, msg.approval, (a) => a.approvalId);
        return true;
      case "report":
        this.data.reports = upsert(this.data.reports, msg.report, (r) => r.reportId);
        return true;
      case "error":
        if (msg.code === "engine_unavailable") {
          this.engineError = msg.message;
          return true;
        }
        return false;
      default:
        return false;
    }
  }

  close(): void {
    this.open = null;
    this.viewing = null;
  }

  /** Opens an artifact of the job card in the viewer. */
  view(artifactId: string): void {
    this.viewing = artifactId;
  }

  /** Back from the viewer to the job card. */
  back(): void {
    this.viewing = null;
  }
}

function upsert<T>(list: T[], item: T, key: (t: T) => string): T[] {
  const k = key(item);
  const i = list.findIndex((x) => key(x) === k);
  if (i < 0) return [...list, item];
  const copy = list.slice();
  copy[i] = item;
  return copy;
}
