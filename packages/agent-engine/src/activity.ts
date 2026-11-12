import { ACTIVITY_TEXT_MAX, sanitize, type ScopedAgentId } from "@agentlife/shared";
import type { NewEvent } from "./store.ts";

/** At most one runtime-progress activity event per agent in this window (requirement 4.1). */
export const ACTIVITY_THROTTLE_MS = 1000;

export interface ActivityEmitter {
  /** Runtime progress (tool calls): sanitised, and dropped when the agent emitted one less than 1 s ago. */
  progress(taskId: string, agentId: ScopedAgentId, text: string): void;
  /** Job milestone (plan ready, approval, test result): sanitised, not throttled. */
  line(taskId: string, agentId: ScopedAgentId, text: string): void;
}

export interface ActivityEmitterOptions {
  append: (ev: NewEvent) => unknown;
  now?: () => number;
  throttleMs?: number;
}

/**
 * Turns progress and milestones into `agent.activity` events. The text is cleaned with the same rules
 * as build-crew speech (no absolute paths, no secrets, max 80 chars); an empty result emits nothing.
 */
export function createActivityEmitter(opts: ActivityEmitterOptions): ActivityEmitter {
  const now = opts.now ?? Date.now;
  const gap = opts.throttleMs ?? ACTIVITY_THROTTLE_MS;
  const lastAt = new Map<string, number>();

  const emit = (taskId: string, agentId: ScopedAgentId, raw: string): void => {
    const text = sanitize(raw, ACTIVITY_TEXT_MAX);
    if (!text) return;
    opts.append({ type: "agent.activity", taskId, agentId, text });
  };

  return {
    progress(taskId, agentId, text) {
      const t = now();
      // Per job: two jobs on different projects each have their own Architect.
      const key = `${taskId}:${agentId}`;
      const prev = lastAt.get(key);
      if (prev !== undefined && t - prev < gap) return;
      lastAt.set(key, t);
      emit(taskId, agentId, text);
    },
    line(taskId, agentId, text) {
      emit(taskId, agentId, text);
    },
  };
}

/**
 * Pass/fail line for the terminal, with counts when the log has a Vitest summary
 * (`Tests  11 passed | 1 skipped (12)` or `Tests  1 failed | 10 passed (11)`). Falls back to the exit code.
 */
export function testResultLine(result: { passed: boolean; log: string; exitCode?: number; skipped?: boolean }): string {
  if (result.skipped) return "Tests not run (no test setup)";
  // eslint-disable-next-line no-control-regex
  const plain = result.log.replace(/\u001b\[[0-9;]*m/g, "");
  const m = /^\s*Tests\s+(.+)$/m.exec(plain);
  if (m?.[1]) {
    const counts = new Map<string, number>();
    for (const part of m[1].matchAll(/(\d+)\s+(passed|failed)/g)) counts.set(part[2] ?? "", Number(part[1]));
    const passed = counts.get("passed") ?? 0;
    const failed = counts.get("failed") ?? 0;
    // Skipped tests are not counted: "11/11" means all tests that ran passed.
    if (passed + failed > 0) {
      return result.passed ? `Tests passed ${passed}/${passed + failed}` : `Tests failed ${failed}/${passed + failed}`;
    }
  }
  if (result.passed) return "Tests passed";
  return result.exitCode === undefined ? "Tests failed" : `Tests failed (exit ${result.exitCode})`;
}
