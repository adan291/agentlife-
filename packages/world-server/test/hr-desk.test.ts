import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { ServerMsgSchema, resolveAnchor } from "@agentlife/shared";
import type { AgentEvent, CatalogueEntry, ClientMsg, GuestId, HrState, Project, RoomId, ServerMsg, TeamMember, TeamSuggestion } from "@agentlife/shared";
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

/** The templates of the mock catalogue: `night-intern` is a researcher, `reviewer` a reviewer. */
const CATALOGUE: CatalogueEntry[] = [
  entry("architect", "architect"),
  entry("developer", "developer"),
  entry("qa", "qa"),
  entry("qa-fast", "qa"),
  entry("reviewer", "reviewer"),
  entry("researcher", "researcher"),
  entry("night-intern", "researcher"),
];
const DEFAULT_TEAM = (): TeamMember[] => [member("architect", "architect", "Architect"), member("developer", "developer", "Developer"), member("qa", "qa", "QA")];

/** An engine with an HR office whose teams live in memory, and a log of what the gateway asked it to do. */
function engineWithHr(opts: { refuse?: string; team?: TeamMember[] } = {}) {
  const queue = new EventQueue<AgentEvent>();
  const calls: string[] = [];
  let members: TeamMember[] = opts.team ?? DEFAULT_TEAM();
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
        catalogue: [...CATALOGUE],
        teams: [{ projectId: "alpha", name: "ALPHA", customised: members.length !== 3, members: [...members] }],
        imports: [],
        sources: [],
        models: { qa: ["auto"] },
      }),
    team: () => Promise.resolve({ projectId: "alpha", customised: true, members: [...members] }),
    hire: (projectId, body) => {
      calls.push(`hire:${projectId}:${body.templateId}:${body.displayName}:${body.model ?? ""}`);
      if (opts.refuse) return Promise.reject(new Error(opts.refuse));
      const role = CATALOGUE.find((c) => c.id === body.templateId)?.role ?? "qa";
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
  const hotel = testHotel({ start });
  const gateway = await startGateway({ hotel, engine: link, port: 0, tickMs: 5 });
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
  return { received, waitFor, send, has, count, hotel };
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

/** Hr-desk requirement 4.3: every hired member is on their project's floor, at a desk or at a standing spot. */
describe("everybody hired is on the floor", () => {
  type Conn = Awaited<ReturnType<typeof connect>>;
  const views = (c: Conn) => c.received.flatMap((m) => (m.type === "team_view" ? [m] : []));
  const lastView = (c: Conn) => views(c).at(-1);
  const guestsOf = (c: Conn) => Object.fromEntries((lastView(c)?.guests ?? []).map((g) => [g.guestId, `${g.name}:${g.role}`]));
  const lastWelcome = (c: Conn) => c.received.findLast((m) => m.type === "welcome");
  const floor = (c: Conn) => c.hotel.sim("project:alpha")!;
  const spot = (c: Conn, id: GuestId | "qa") => {
    const a = resolveAnchor(floor(c).room, "home", id)!;
    return { x: a.x, y: a.y };
  };
  const door = (c: Conn) => ({ x: floor(c).room.door.x, y: floor(c).room.door.y });

  const secondDeveloper = member("developer-2", "developer", "Dex", "developer");
  const secondQa = member("qa-2", "qa", "Wren", "qa-fast");
  const reviewer = member("reviewer-1", "reviewer", "Rhea", "reviewer");
  const researcher = member("researcher-1", "researcher", "Rue", "researcher");
  const intern = member("night-intern-1", "researcher", "Nox", "night-intern");

  it("puts a second developer, a reviewer, a researcher and the Night intern at standing spots near the desks", async () => {
    const e = engineWithHr();
    const c = await connect(e.link);
    let hired = 0;
    for (const [templateId, displayName] of [["developer", "Dex"], ["reviewer", "Rhea"], ["researcher", "Rue"], ["night-intern", "Nox"]] as const) {
      c.send({ type: "hr_do", act: { action: "hire", projectId: "alpha", templateId, displayName } });
      hired += 1;
      const expected = hired;
      await c.waitFor(() => c.count("hr") === expected);
    }
    c.send({ type: "go_to", roomId: "project:alpha" });
    await c.waitFor(() => c.count("welcome") === 2);
    await c.waitFor(() => Object.keys(guestsOf(c)).length === 4);

    // The second developer stands by the developer's desk, the reviewer and researcher by the middle of the room.
    expect(guestsOf(c)).toEqual({ guest2: "Dex:developer", guest5: "Rhea:reviewer", guest6: "Rue:researcher", guest1: "Nox:researcher" });
    // The three desks keep the first member of their role.
    expect(lastView(c)!.members.map((m) => m.name)).toEqual(["Architect", "Developer", "QA"]);
    // All six spots exist in the room the user entered, and the four hired members walked to theirs.
    const w = lastWelcome(c);
    expect(w?.type === "welcome" && w.avatars.filter((a) => typeof a.id === "string" && a.id.startsWith("guest")).length).toBe(6);
    await c.waitFor(() => (["guest1", "guest2", "guest5", "guest6"] as const).every((g) => JSON.stringify(floor(c).tileOf(g)) === JSON.stringify(spot(c, g))));
    // The two spots nobody uses stay at the elevator, and the client is told only about the four.
    expect(floor(c).tileOf("guest3")).toEqual(door(c));
    expect(floor(c).tileOf("guest4")).toEqual(door(c));
    expect(lastView(c)!.guests).toHaveLength(4);
  });

  it("shows a full team of eight: three at their desks and five at spots, each walking in from the elevator", async () => {
    const team = [...DEFAULT_TEAM(), secondDeveloper, secondQa, reviewer, researcher, intern];
    expect(team).toHaveLength(8);
    const e = engineWithHr({ team });
    const c = await connect(e.link, "project:alpha");
    await c.waitFor(() => (lastView(c)?.guests?.length ?? 0) === 5);
    const view = lastView(c)!;
    expect([...view.members.map((m) => m.name), ...view.guests!.map((g) => g.name)].sort()).toEqual(team.map((m) => m.displayName).sort());
    expect(new Set(view.guests!.map((g) => g.guestId)).size).toBe(5);

    const welcome = lastWelcome(c);
    if (welcome?.type !== "welcome") throw new Error("unreachable");
    for (const g of view.guests!) {
      const home = resolveAnchor(welcome.room, "home", g.guestId)!;
      const at = (pred: (m: ServerMsg) => boolean) => c.received.findIndex(pred);
      const presence = at((m) => m.type === "agent_presence" && m.agentId === g.guestId && m.present);
      const walk = at((m) => m.type === "walk" && m.id === g.guestId);
      const listed = at((m) => m.type === "team_view" && (m.guests ?? []).some((x) => x.guestId === g.guestId));
      // Told they are present, then seen walking to their spot, and only then listed on the floor.
      expect(presence, `${g.name} comes in`).toBeGreaterThan(-1);
      expect(walk, `${g.name} walks`).toBeGreaterThan(presence);
      expect(listed, `${g.name} is listed`).toBeGreaterThan(walk);
      const walkMsg = c.received[walk];
      expect(walkMsg?.type === "walk" && walkMsg.path.at(-1)).toEqual({ x: home.x, y: home.y });
    }
  });

  it("walks a member who is let go to the elevator, empties the spot, and leaves the others where they stand", async () => {
    const e = engineWithHr({ team: [...DEFAULT_TEAM(), secondDeveloper, reviewer] });
    const c = await connect(e.link);
    c.send({ type: "go_to", roomId: "project:alpha" });
    await c.waitFor(() => c.count("welcome") === 2);
    await c.waitFor(() => Object.keys(guestsOf(c)).length === 2);
    expect(guestsOf(c)).toEqual({ guest2: "Dex:developer", guest5: "Rhea:reviewer" });
    await c.waitFor(() => JSON.stringify(floor(c).tileOf("guest2")) === JSON.stringify(spot(c, "guest2")));

    c.send({ type: "go_to", roomId: "hr" });
    await c.waitFor(() => c.count("welcome") === 3);
    c.send({ type: "hr_do", act: { action: "fire", projectId: "alpha", memberId: "developer-2" } });
    await c.waitFor(() => c.count("hr") === 1);
    c.send({ type: "go_to", roomId: "project:alpha" });
    await c.waitFor(() => c.count("welcome") === 4);
    const back = c.received.map((m) => m.type).lastIndexOf("welcome");
    // Arriving while he is still on his way out: that ghost is kept out of the room.
    expect(c.received.slice(back).some((m) => m.type === "agent_presence" && m.agentId === "guest2" && !m.present)).toBe(true);
    await c.waitFor(() => Object.keys(guestsOf(c)).length === 1);
    expect(guestsOf(c)).toEqual({ guest5: "Rhea:reviewer" });
    expect(floor(c).tileOf("guest2")).toEqual(door(c));
    expect(floor(c).tileOf("guest5")).toEqual(spot(c, "guest5"));
  });

  it("gives the desk to the next member of the role when the holder is let go, and empties that member's spot", async () => {
    const e = engineWithHr({ team: [...DEFAULT_TEAM(), secondQa] });
    const c = await connect(e.link);
    c.send({ type: "go_to", roomId: "project:alpha" });
    await c.waitFor(() => c.count("welcome") === 2);
    await c.waitFor(() => Object.keys(guestsOf(c)).length === 1);
    expect(guestsOf(c)).toEqual({ guest3: "Wren:qa" });
    expect(lastView(c)!.members.find((m) => m.agentId === "qa")?.name).toBe("QA");

    c.send({ type: "go_to", roomId: "hr" });
    await c.waitFor(() => c.count("welcome") === 3);
    c.send({ type: "hr_do", act: { action: "fire", projectId: "alpha", memberId: "qa" } });
    await c.waitFor(() => c.count("hr") === 1);
    c.send({ type: "go_to", roomId: "project:alpha" });
    await c.waitFor(() => c.count("welcome") === 4);
    await c.waitFor(() => lastView(c)?.members.find((m) => m.agentId === "qa")?.name === "Wren" && (lastView(c)?.guests ?? []).length === 0);
    await c.waitFor(() => JSON.stringify(floor(c).tileOf("qa")) === JSON.stringify(spot(c, "qa")));
    expect(floor(c).tileOf("guest3")).toEqual(door(c));
  });

  it("walks a newly hired member in while the user is on the floor", async () => {
    const e = engineWithHr();
    const c = await connect(e.link);
    c.send({ type: "go_to", roomId: "project:alpha" });
    await c.waitFor(() => c.count("welcome") === 2);
    await c.waitFor(() => views(c).length > 0);
    expect(lastView(c)!.guests).toEqual([]);
    // The hire is made in the HR office; the floor learns of it when the user comes back.
    c.send({ type: "go_to", roomId: "hr" });
    await c.waitFor(() => c.count("welcome") === 3);
    c.send({ type: "hr_do", act: { action: "hire", projectId: "alpha", templateId: "night-intern", displayName: "Nox", model: "auto" } });
    await c.waitFor(() => c.count("hr") === 1);
    c.send({ type: "go_to", roomId: "project:alpha" });
    await c.waitFor(() => c.count("welcome") === 4);
    await c.waitFor(() => guestsOf(c)["guest6"] === "Nox:researcher");
    expect(lastView(c)!.guests![0]).toMatchObject({ guestId: "guest6", name: "Nox", role: "researcher", model: "auto" });
  });
});
