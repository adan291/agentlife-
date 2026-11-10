import { describe, expect, it } from "vitest";
import { agentTooltip, clampTooltip } from "../src/ui/tooltip.ts";

describe("clampTooltip", () => {
  it("places the tooltip below and right of the pointer when there is room", () => {
    expect(clampTooltip(100, 100, 120, 40, 800, 600)).toEqual({ left: 114, top: 114 });
  });

  it("flips to the other side near the right and bottom edges", () => {
    const p = clampTooltip(790, 590, 120, 40, 800, 600);
    expect(p.left + 120).toBeLessThanOrEqual(792);
    expect(p.top + 40).toBeLessThanOrEqual(592);
  });

  it("always stays inside the viewport", () => {
    for (const [x, y] of [[0, 0], [799, 0], [0, 599], [400, 300], [-50, 700]] as const) {
      const p = clampTooltip(x, y, 200, 80, 800, 600);
      expect(p.left).toBeGreaterThanOrEqual(0);
      expect(p.top).toBeGreaterThanOrEqual(0);
      expect(p.left + 200).toBeLessThanOrEqual(800);
      expect(p.top + 80).toBeLessThanOrEqual(600);
    }
  });
});

describe("agentTooltip", () => {
  it("shows role, part in the flow, state with text, and model", () => {
    const t = agentTooltip("developer", "working", "Editing files", "auto");
    expect(t.title).toBe("Developer");
    expect(t.lines).toEqual(["Implements the approved task in an isolated copy", "State: working - Editing files", "Model: auto"]);
  });

  it("leaves out the model when unknown and formats the state name", () => {
    const t = agentTooltip("architect", "waiting_approval", undefined, undefined);
    expect(t.lines).toEqual(["Reads the repository and proposes a plan", "State: waiting approval"]);
  });

  it("describes the Builder", () => {
    expect(agentTooltip("builder", "idle", undefined, undefined).lines[0]).toBe("Mirrors the Kiro sessions building this hotel");
  });
});
