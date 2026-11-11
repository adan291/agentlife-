import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  FURNI_CATALOG,
  Hotel,
  HR_ROOM,
  LOBBY_ROOM,
  ServerMsgSchema,
  buildPathGrid,
  findPath,
  projectIdOfRoom,
  projectRoomId,
  roomAgents,
  roomForProject,
  scopeAgentId,
  signText,
  splitAgentId,
  useTile,
  validateRoom,
} from "../src/index.ts";
import type { AgentEvent, RoomDef } from "../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const load = (file: string): RoomDef => validateRoom(JSON.parse(readFileSync(join(here, "..", "..", "world-server", "rooms", file), "utf8")));
const lobby = load("lobby.json");
const hr = load("hr.json");
const template = load("project-template.json");

function makeHotel(startRoom?: string) {
  let t = 1_000_000;
  const hotel = new Hotel({ lobby, hr, template, clock: () => t, ...(startRoom ? { startRoom: startRoom as never } : {}), sim: { msPerTile: 10 } });
  return { hotel, advance: (ms: number) => (t += ms) };
}

describe("room files", () => {
  it("the lobby, the HR office and the template validate and hold the right agents", () => {
    expect(roomAgents(lobby)).toEqual(["builder"]);
    expect(roomAgents(hr)).toEqual([]);
    expect(roomAgents(template)).toEqual(["architect", "developer", "qa"]);
  });

  it("the lobby has the Reception, the elevator, a door to the HR office and the directory board", () => {
    const interactions = lobby.furni.map((f) => FURNI_CATALOG[f.defId]?.interaction).filter(Boolean);
    expect(interactions).toEqual(expect.arrayContaining(["reception", "elevator", "directory", "door"]));
    expect(lobby.furni.find((f) => f.defId === "door")?.to).toBe(HR_ROOM);
    expect(template.furni.some((f) => f.defId === "reception_desk")).toBe(false);
  });

  it.each([
    ["lobby", lobby],
    ["hr", hr],
    ["template", template],
  ])("the %s door is the tile in front of its elevator and every use tile can be reached from it", (_name, room) => {
    const elevator = room.furni.find((f) => f.defId === "elevator")!;
    expect(useTile(elevator)).toEqual({ x: room.door.x, y: room.door.y });
    const grid = buildPathGrid(room);
    for (const f of room.furni) {
      if (!FURNI_CATALOG[f.defId]?.interaction) continue;
      expect(findPath(grid, room.door, useTile(f)), f.itemId).not.toBeNull();
    }
  });

  it("a door without a target room is invalid, and so is a target on other furniture", () => {
    const noTarget = { ...lobby, furni: lobby.furni.map((f) => (f.defId === "door" ? { itemId: f.itemId, defId: f.defId, x: f.x, y: f.y, dir: f.dir } : f)) };
    expect(() => validateRoom(noTarget)).toThrow(/needs a target room/);
    const stray = { ...lobby, furni: lobby.furni.map((f) => (f.defId === "lamp" ? { ...f, to: "hr" } : f)) };
    expect(() => validateRoom(stray)).toThrow(/only a door/);
  });

  it("rejects a desk of an agent who does not live in the room", () => {
    const bad = { ...template, anchors: [...template.anchors, { name: "desk", x: 10, y: 6, dir: 2, agent: "builder" }] };
    expect(() => validateRoom(bad)).toThrow(/does not live/);
  });
});

describe("roomForProject", () => {
  it("builds a valid project room for any project name, with a clean sign and reachable use tiles", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 120 }), fc.stringMatching(/^[a-z0-9][a-z0-9-]{0,40}$/), (name, id) => {
        const room = roomForProject(template, { id, name });
        expect(room.id).toBe(`project:${id}`);
        expect(room.kind).toBe("project");
        expect(room.name.length).toBeGreaterThanOrEqual(1);
        expect(room.name.length).toBeLessThanOrEqual(32);
        // eslint-disable-next-line no-control-regex
        expect(room.name).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
        expect(room.name).not.toMatch(/[A-Za-z]:[\\/]/);
        const grid = buildPathGrid(room);
        for (const f of room.furni) {
          if (FURNI_CATALOG[f.defId]?.interaction) expect(findPath(grid, room.door, useTile(f))).not.toBeNull();
        }
      }),
      { numRuns: 200 },
    );
  });

  it("cleans the sign text and falls back to the project id when nothing is left", () => {
    expect(signText("My   project\n\t", "x")).toBe("My project");
    expect(signText("C:\\Users\\me\\secret", "my-app")).toBe("my-app");
    expect(signText("x".repeat(100), "id")).toHaveLength(32);
    expect(roomForProject(template, { id: "todo", name: "Todo list" }).name).toBe("Todo list");
  });
});

describe("agent ids with a project scope", () => {
  it("splits a scoped id and leaves a plain id alone", () => {
    expect(splitAgentId(scopeAgentId("todo", "qa"))).toEqual({ projectId: "todo", agentId: "qa" });
    expect(splitAgentId("builder")).toEqual({ agentId: "builder" });
  });

  it("a project room moves only the agents of its own role set and ignores the others", () => {
    const { hotel } = makeHotel();
    hotel.addProject({ id: "todo", name: "Todo" });
    const sim = hotel.sim(projectRoomId("todo"))!;
    const ev = { seq: 1, ts: 1, taskId: "t", type: "agent.state_changed", agentId: "todo:architect", state: "thinking" } as AgentEvent;
    expect(sim.handleAgentEvent(ev)).toEqual([{ type: "agent_state", agentId: "architect", state: "thinking" }]);
    expect(sim.handleAgentEvent({ ...ev, agentId: "builder" } as AgentEvent)).toEqual([]);
    expect(hotel.sim(LOBBY_ROOM)!.handleAgentEvent({ ...ev, agentId: "architect" } as AgentEvent)).toEqual([]);
  });
});

describe("Hotel", () => {
  it("starts the user in the lobby at the elevator, and has a floor per project after the lobby and the HR office", () => {
    const { hotel } = makeHotel();
    hotel.addProject({ id: "todo", name: "Todo" });
    hotel.addProject({ id: "blog", name: "Blog" });
    expect(hotel.floors().map((f) => [f.roomId, f.kind])).toEqual([
      ["lobby", "lobby"],
      ["hr", "hr"],
      ["project:todo", "project"],
      ["project:blog", "project"],
    ]);
    const { you, welcome } = hotel.join();
    expect(welcome.roomId).toBe("lobby");
    expect(welcome.agents.map((a) => a.agentId)).toEqual(["builder"]);
    const me = welcome.avatars.find((a) => a.id === you)!;
    expect({ x: me.x, y: me.y }).toEqual({ x: lobby.door.x, y: lobby.door.y });
    expect(hotel.roomOf(you)).toBe("lobby");
    ServerMsgSchema.parse(welcome);
  });

  it("moves the user to another floor: the old room loses the avatar and the new welcome has it at the elevator", () => {
    const { hotel } = makeHotel();
    hotel.addProject({ id: "todo", name: "Todo" });
    const { you } = hotel.join();
    const welcome = hotel.moveUser(you, projectRoomId("todo"))!;
    expect(welcome.room.id).toBe("project:todo");
    expect(welcome.agents.map((a) => a.agentId)).toEqual(["architect", "developer", "qa"]);
    expect(welcome.avatars.map((a) => a.id).sort()).toEqual(["architect", "developer", "qa", you].sort());
    expect(hotel.sim(LOBBY_ROOM)!.snapshot().avatars.some((a) => a.id === you)).toBe(false);
    expect(hotel.roomOf(you)).toBe("project:todo");
    expect(hotel.moveUser(you, "project:nope")).toBeUndefined();
    expect(hotel.roomOf(you)).toBe("project:todo");
    const back = hotel.moveUser(you, LOBBY_ROOM)!;
    expect(back.avatars.some((a) => a.id === you)).toBe(true);
    expect(hotel.sim(projectRoomId("todo"))!.snapshot().avatars.some((a) => a.id === you)).toBe(false);
  });

  it("accepts the elevator only while the avatar stands in front of it", () => {
    const { hotel, advance } = makeHotel();
    const { you } = hotel.join();
    expect(hotel.atElevator(you)).toBe(true);
    const lobbySim = hotel.sim(LOBBY_ROOM)!;
    lobbySim.handleIntent(you, { type: "move", x: 6, y: 5 });
    advance(25);
    expect(hotel.atElevator(you)).toBe(false);
    advance(10_000);
    expect(hotel.atElevator(you)).toBe(false);
    lobbySim.handleIntent(you, { type: "use", itemId: "elevator_1" });
    advance(10_000);
    expect(hotel.atElevator(you)).toBe(true);
  });

  it("using the HR door asks the host to enter the target room after the walk", () => {
    const { hotel, advance } = makeHotel();
    const { you } = hotel.join();
    const sim = hotel.sim(LOBBY_ROOM)!;
    expect(sim.handleIntent(you, { type: "use", itemId: "door_hr" })[0]).toMatchObject({ type: "walk" });
    advance(10_000);
    expect(sim.dueMessages()).toContainEqual({ type: "open_panel", panel: "door", data: { to: "hr" } });
  });

  it("removing a project's floor moves the users inside to the lobby", () => {
    const { hotel } = makeHotel();
    hotel.addProject({ id: "todo", name: "Todo" });
    const { you } = hotel.join();
    hotel.moveUser(you, projectRoomId("todo"));
    const moved = hotel.removeProject("todo");
    expect(moved).toHaveLength(1);
    expect(moved[0]!.welcome.room.id).toBe("lobby");
    expect(hotel.has("project:todo")).toBe(false);
    expect(hotel.roomOf(you)).toBe("lobby");
    expect(hotel.removeProject("todo")).toEqual([]);
  });

  it("starts in the start room when it exists, and in the lobby when it does not", () => {
    const a = makeHotel("project:todo");
    expect(a.hotel.join().welcome.room.id).toBe("lobby");
    const b = makeHotel("project:todo");
    b.hotel.addProject({ id: "todo", name: "Todo" });
    expect(b.hotel.join().welcome.room.id).toBe("project:todo");
  });

  it("a second join replaces the first user", () => {
    const { hotel } = makeHotel();
    hotel.addProject({ id: "todo", name: "Todo" });
    const first = hotel.join();
    hotel.moveUser(first.you, projectRoomId("todo"));
    hotel.join();
    expect(hotel.sim(projectRoomId("todo"))!.snapshot().avatars.some((a) => a.id === first.you)).toBe(false);
    expect(hotel.roomOf(first.you)).toBe("lobby");
  });

  it("knows the project of a room id", () => {
    expect(projectIdOfRoom("project:todo")).toBe("todo");
    expect(projectIdOfRoom("lobby")).toBeUndefined();
  });
});
