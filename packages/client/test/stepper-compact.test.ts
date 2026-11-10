import { describe, expect, it } from "vitest";
import type { JobState, JobView } from "@agentlife/shared";
import { compactStep, stepperFor } from "../src/ui/stepper.ts";

const job = (state: JobState, timeline: [JobState, number, string?][] = []): JobView => ({
  taskId: "t1",
  repoId: "r",
  goal: "g",
  state,
  timeline: timeline.map(([s, ts, text]) => ({ ts, state: s, ...(text ? { text } : {}) })),
});

describe("compactStep", () => {
  it("is null without a job", () => {
    expect(compactStep(stepperFor(null))).toBeNull();
  });

  it("shows the current step with n/6", () => {
    expect(compactStep(stepperFor(job("developing")))?.text).toBe("Build 3/6");
    expect(compactStep(stepperFor(job("created")))?.text).toBe("Plan 1/6");
  });

  it("turns the approval step into the your-turn button", () => {
    const c = compactStep(stepperFor(job("awaiting_plan_approval")));
    expect(c).toEqual({ text: "Your turn 2/6", yourTurn: true, status: "current" });
  });

  it("shows the failed step", () => {
    const c = compactStep(
      stepperFor(
        job("delivered", [
          ["developing", 1000],
          ["failed", 2000],
          ["report_ready", 2100],
          ["delivered", 2200],
        ]),
      ),
    );
    expect(c?.text).toBe("✗ Build (Failed) 3/6");
    expect(c?.status).toBe("failed");
    expect(c?.yourTurn).toBe(false);
  });

  it("says Done once the job is delivered", () => {
    expect(compactStep(stepperFor(job("delivered")))?.text).toBe("Done 6/6");
  });
});
