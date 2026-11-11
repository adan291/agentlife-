import { describe, expect, it } from "vitest";
import { CrewEventSchema } from "../../packages/shared/src/crew.ts";
import { phaseEvent } from "../crew-phase.ts";

describe("phaseEvent", () => {
  it("builds events the engine accepts", () => {
    for (const p of ["session S9", "review", "verify", "fix 1", "merge", "stopped: pnpm check fails", "done"]) {
      expect(CrewEventSchema.safeParse(phaseEvent(p, "build-board")).success).toBe(true);
    }
  });

  it("drops a spec that is not a valid name and cuts long text", () => {
    expect(phaseEvent("review", "../x").spec).toBeUndefined();
    expect(phaseEvent("x".repeat(200)).phase).toHaveLength(80);
  });
});
