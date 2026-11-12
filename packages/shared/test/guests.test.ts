import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  FURNI_CATALOG,
  GUEST_IDS,
  RoomValidationError,
  ServerMsgSchema,
  WorldSim,
  buildPathGrid,
  isGuestId,
  resolveAnchor,
  roomForProject,
  roomGuests,
  useTile,
  validateRoom,
} from "../src/index.ts";
import type { RoomDef, ServerMsg } from "../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const load = (file: string): RoomDef => validateRoom(JSON.parse(readFileSync(join(here, "..", "..", "world-server", "rooms", file), "utf8")));
const template = load("project-template.json");
const floor = roomForProject(template, { id: "todo", name: "Todo" });

describe("standing spots of a project floor (hr-desk 4.3: everybody hired is on the floor)", () => {
  it("only project floors have spots, one per guest id", () => {
    expect(roomGuests(floor)).toEqual(GUEST_IDS);
    expect(roomGuests(load("lobby.json"))).toEqual([]);
    expect(roomGuests(load("hr.json"))).toEqual([]);
    expect(GUEST_IDS.every(isGuestId)).toBe(true);
    expect(isGuestId("architect")).toBe(false);
    expect(isGuestId(1)).toBe(false);
  });

  it("every spot is a free standing tile of its own, apart from desks, homes and the places furniture is used from", () => {
    const grid = buildPathGrid(floor);
    const taken = new Set<string>();
    const key = (t: { x: number; y: number }) => `${t.x},${t.y}`;
    for (const a of floor.anchors) if (!isGuestId(a.name.replace("home_", ""))) taken.add(key(a));
    for (const p of floor.furni) if (FURNI_CATALOG[p.defId]?.interaction) taken.add(key(useTile(p)));
    taken.add(key(floor.door));
    const spots = new Set<string>();
    for (const g of GUEST_IDS) {
      const a = resolveAnchor(floor, "home", g);
      expect(a, g).toBeDefined();
      expect(grid.height(a!.x, a!.y), `${g} is on the floor`).not.toBeNull();
      expect(grid.blocked?.(a!.x, a!.y) ?? false, `${g} is not under furniture`).toBe(false);
      expect(taken.has(key(a!)), `${g} does not stand where something else is used`).toBe(false);
      spots.add(key(a!));
    }
    expect(spots.size).toBe(GUEST_IDS.length);
  });

  it("a floor missing a spot is refused", () => {
    const missing = { ...template, anchors: template.anchors.filter((a) => a.name !== "home_guest4") };
    expect(() => validateRoom(missing)).toThrow(RoomValidationError);
    expect(() => validateRoom(missing)).toThrow(/home_guest4/);
  });

  it("the lobby and the HR office need no spots", () => {
    expect(() => validateRoom(load("lobby.json"))).not.toThrow();
    expect(() => validateRoom(load("hr.json"))).not.toThrow();
  });
});

describe("guests in the simulation", () => {
  const sim = () => {
    let now = 1_000;
    return { sim: new WorldSim(floor, () => now), advance: (ms: number) => (now += ms) };
  };

  it("are avatars at the elevator, not agents: no state, not in the welcome's agent list", () => {
    const { sim: s } = sim();
    const { welcome } = s.join();
    expect(welcome.agents.map((a) => a.agentId)).toEqual(["architect", "developer", "qa"]);
    expect(s.agents()).toEqual(["architect", "developer", "qa"]);
    const door = { x: floor.door.x, y: floor.door.y };
    for (const g of GUEST_IDS) {
      const a = welcome.avatars.find((x) => x.id === g)!;
      expect(a, g).toBeDefined();
      expect({ x: a.x, y: a.y }).toEqual(door);
    }
  });

  it("walk from the elevator to their spot, and back to the elevator when let go", () => {
    const { sim: s, advance } = sim();
    s.join();
    for (const g of GUEST_IDS) {
      const home = resolveAnchor(floor, "home", g)!;
      const walk = s.sendAgentTo(g, "home").find((m): m is Extract<ServerMsg, { type: "walk" }> => m.type === "walk");
      expect(walk, `${g} walks in`).toBeDefined();
      expect(walk!.id).toBe(g);
      expect(walk!.path.at(-1)).toEqual({ x: home.x, y: home.y });
      advance(walk!.path.length * walk!.msPerTile + 10);
      expect(s.tileOf(g)).toEqual({ x: home.x, y: home.y });
      const out = s.sendAgentTo(g, "door").find((m) => m.type === "walk");
      expect(out, `${g} walks out`).toBeDefined();
      advance(1_000_000);
      expect(s.tileOf(g)).toEqual({ x: floor.door.x, y: floor.door.y });
    }
  });

  it("an event for a guest id does nothing (guests have no agent state)", () => {
    const { sim: s } = sim();
    s.join();
    expect(s.handleAgentEvent({ type: "agent.say", taskId: "t", ts: 1, agentId: "guest1", text: "hi" } as never)).toEqual([]);
  });
});

describe("protocol messages about guests", () => {
  it("accepts a walk, a presence change and a team view that name guests", () => {
    for (const msg of [
      { type: "walk", id: "guest3", path: [{ x: 1, y: 1 }], msPerTile: 400, startedAt: 1 },
      { type: "face", id: "guest3", dir: 2 },
      { type: "agent_presence", agentId: "guest2", present: false },
      {
        type: "team_view",
        roomId: "project:todo",
        members: [{ agentId: "qa", name: "Vera" }],
        guests: [{ guestId: "guest6", name: "Nox", role: "researcher", model: "qwen3.5:4b" }],
      },
    ]) {
      expect(ServerMsgSchema.safeParse(msg).success, JSON.stringify(msg)).toBe(true);
    }
  });

  it("refuses an unknown spot, a seventh guest and a role nobody has", () => {
    for (const msg of [
      { type: "agent_presence", agentId: "guest7", present: true },
      { type: "walk", id: "guest0", path: [], msPerTile: 400, startedAt: 1 },
      { type: "team_view", roomId: "project:todo", members: [], guests: [{ guestId: "guest1", name: "X", role: "janitor" }] },
      {
        type: "team_view",
        roomId: "project:todo",
        members: [],
        guests: GUEST_IDS.concat("guest1").map((guestId) => ({ guestId, name: "X", role: "qa" })),
      },
    ]) {
      expect(ServerMsgSchema.safeParse(msg).success, JSON.stringify(msg)).toBe(false);
    }
  });
});
