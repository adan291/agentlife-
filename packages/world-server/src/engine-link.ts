import type { AgentEvent, AgentId, ApprovalDecision, JobView, Repo } from "@agentlife/shared";

/**
 * How the world-server talks to an agent engine. The fake engine (scripted) and the real HTTP/SSE
 * client implement the same interface, so switching does not touch the gateway or the client.
 */
export interface EngineLink {
  listRepos(): Promise<Repo[]>;
  startJob(repoId: string, goal: string): Promise<{ taskId: string }>;
  resolveApproval(approvalId: string, decision: ApprovalDecision, note?: string): Promise<void>;
  getJob(taskId: string): Promise<JobView>;
  /** Model label per role for the hover tooltip. Optional: a link without it sends no `models`. */
  roleModels?(): Promise<Partial<Record<AgentId, string>>>;
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
