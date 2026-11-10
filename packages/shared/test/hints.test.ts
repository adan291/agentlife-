import { describe, expect, it } from "vitest";
import { AGENT_IDS, FURNI_CATALOG, ROLE_INFO } from "../src/index.ts";

describe("room hints data", () => {
  it("every interactive furniture def has a hint of at most 80 characters", () => {
    const interactive = Object.values(FURNI_CATALOG).filter((d) => d.interaction);
    expect(interactive.length).toBeGreaterThan(0);
    for (const d of interactive) {
      expect(d.hint, d.id).toBeTruthy();
      expect(d.hint!.length).toBeLessThanOrEqual(80);
    }
  });

  it("decorative defs have no hint", () => {
    for (const d of Object.values(FURNI_CATALOG)) if (!d.interaction) expect(d.hint, d.id).toBeUndefined();
  });

  it("uses the texts of the spec for the three interactive items", () => {
    expect(FURNI_CATALOG["computer_desk"]?.hint).toBe("Give the agents a job");
    expect(FURNI_CATALOG["mailbox"]?.hint).toBe("Approve plans and read reports");
    expect(FURNI_CATALOG["board"]?.hint).toBe("Timeline of the current job");
  });

  it("ROLE_INFO covers every agent id", () => {
    for (const id of AGENT_IDS) {
      expect(ROLE_INFO[id].name, id).toBeTruthy();
      expect(ROLE_INFO[id].does, id).toBeTruthy();
    }
    expect(Object.keys(ROLE_INFO).sort()).toEqual([...AGENT_IDS].sort());
  });
});
