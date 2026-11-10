import { describe, expect, it } from "vitest";
import { JobStateSchema, type JobState } from "@agentlife/shared";
import {
  InvalidTransitionError,
  TRANSITIONS,
  assertTransition,
  canTransition,
  isTerminal,
} from "../src/jobs/transitions.ts";

const ALLOWED: [JobState, JobState][] = [
  ["created", "analyzing"],
  ["created", "cancelled"],
  ["analyzing", "awaiting_plan_approval"],
  ["analyzing", "failed"],
  ["analyzing", "cancelled"],
  ["awaiting_plan_approval", "developing"],
  ["awaiting_plan_approval", "cancelled"],
  ["developing", "testing"],
  ["developing", "failed"],
  ["developing", "cancelled"],
  ["testing", "reviewing"],
  ["testing", "failed"],
  ["testing", "cancelled"],
  ["reviewing", "report_ready"],
  ["reviewing", "developing"],
  ["reviewing", "cancelled"],
  ["report_ready", "delivered"],
  ["failed", "report_ready"],
];

const FORBIDDEN: [JobState, JobState][] = [
  ["created", "developing"],
  ["created", "delivered"],
  ["analyzing", "developing"],
  ["awaiting_plan_approval", "testing"],
  ["awaiting_plan_approval", "failed"],
  ["developing", "reviewing"],
  ["developing", "report_ready"],
  ["testing", "developing"],
  ["testing", "report_ready"],
  ["reviewing", "testing"],
  ["report_ready", "developing"],
  ["report_ready", "cancelled"],
  ["failed", "developing"],
  ["failed", "delivered"],
  ["delivered", "created"],
  ["delivered", "cancelled"],
  ["cancelled", "analyzing"],
  ["cancelled", "failed"],
  ["analyzing", "analyzing"],
];

describe("transition table", () => {
  it("allows exactly the listed transitions", () => {
    for (const [a, b] of ALLOWED) {
      expect(canTransition(a, b), `${a} -> ${b}`).toBe(true);
      expect(() => assertTransition(a, b)).not.toThrow();
    }
    expect(Object.values(TRANSITIONS).flat()).toHaveLength(ALLOWED.length);
  });

  it("rejects forbidden transitions with InvalidTransitionError", () => {
    for (const [a, b] of FORBIDDEN) {
      expect(canTransition(a, b), `${a} -> ${b}`).toBe(false);
      expect(() => assertTransition(a, b)).toThrow(InvalidTransitionError);
    }
  });

  it("covers every job state and keeps delivered and cancelled terminal", () => {
    expect(Object.keys(TRANSITIONS).sort()).toEqual([...JobStateSchema.options].sort());
    expect(TRANSITIONS.delivered).toEqual([]);
    expect(TRANSITIONS.cancelled).toEqual([]);
    expect(isTerminal("delivered")).toBe(true);
    expect(isTerminal("cancelled")).toBe(true);
    expect(isTerminal("failed")).toBe(false);
  });
});
