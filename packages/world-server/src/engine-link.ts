import type {
  AgentEvent,
  AgentId,
  ApprovalDecision,
  BranchesResponse,
  BuildBoard,
  BuildReport,
  DeliveryInfo,
  HireBody,
  HrState,
  ImportView,
  JobDetails,
  JobKind,
  JobView,
  MorningSummary,
  NightJob,
  NightJobRequest,
  NightState,
  Project,
  RegisterProjectBody,
  RegisterProjectResult,
  Repo,
  TeamMember,
  TeamResponse,
  TeamSuggestion,
  UpdateMemberBody,
} from "@agentlife/shared";

/** The HR office's side of the engine: the catalogue, the teams, the imports and the HR agent. Every method rejects with the engine's own message when it refuses. */
export interface HrLink {
  /** Everything the HR desk panel shows. */
  state(): Promise<HrState>;
  team(projectId: string): Promise<TeamResponse>;
  hire(projectId: string, body: HireBody): Promise<TeamMember>;
  update(projectId: string, memberId: string, body: UpdateMemberBody): Promise<TeamMember>;
  fire(projectId: string, memberId: string): Promise<void>;
  importTemplate(url: string): Promise<ImportView>;
  approveImport(id: string, hash: string): Promise<ImportView>;
  rejectImport(id: string): Promise<void>;
  suggest(projectId: string): Promise<TeamSuggestion>;
}

/** What a job other than a plain change needs: its kind and the branch, path or topic it works on. */
export interface StartJobOptions {
  kind: JobKind;
  target?: string | undefined;
}

/**
 * How the world-server talks to an agent engine. The fake engine (scripted) and the real HTTP/SSE
 * client implement the same interface, so switching does not touch the gateway or the client.
 */
export interface EngineLink {
  listRepos(): Promise<Repo[]>;
  /** `options` is absent for a plain change. An engine that cannot run the other kinds rejects them. */
  startJob(repoId: string, goal: string, options?: StartJobOptions): Promise<{ taskId: string }>;
  /** Local branches of a registered project, for the review desk. Optional: a link without it has no branch picker. */
  listBranches?(projectId: string): Promise<BranchesResponse>;
  resolveApproval(approvalId: string, decision: ApprovalDecision, note?: string): Promise<void>;
  getJob(taskId: string): Promise<JobView>;
  /** The job card: job view plus artifact contents (each capped by `ARTIFACT_VIEW_MAX_CHARS`). */
  getJobDetails?(taskId: string): Promise<JobDetails>;
  /** Model label per role for the hover tooltip. Optional: a link without it sends no `models`. */
  roleModels?(): Promise<Partial<Record<AgentId, string>>>;
  /** Reception: registered projects (id and name, never a path). Optional: a link without it has no Reception. */
  listProjects?(): Promise<Project[]>;
  registerProject?(body: RegisterProjectBody): Promise<RegisterProjectResult>;
  removeProject?(projectId: string): Promise<void>;
  /** Fetches the job's branch into the user's repository. Rejects with the engine's message when it refuses. */
  deliver?(taskId: string): Promise<DeliveryInfo>;
  /** Construction board of the lobby: how AGENT LIFE itself is being built. Optional: the scripted engine has none. */
  getBuildBoard?(): Promise<BuildBoard>;
  getBuildReport?(spec: string): Promise<BuildReport>;
  /** Morning summaries of the night shift, newest first (lobby mailbox). Optional: the scripted engine has none. */
  getNightSummaries?(): Promise<MorningSummary[]>;
  /** Night board: the schedule with the window and limits. Optional: the scripted engine has no night shift. */
  getNight?(): Promise<NightState>;
  /** Schedules a night job. Rejects with the engine's message when it refuses (unknown project, full schedule, ...). */
  addNightJob?(job: NightJobRequest): Promise<NightJob>;
  removeNightJob?(id: string): Promise<void>;
  moveNightJob?(id: string, direction: "up" | "down"): Promise<void>;
  /** The HR office (hr-desk). Optional: the scripted engine and the demo have none. */
  hr?: HrLink;
  /** Stream of agent events. Ends when the link is closed. */
  events(): AsyncIterable<AgentEvent>;
  close?(): void;
}

/** Minimal push-to-pull queue used by engine implementations to expose `events()`. */
export class EventQueue<T> implements AsyncIterable<T> {
  private readonly buffer: T[] = [];
  private waiting: ((r: IteratorResult<T>) => void) | null = null;
  private closed = false;

  push(item: T): void {
    if (this.closed) return;
    if (this.waiting) {
      const w = this.waiting;
      this.waiting = null;
      w({ value: item, done: false });
    } else {
      this.buffer.push(item);
    }
  }

  close(): void {
    this.closed = true;
    if (this.waiting) {
      const w = this.waiting;
      this.waiting = null;
      w({ value: undefined, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        if (this.buffer.length > 0) return Promise.resolve({ value: this.buffer.shift() as T, done: false });
        if (this.closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => {
          this.waiting = resolve;
        });
      },
    };
  }
}
