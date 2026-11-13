import type { Approval, BranchesResponse, BuildBoard, BuildReport, FloorStatus, HrState, JobDetails, JobView, MemoryState, NightState, PanelName, PipelineResponse, Project, ProgressView, RegisterProjectResult, Repo, Report, ServerMsg, ShopState, TeamSuggestion } from "@agentlife/shared";

export interface PanelData {
  repos: Repo[];
  /** Review desk: the local branches of the floor's project, once the server answered. */
  branches?: BranchesResponse | null;
  /** Reception: every project, the built-in one first. */
  projects: Project[];
  job: JobView | null;
  approvals: Approval[];
  reports: Report[];
  /** The job card (steps, artifact contents) of `job`, once the server answered `job_details`. */
  details: JobDetails | null;
}

/** Pure state behind the panels: which one is open and the latest data from the server. */
export class PanelState {
  open: PanelName | null = null;
  data: PanelData = { repos: [], branches: null, projects: [], job: null, approvals: [], reports: [], details: null };
  /** Every floor with its live status (elevator panel and lobby directory). */
  floors: FloorStatus[] = [];
  /** Room the user is in, from the latest `welcome`. */
  roomId: string | undefined;
  /** Last engine error shown in the computer panel. */
  engineError: string | null = null;
  /** Artifact of the job card that is open in the viewer (instead of the card). */
  viewing: string | null = null;
  /** Answer to the last `register_project`, shown in the Reception panel until it is opened again. */
  registration: RegisterProjectResult | null = null;
  /** Construction board data (lobby) and the verify report the user is reading, if any. */
  build: BuildBoard | null = null;
  buildReport: BuildReport | null = null;
  buildViewing: string | null = null;
  /** Why the board has no data (the scripted engine has none). */
  buildError: string | null = null;
  /** Night board data (lobby), and why a change or the whole board failed. The error is cleared when the panel opens. */
  night: NightState | null = null;
  nightError: string | null = null;
  /** HR desk data (HR office), the HR agent's last proposal, and why the desk failed to do something. */
  hr: HrState | null = null;
  hrError: string | null = null;
  suggestion: TeamSuggestion | null = null;
  /** Project the HR agent is working out a proposal for (a request is out); null when none. */
  hrBusy: string | null = null;
  /** The Library of the project on the user's floor, and why it could not be read or changed. */
  memory: MemoryState | null = null;
  memoryError: string | null = null;
  /** The pipeline of the project on the user's floor (board panel), and why it could not be read or saved. */
  pipeline: PipelineResponse | null = null;
  pipelineError: string | null = null;
  /** The shop (catalogue, balance, stock) and why the last purchase was refused. The error is cleared when the panel opens. */
  shop: ShopState | null = null;
  shopError: string | null = null;
  /** XP, levels, badges and quests (Profile panel, HR cards). Null when the hotel has no progress. */
  progress: ProgressView | null = null;

  /** Returns true when the message changed something the panels show. */
  apply(msg: ServerMsg): boolean {
    switch (msg.type) {
      case "welcome":
        this.open = null;
        this.viewing = null;
        this.registration = null;
        this.roomId = msg.roomId ?? msg.room.id;
        // Another floor has its own job, mailbox and computer: nothing of the old one stays. The server sends the new
        // floor's pending approvals and job right after the welcome.
        this.data.job = null;
        this.data.approvals = [];
        this.data.reports = [];
        this.data.details = null;
        this.data.repos = [];
        this.data.branches = null;
        // The Library belongs to the floor's project.
        this.memory = null;
        this.memoryError = null;
        this.pipeline = null;
        this.pipelineError = null;
        return true;
      case "floors":
        this.floors = msg.floors;
        // Only the floor lists show them; re-rendering another panel would drop what the user is typing.
        return this.open === "elevator" || this.open === "directory";
      case "open_panel":
        this.open = msg.panel;
        this.viewing = null;
        if (msg.panel === "computer") this.engineError = null;
        if (msg.panel === "reception") this.registration = null;
        if (msg.panel === "build") {
          this.buildViewing = null;
          this.buildError = null;
        }
        if (msg.panel === "night") this.nightError = null;
        if (msg.panel === "library") this.memoryError = null;
        if (msg.panel === "board") this.pipelineError = null;
        if (msg.panel === "shop") this.shopError = null;
        if (msg.panel === "hr") {
          this.hrError = null;
          this.suggestion = null;
          this.hrBusy = null;
        }
        return true;
      case "night": {
        // An error that came just before this message (a refused change) stays on screen. The periodic refresh
        // re-renders only when something changed, so a form the user is typing in keeps its focus.
        const same = JSON.stringify(this.night) === JSON.stringify(msg.state);
        this.night = msg.state;
        return !same && this.open === "night";
      }
      case "shop":
        this.shop = msg.state;
        this.shopError = null;
        return this.open === "shop";
      case "progress":
        // The HR cards and the Profile panel show it; the HR cards read their level through a hook.
        this.progress = msg.state;
        return this.open === "hr" || this.open === "profile";
      case "wallet":
        // A grant or a purchase changes the balance; the shop's header and its Buy buttons follow it.
        if (!this.shop || this.shop.balance === msg.balance) return false;
        this.shop = { ...this.shop, balance: msg.balance };
        return this.open === "shop";
      case "hr":
        // After a change the desk sends its new state; a refused change keeps its error on screen until the next action.
        this.hr = msg.state;
        return this.open === "hr";
      case "hr_suggestion":
        this.suggestion = msg.suggestion;
        this.hrBusy = null;
        return this.open === "hr";
      case "memory": {
        // The periodic refresh re-renders only when something changed, so a note being edited keeps its focus.
        const same = JSON.stringify(this.memory) === JSON.stringify(msg.state);
        this.memory = msg.state;
        return !same && (this.open === "library" || this.open === "mailbox");
      }
      case "pipeline": {
        // A save answers with the new pipeline; the editor keeps the user's draft until the steps it started from change.
        const same = JSON.stringify(this.pipeline) === JSON.stringify(msg.state);
        this.pipeline = msg.state;
        this.pipelineError = null;
        return !same && this.open === "board";
      }
      case "build_board":
        this.build = msg.board;
        this.buildError = null;
        return this.open === "build";
      case "build_report":
        this.buildReport = msg.report;
        return this.open === "build";
      case "repos":
        this.data.repos = msg.repos;
        this.engineError = null;
        return true;
      case "branches":
        this.data.branches = { current: msg.current, branches: msg.branches };
        this.engineError = null;
        return true;
      case "projects":
        this.data.projects = msg.projects;
        this.engineError = null;
        return true;
      case "register_result":
        this.registration = msg.result;
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
        if (msg.code === "night_error") {
          this.nightError = msg.message;
          return this.open === "night";
        }
        if (msg.code === "hr_error") {
          this.hrError = msg.message;
          this.hrBusy = null;
          return this.open === "hr";
        }
        if (msg.code === "memory_error") {
          this.memoryError = msg.message;
          return this.open === "library" || this.open === "mailbox";
        }
        if (msg.code === "pipeline_error") {
          this.pipelineError = msg.message;
          return this.open === "board";
        }
        if (msg.code === "shop_error") {
          this.shopError = msg.message;
          return this.open === "shop";
        }
        if (msg.code === "engine_unavailable") {
          this.engineError = msg.message;
          if (this.open === "library") this.memoryError = msg.message;
          if (this.open === "build") this.buildError = msg.message;
          if (this.open === "night") this.nightError = msg.message;
          if (this.open === "hr") {
            this.hrError = msg.message;
            this.hrBusy = null;
          }
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
    this.buildViewing = null;
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
