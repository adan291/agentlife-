import { describe, expect, it } from "vitest";
import {
  ClientMsgSchema,
  FURNI_CATALOG,
  HrActionSchema,
  HrStateSchema,
  ServerMsgSchema,
  TeamSuggestionSchema,
  WorldSim,
  checkRoom,
  resolveAnchor,
} from "../src/index.ts";
import type { RoomDef } from "../src/index.ts";
import hr from "../../world-server/rooms/hr.json" with { type: "json" };
import template from "../../world-server/rooms/project-template.json" with { type: "json" };

const act = (a: unknown) => ClientMsgSchema.safeParse({ type: "hr_do", act: a });

describe("HR client messages", () => {
  it("accepts every action the desk offers", () => {
    const ok = [
      { action: "hire", projectId: "alpha", templateId: "qa-strict", displayName: "Vera" },
      { action: "hire", projectId: "alpha", templateId: "qa-strict", displayName: "Vera", model: "claude-haiku-5.5" },
      { action: "update", projectId: "alpha", memberId: "qa-1a2b", displayName: "Vera Two" },
      { action: "update", projectId: "alpha", memberId: "qa-1a2b", model: "auto" },
      { action: "fire", projectId: "alpha", memberId: "qa-1a2b" },
      { action: "import", url: "https://templates.example.org/agents/poet.json" },
      { action: "approve_import", id: "poet-qa", hash: "a".repeat(64) },
      { action: "reject_import", id: "poet-qa" },
      { action: "suggest", projectId: "alpha" },
      { action: "apply", projectId: "alpha", picks: [{ templateId: "qa-fast", displayName: "Wren", model: "auto", replacesId: "qa" }] },
    ];
    for (const a of ok) expect(act(a).success, JSON.stringify(a)).toBe(true);
    expect(ClientMsgSchema.safeParse({ type: "hr_state" }).success).toBe(true);
  });

  it("refuses an action with a bad id, a model that looks like a flag, an address that is not https, or a field it does not know", () => {
    const bad = [
      { action: "hire", projectId: "alpha", templateId: "../x", displayName: "Vera" },
      { action: "hire", projectId: "alpha", templateId: "qa", displayName: "" },
      { action: "hire", projectId: "alpha", templateId: "qa", displayName: "x".repeat(31) },
      { action: "hire", projectId: "alpha", templateId: "qa", displayName: "Vera", model: "--trust-all-tools" },
      { action: "update", projectId: "alpha", memberId: "QA!" },
      { action: "import", url: "http://templates.example.org/x.json" },
      { action: "import", url: "file:///etc/passwd" },
      { action: "approve_import", id: "poet-qa", hash: "short" },
      { action: "apply", projectId: "alpha", picks: [] },
      { action: "apply", projectId: "alpha", picks: Array.from({ length: 4 }, () => ({ templateId: "qa", displayName: "A", model: "auto" })) },
      { action: "grant", tools: ["shell"] },
    ];
    for (const a of bad) expect(act(a).success, JSON.stringify(a)).toBe(false);
  });

  it("an action that tries to carry permissions loses them (the schema keeps only its own fields)", () => {
    const r = HrActionSchema.safeParse({ action: "hire", projectId: "alpha", templateId: "qa", displayName: "Vera", tools: ["shell"], permissions: { rules: [] } });
    expect(r.success).toBe(true);
    if (r.success) expect(Object.keys(r.data).sort()).toEqual(["action", "displayName", "projectId", "templateId"]);
  });
});

describe("HR server messages", () => {
  it("parses the desk state, a proposal, the people at the desks and a ghost leaving", () => {
    const state = { catalogue: [], teams: [{ projectId: "alpha", name: "Alpha", customised: false, members: [] }], imports: [], sources: [], models: { qa: ["auto"] } };
    expect(HrStateSchema.safeParse(state).success).toBe(true);
    expect(ServerMsgSchema.safeParse({ type: "hr", state }).success).toBe(true);

    const suggestion = {
      projectId: "alpha",
      summary: "A quick QA.",
      by: "rules",
      picks: [{ templateId: "qa-fast", displayName: "Wren", model: "auto", templateName: "Fast QA", role: "qa", why: "Small.", replacesId: "qa", replacesName: "QA" }],
    };
    expect(TeamSuggestionSchema.safeParse(suggestion).success).toBe(true);
    expect(ServerMsgSchema.safeParse({ type: "hr_suggestion", suggestion }).success).toBe(true);
    // A pick for a role without a desk is not a valid proposal.
    expect(TeamSuggestionSchema.safeParse({ ...suggestion, picks: [{ ...suggestion.picks[0], role: "reviewer" }] }).success).toBe(false);

    expect(ServerMsgSchema.safeParse({ type: "team_view", roomId: "project:alpha", members: [{ agentId: "qa", name: "Vera", model: "auto" }] }).success).toBe(true);
    expect(ServerMsgSchema.safeParse({ type: "team_view", roomId: "project:alpha", members: [{ agentId: "builder", name: "B" }] }).success).toBe(false);
    expect(ServerMsgSchema.safeParse({ type: "agent_presence", agentId: "qa", present: false }).success).toBe(true);
    expect(ServerMsgSchema.safeParse({ type: "error", code: "hr_error", message: "no" }).success).toBe(true);
    expect(ServerMsgSchema.safeParse({ type: "open_panel", panel: "hr" }).success).toBe(true);
  });
});

describe("HR desk furniture", () => {
  it("is in the HR office, opens the hr panel and has a hint", () => {
    const def = FURNI_CATALOG["hr_desk"]!;
    expect(def.interaction).toBe("hr");
    expect(def.hint).toBeTruthy();
    expect((hr as RoomDef).furni.some((f) => f.defId === "hr_desk")).toBe(true);
    expect(checkRoom(hr as RoomDef)).toEqual([]);
  });
});

describe("WorldSim.sendAgentTo", () => {
  const room = template as unknown as RoomDef;
  const make = () => {
    let now = 1000;
    const sim = new WorldSim(room, () => now, { msPerTile: 100 });
    return { sim, advance: (ms: number) => (now += ms) };
  };

  it("walks an agent to the elevator and back to its desk", () => {
    const { sim, advance } = make();
    const out = sim.sendAgentTo("qa", "door");
    const walk = out.find((m) => m.type === "walk");
    expect(walk).toBeDefined();
    if (walk?.type !== "walk") return;
    const door = resolveAnchor(room, "door")!;
    expect(walk.path.at(-1)).toEqual({ x: door.x, y: door.y });
    advance(walk.path.length * 100 + 50);
    expect(sim.tileOf("qa")).toEqual({ x: door.x, y: door.y });

    const back = sim.sendAgentTo("qa", "home");
    const home = resolveAnchor(room, "home", "qa")!;
    const walkBack = back.find((m) => m.type === "walk");
    expect(walkBack?.type === "walk" && walkBack.path.at(-1)).toEqual({ x: home.x, y: home.y });
  });

  it("does nothing for an agent that does not live in the room", () => {
    const { sim } = make();
    expect(sim.sendAgentTo("builder", "door")).toEqual([]);
  });
});
