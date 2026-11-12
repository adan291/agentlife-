import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { ServerMsgSchema } from "@agentlife/shared";
import type { AgentEvent, CatalogueEntry, ClientMsg, HrState, Project, RoomId, ServerMsg, TeamMember, TeamSuggestion } from "@agentlife/shared";
import { EventQueue } from "../src/engine-link.ts";
import type { EngineLink, HrLink } from "../src/engine-link.ts";
import { startGateway } from "../src/gateway.ts";
import type { Gateway } from "../src/gateway.ts";
import { testHotel } from "./helpers.ts";

const gateways: Gateway[] = [];
const sockets: WebSocket[] = [];
afterEach(async () => {
  for (const s of sockets.splice(0)) s.terminate();
  for (const g of gateways.splice(0)) await g.close();
});

const project: Project = { id: "alpha", name: "ALPHA", stack: "node-npm", testCommand: "npm test", builtin: false, registeredAt: 1 };
const entry = (id: string, role: CatalogueEntry["role"]): CatalogueEntry => ({
  id,
  name: id,
  role,
  tier: role === "developer" ? "write-in-worktree" : "read-only",
  defaultModel: "auto",
  description: `${id} template`,
  source: "built-in",
  origin: "built-in",
});
const member = (id: string, role: TeamMember["role"], displayName: string, templateId = id): TeamMember => ({ id, role, displayName, templateId, model: "auto" });

/** An engine with an HR office whose teams live in memory, and a log of what the gateway asked it to do. */
function engineWithHr(opts: { refuse?: string } = {}) {
  const queue = new EventQueue<AgentEvent>();
  const calls: string[] = [];
  let members: TeamMember[] = [member("architect", "architect", "Architect"), member("developer", "developer", "Developer"), member("qa", "qa", "QA")];
  let counter = 0;
  const suggestion: TeamSuggestion = {
    projectId: "alpha",
    summary: "A quick QA keeps jobs short.",
    by: "rules",
    picks: [{ templateId: "qa-fast", templateName: "qa-fast", role: "qa", displayName: "Wren", model: "auto", why: "Small project.", replacesId: "qa", replacesName: "QA" }],
  };
  const hr: HrLink = {
    state: (): Promise<HrState> =>
      Promise.resolve({
        catalogue: [entry("architect", "architect"), entry("developer", "developer"), entry("qa", "qa"), entry("qa-fast", "qa")],
        teams: [{ projectId: "alpha", name: "ALPHA", customised: members.length !== 3, members: [...members] }],
        imports: [],
        sources: [],
        models: { qa: ["auto"] },
      }),
    team: () => Promise.resolve({ projectId: "alpha", customised: true, members: [...members] }),
    hire: (projectId, body) => {
      calls.push(`hire:${projectId}:${body.templateId}:${body.displayName}:${body.model ?? ""}`);
      if (opts.refuse) return Promise.reject(new Error(opts.refuse));
      const role = body.templateId.startsWith("qa") ? "qa" : (body.templateId as TeamMember["role"]);
      const added = member(`${role}-${++counter}`, role, body.displayName, body.templateId);
      members = [...members, added];
      return Promise.resolve(added);
    },
    update: (projectId, memberId, body) => {
      calls.push(`update:${projectId}:${memberId}:${body.displayName ?? ""}:${body.model ?? ""}`);
      members = members.map((m) => (m.id === memberId ? { ...m, ...(body.displayName ? { displayName: body.displayName } : {}), ...(body.model ? { model: body.model } : {}) } : m));
      return Promise.resolve(members.find((m) => m.id === memberId)!);
    },
    fire: (projectId, memberId) => {
      calls.push(`fire:${projectId}:${memberId}`);
      members = members.filter((m) => m.id !== memberId);
      return Promise.resolve();
    },
    importTemplate: (url) => (calls.push(`import:${url}`), Promise.reject(new Error("not used"))),
    approveImport: (id) => (calls.push(`approve:${id}`), Promise.reject(new Error("not used"))),
    rejectImport: (id) => (calls.push(`reject:${id}`), Promise.resolve()),
    suggest: (projectId) => (calls.push(`suggest:${projectId}`), Promise.resolve(suggestion)),
  };
  const link: EngineLink = {
    listRepos: () => Promise.resolve([{ id: "alpha", name: "ALPHA" }]),
    startJob: () => Promise.reject(new Error("not used")),
    resolveApproval: () => Promise.resolve(),
    getJob: () => Promise.reject(new Error("not used")),
    listProjects: () => Promise.resolve([project]),
    hr,
    events: () => queue,
    close: () => queue.close(),
  };
  return { link, calls };
}

async function connect(link: EngineLink, start: RoomId = "hr") {
  const gateway = await startGateway({ hotel: testHotel({ start }), engine: link, port: 0, tickMs: 5 });
  gateways.push(gateway);
  const ws = new WebSocket(`ws://127.0.0.1:${gateway.port}`);
  sockets.push(ws);
  const received: ServerMsg[] = [];
  const waiters: (() => void)[] = [];
  ws.on("message", (d) => {
    received.push(ServerMsgSchema.parse(JSON.parse(d.toString())));
    waiters.splice(0).forEach((w) => w());
  });
  const waitFor = async (pred: () => boolean, timeoutMs = 3000): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    while (!pred()) {
      const left = deadline - Date.now();
      if (left <= 0) throw new Error("timed out");
      await new Promise<void>((r) => {
        waiters.push(r);
        setTimeout(r, Math.min(left, 25));
      });
    }
  };
  const send = (msg: ClientMsg) => ws.send(JSON.stringify(msg));
  const has = (pred: (m: ServerMsg) => boolean) => received.some(pred);
  const count = (type: ServerMsg["type"]) => received.filter((m) => m.type === type).length;
  await waitFor(() => has((m) => m.type === "welcome"));
  return { received, waitFor, send, has, count };
}

describe("HR desk", () => {
  it("sends the desk's state before the panel opens", async () => {
    const e = engineWithHr();
    const c = await connect(e.link);
    c.send({ type: "use", itemId: "hr_desk_1" });
    await c.waitFor(() => c.has((m) => m.type === "open_panel" && m.panel === "hr"));
    const types = c.received.map((m) => m.type);
    expect(types.indexOf("hr")).toBeGreaterThan(-1);
    expect(types.indexOf("hr")).toBeLessThan(types.indexOf("open_panel"));
    const hr = c.received.find((m) => m.type === "hr");
    expect(hr?.type === "hr" && hr.state.teams[0]?.members.map((m) => m.id)).toEqual(["architect", "developer", "qa"]);
  });

  it("hires, renames, changes a model and fires through the engine, and answers with the new state", async () => {
    const e = engineWithHr();
    const c = await connect(e.link);
    c.send({ type: "hr_do", act: { action: "hire", projectId: "alpha", templateId: "qa-fast", displayName: "Wren", model: "auto" } });
    await c.waitFor(() => c.count("hr") === 1);
    c.send({ type: "hr_do", act: { action: "update", projectId: "alpha", memberId: "qa-1", displayName: "Wren II" } });
    await c.waitFor(() => c.count("hr") === 2);
    c.send({ type: "hr_do", act: { action: "update", projectId: "alpha", memberId: "qa-1", model: "auto" } });
    await c.waitFor(() => c.count("hr") === 3);
    c.send({ type: "hr_do", act: { action: "fire", projectId: "alpha", memberId: "qa-1" } });
    await c.waitFor(() => c.count("hr") === 4);
    expect(e.calls).toEqual(["hire:alpha:qa-fast:Wren:auto", "update:alpha:qa-1:Wren II:", "update:alpha:qa-1::auto", "fire:alpha:qa-1"]);
    const last = c.received.findLast((m) => m.type === "hr");
    expect(last?.type === "hr" && last.state.teams[0]?.members).toHaveLength(3);
  });

  it("shows the engine's refusal as hr_error and still sends the state", async () => {
    const e = engineWithHr({ refuse: "A team holds at most 8 members." });
    const c = await connect(e.link);
    c.send({ type: "hr_do", act: { action: "hire", projectId: "alpha", templateId: "qa-fast", displayName: "Wren" } });
    await c.waitFor(() => c.has((m) => m.type === "error" && m.code === "hr_error" && m.message === "A team holds at most 8 members."));
    await c.waitFor(() => c.count("hr") === 1);
  });

  it("only works in the HR office", async () => {
    const e = engineWithHr();
    const c = await connect(e.link, "lobby");
    c.send({ type: "hr_do", act: { action: "fire", projectId: "alpha", memberId: "qa" } });
    await c.waitFor(() => c.has((m) => m.type === "error" && m.code === "bad_message"));
    expect(e.calls).toEqual([]);
    // Reading the state is allowed anywhere.
    c.send({ type: "hr_state" });
    await c.waitFor(() => c.count("hr") === 1);
  });

  it("rejects an action with a field that does not belong", async () => {
    const e = engineWithHr();
    const c = await connect(e.link);
    c.send({ type: "hr_do", act: { action: "hire", projectId: "alpha", templateId: "../x", displayName: "Wren" } } as unknown as ClientMsg);
    await c.waitFor(() => c.has((m) => m.type === "error" && m.code === "bad_message"));
    c.send({ type: "hr_do", act: { action: "grant", tools: ["shell"] } } as unknown as ClientMsg);
    await c.waitFor(() => c.received.filter((m) => m.type === "error").length === 2);
    expect(e.calls).toEqual([]);
  });

  it("answers a suggestion with the proposal and changes nothing", async () => {
    const e = engineWithHr();
    const c = await connect(e.link);
    c.send({ type: "hr_do", act: { action: "suggest", projectId: "alpha" } });
    await c.waitFor(() => c.has((m) => m.type === "hr_suggestion"));
    expect(e.calls).toEqual(["suggest:alpha"]);
    expect(c.count("hr")).toBe(0);
  });

  it("applies a proposal: each pick is hired, then the member it replaces is fired", async () => {
    const e = engineWithHr();
    const c = await connect(e.link);
    c.send({ type: "hr_do", act: { action: "apply", projectId: "alpha", picks: [{ templateId: "qa-fast", displayName: "Wren", model: "auto", replacesId: "qa" }] } });
    await c.waitFor(() => c.count("hr") === 1);
    expect(e.calls).toEqual(["hire:alpha:qa-fast:Wren:auto", "fire:alpha:qa"]);
    const hr = c.received.find((m) => m.type === "hr");
    expect(hr?.type === "hr" && hr.state.teams[0]?.members.map((m) => m.displayName)).toEqual(["Architect", "Developer", "Wren"]);
  });

  it("does not fire the member a proposal replaces when the hire was refused", async () => {
    const e = engineWithHr({ refuse: "no" });
    const c = await connect(e.link);
    c.send({ type: "hr_do", act: { action: "apply", projectId: "alpha", picks: [{ templateId: "qa-fast", displayName: "Wren", model: "auto", replacesId: "qa" }] } });
    await c.waitFor(() => c.has((m) => m.type === "error" && m.code === "hr_error"));
    expect(e.calls).toEqual(["hire:alpha:qa-fast:Wren:auto"]);
  });
});

describe("people at the desks", () => {
  it("shows the member's name on the floor, and swaps the ghost when somebody else takes the desk", async () => {
    const e = engineWithHr();
    const c = await connect(e.link);
    // Hire a second QA first (nobody changes desks), then let the first one go.
    c.send({ type: "hr_do", act: { action: "hire", projectId: "alpha", templateId: "qa-fast", displayName: "Wren" } });
    await c.waitFor(() => c.count("hr") === 1);
    c.send({ type: "hr_do", act: { action: "fire", projectId: "alpha", memberId: "qa" } });
    await c.waitFor(() => c.count("hr") === 2);

    // Go down to the project floor while the old QA is on its way out.
    c.send({ type: "go_to", roomId: "project:alpha" });
    await c.waitFor(() => c.count("welcome") === 2);
    // Arriving while the old QA is gone: the room is told to keep that ghost out until its successor walks in.
    expect(c.has((m) => m.type === "agent_presence" && m.agentId === "qa" && !m.present)).toBe(true);
    await c.waitFor(() => c.has((m) => m.type === "agent_presence" && m.agentId === "qa" && m.present));
    const views = c.received.flatMap((m) => (m.type === "team_view" ? [m] : []));
    const last = views.at(-1)!;
    expect(last.roomId).toBe("project:alpha");
    expect(last.members).toEqual([
      { agentId: "architect", name: "Architect", model: "auto" },
      { agentId: "developer", name: "Developer", model: "auto" },
      { agentId: "qa", name: "Wren", model: "auto" },
    ]);
    // The new ghost walks in from the elevator after the presence message.
    const msgs = c.received.map((m) => m.type);
    const back = c.received.findIndex((m) => m.type === "agent_presence" && m.present);
    expect(msgs.slice(back).includes("walk")).toBe(true);
  });

  it("changes a name without a walk when the same person is renamed", async () => {
    const e = engineWithHr();
    const c = await connect(e.link);
    c.send({ type: "hr_do", act: { action: "update", projectId: "alpha", memberId: "qa", displayName: "Quinn" } });
    await c.waitFor(() => c.count("hr") === 1);
    c.send({ type: "go_to", roomId: "project:alpha" });
    await c.waitFor(() => c.count("welcome") === 2);
    await c.waitFor(() => c.received.some((m) => m.type === "team_view" && m.members.some((x) => x.name === "Quinn")));
    expect(c.has((m) => m.type === "agent_presence")).toBe(false);
  });
});
