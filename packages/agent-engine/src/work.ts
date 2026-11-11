import { sanitize, StepNameSchema, WORK_TITLE_MAX, type AgentId, type AgentWork, type StepName } from "@agentlife/shared";
import type { RuntimeEvent } from "./runtimes/types.ts";
import type { Store } from "./store.ts";

/** At most one `agent.work` event per agent in this window; the last values are always sent when the step ends. */
export const WORK_THROTTLE_MS = 1000;

/** The `agent.work` payload without the task id. */
export type WorkFields = Omit<AgentWork, "taskId">;

export interface WorkTrackerOptions {
  step: StepName;
  /** Plan task title or "Analysing <repo>". Cleaned with the same rules as activity lines. */
  title: string;
  model?: string | undefined;
  emit: (work: WorkFields) => void;
  now?: () => number;
  throttleMs?: number;
}

/**
 * Counts what one agent does during one step: files read and edited (unique files, from tool events) and the
 * context use. Emits the numbers when the step starts, when they change (throttled) and when it ends.
 */
export class WorkTracker {
  private readonly opts: WorkTrackerOptions;
  private readonly now: () => number;
  private readonly gap: number;
  private readonly title: string;
  private readonly startedAt: number;
  private readonly read = new Set<string>();
  private readonly edited = new Set<string>();
  private contextPct: number | undefined;
  private lastSignature: string | undefined;
  private lastAt = 0;

  constructor(opts: WorkTrackerOptions) {
    this.opts = opts;
    this.now = opts.now ?? Date.now;
    this.gap = opts.throttleMs ?? WORK_THROTTLE_MS;
    this.title = sanitize(opts.title, WORK_TITLE_MAX) || opts.step;
    this.startedAt = this.now();
  }

  snapshot(): WorkFields {
    return {
      step: this.opts.step,
      title: this.title,
      ...(this.opts.model ? { model: this.opts.model } : {}),
      ...(this.contextPct === undefined ? {} : { contextPct: this.contextPct }),
      filesRead: this.read.size,
      filesEdited: this.edited.size,
      startedAt: this.startedAt,
    };
  }

  private signature(): string {
    return `${this.read.size}|${this.edited.size}|${this.contextPct ?? ""}`;
  }

  private send(): void {
    this.lastSignature = this.signature();
    this.lastAt = this.now();
    try {
      this.opts.emit(this.snapshot());
    } catch {
      // A work update must never fail a step.
    }
  }

  /** Announces the step. */
  start(): void {
    this.send();
  }

  /** Takes tool and context events from the runtime; anything else is ignored. */
  feed(ev: RuntimeEvent): void {
    if (ev.kind === "progress" && ev.tool) {
      (ev.tool.kind === "read" ? this.read : this.edited).add(ev.tool.file);
    } else if (ev.kind === "context") {
      this.contextPct = Math.min(100, Math.max(0, ev.pct));
    } else {
      return;
    }
    if (this.signature() !== this.lastSignature && this.now() - this.lastAt >= this.gap) this.send();
  }

  /** Sends the final numbers when they differ from the last ones sent. */
  finish(): void {
    if (this.signature() !== this.lastSignature) this.send();
  }
}

export function defaultWorkTitle(step: StepName, repoId: string): string {
  return step === "analyze" ? `Analysing ${repoId}` : step;
}

export interface StepTrackerInput {
  store: Pick<Store, "appendEvent">;
  taskId: string;
  repoId: string;
  agentId: AgentId;
  /** Name of the step; a name that is not one of the five job steps gives no tracker. */
  step: string;
  title?: string | undefined;
  model?: string | undefined;
  now?: () => number;
}

/** A tracker that writes `agent.work` events to the store, or undefined when `step` is not a job step. */
export function createStepTracker(input: StepTrackerInput): WorkTracker | undefined {
  const step = StepNameSchema.safeParse(input.step);
  if (!step.success) return undefined;
  return new WorkTracker({
    step: step.data,
    title: input.title ?? defaultWorkTitle(step.data, input.repoId),
    model: input.model,
    emit: (work) => void input.store.appendEvent({ type: "agent.work", taskId: input.taskId, agentId: input.agentId, ...work }),
    ...(input.now ? { now: input.now } : {}),
  });
}
