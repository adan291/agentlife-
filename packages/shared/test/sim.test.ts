import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  AGENT_IDS,
  FURNI_CATALOG,
  WorldSim,
  buildPathGrid,
  isSeatDef,
  isWalkable,
  resolveAnchor,
  seatTile,
  validateRoom,
} from "../src/index.ts";
import type { AgentEvent, ClientMsg, ServerMsg } from "../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const room = validateRoom(
  JSON.parse(readFileSync(join(here, "..", "..", "world-server", "rooms", "office.json"), "utf8")),
);
const grid = buildPathGrid(room);

function makeSim() {
  let t = 1_000_000;
  const sim = new WorldSim(room, () => t, { msPerTile: 100 });
  return { sim, advance: (ms: number) => (t += ms), now: () => t };
}

let seq = 0;
const base = () => ({ seq: seq++, ts: 0, taskId: "t1" });

describe("WorldSim", () => {
  it("joins at the door and snapshots user plus four agents at home", () => {
    const { sim } = makeSim();
    const { you, welcome } = sim.join();
    expect(welcome.type).toBe("welcome");
    expect(welcome.you).toBe(you);
    expect(welcome.avatars).toHaveLength(5);
    const me = welcome.avatars.find((a) => a.id === you)!;
    expect({ x: me.x, y: me.y }).toEqual({ x: room.door.x, y: room.door.y });
    expect(welcome.agents.map((a) => a.agentId)).toEqual([...AGENT_IDS]);
    for (const agent of AGENT_IDS) {
      const home = resolveAnchor(room, "home", agent)!;
      const a = welcome.avatars.find((x) => x.id === agent)!;
      expect({ x: a.x, y: a.y }).toEqual({ x: home.x, y: home.y });
    }
  });

  it("move produces a walk and the avatar arrives by the clock", () => {
    const { sim, advance } = makeSim();
    const { you } = sim.join();
    const out = sim.handleIntent(you, { type: "move", x: 5, y: 8 });
    const walk = out.find((m) => m.type === "walk");
    expect(walk).toBeDefined();
    if (walk?.type !== "walk") throw new Error("no walk");
    expect(walk.path.at(-1)).toEqual({ x: 5, y: 8 });
    advance(walk.path.length * 100 - 1);
    expect(sim.tileOf(you)).not.toEqual({ x: 5, y: 8 });
    advance(1);
    expect(sim.tileOf(you)).toEqual({ x: 5, y: 8 });
  });

  it("replies no_path for an unreachable or blocked target and does not move", () => {
    const { sim } = makeSim();
    const { you } = sim.join();
    for (const [x, y] of [[-3, 2], [0, 2], [50, 50]] as const) {
      const out = sim.handleIntent(you, { type: "move", x, y });
      expect(out).toEqual([expect.objectContaining({ type: "error", code: "no_path" })]);
    }
    expect(sim.tileOf(you)).toEqual({ x: room.door.x, y: room.door.y });
  });

  it("use walks to the use tile and defers open_panel until arrival", () => {
    const { sim, advance } = makeSim();
    const { you } = sim.join();
    const out = sim.handleIntent(you, { type: "use", itemId: "computer_desk_1" });
    expect(out.map((m) => m.type)).toEqual(["walk"]);
    expect(sim.dueMessages()).toEqual([]);
    expect(sim.nextDeferredAt()).not.toBeNull();
    advance(100 * 100);
    const due = sim.dueMessages();
    expect(due.map((m) => m.type)).toEqual(["face", "open_panel"]);
    expect(due[1]).toEqual({ type: "open_panel", panel: "computer" });
    expect(sim.dueMessages()).toEqual([]);
    expect(sim.nextDeferredAt()).toBeNull();
  });

  it("a new move cancels the pending panel", () => {
    const { sim, advance } = makeSim();
    const { you } = sim.join();
    sim.handleIntent(you, { type: "use", itemId: "mailbox_1" });
    sim.handleIntent(you, { type: "move", x: 2, y: 8 });
    advance(100 * 100);
    expect(sim.dueMessages().some((m) => m.type === "open_panel")).toBe(false);
  });

  it("use on decorative furniture only walks; unknown item is bad_message", () => {
    const { sim, advance } = makeSim();
    const { you } = sim.join();
    sim.handleIntent(you, { type: "use", itemId: "plant_2" });
    advance(100 * 100);
    expect(sim.dueMessages().some((m) => m.type === "open_panel")).toBe(false);
    expect(sim.handleIntent(you, { type: "use", itemId: "nope" })).toEqual([
      expect.objectContaining({ type: "error", code: "bad_message" }),
    ]);
  });

  it("agent events become walk, agent_state and say", () => {
    const { sim, advance } = makeSim();
    sim.join();
    const walk = sim.handleAgentEvent({ ...base(), type: "agent.goto", agentId: "developer", anchor: "desk" });
    expect(walk[0]).toMatchObject({ type: "walk", id: "developer" });
    advance(100 * 100);
    expect(sim.dueMessages()).toEqual([{ type: "face", id: "developer", dir: 6 }]);
    expect(sim.tileOf("developer")).toEqual({ x: 1, y: 5 });

    expect(
      sim.handleAgentEvent({ ...base(), type: "agent.state_changed", agentId: "qa", state: "thinking", text: "hm" }),
    ).toEqual([{ type: "agent_state", agentId: "qa", state: "thinking", text: "hm" }]);
    expect(sim.handleAgentEvent({ ...base(), type: "agent.say", agentId: "qa", text: "boo" })).toEqual([
      { type: "say", id: "qa", text: "boo" },
    ]);
    const snap = sim.snapshot();
    expect(snap.agents.find((a) => a.agentId === "qa")).toMatchObject({ state: "thinking", text: "hm" });
    expect(sim.handleAgentEvent({ ...base(), type: "task.completed" })).toEqual([]);
  });

  it("builder crew events walk the Builder to its desk and back home", () => {
    const { sim, advance } = makeSim();
    sim.join();
    const desk = resolveAnchor(room, "desk", "builder")!;
    const home = resolveAnchor(room, "home", "builder")!;
    expect(sim.tileOf("builder")).toEqual({ x: home.x, y: home.y });

    const to = sim.handleAgentEvent({ ...base(), taskId: "build:S9", type: "agent.goto", agentId: "builder", anchor: "desk" });
    expect(to[0]).toMatchObject({ type: "walk", id: "builder" });
    advance(100 * 100);
    sim.dueMessages();
    expect(sim.tileOf("builder")).toEqual({ x: desk.x, y: desk.y });
    expect(
      sim.handleAgentEvent({ ...base(), taskId: "build:S9", type: "agent.state_changed", agentId: "builder", state: "working", text: "S9" }),
    ).toEqual([{ type: "agent_state", agentId: "builder", state: "working", text: "S9" }]);

    const back = sim.handleAgentEvent({ ...base(), taskId: "build:S9", type: "agent.goto", agentId: "builder", anchor: "home" });
    expect(back[0]).toMatchObject({ type: "walk", id: "builder" });
    advance(100 * 100);
    sim.dueMessages();
    expect(sim.tileOf("builder")).toEqual({ x: home.x, y: home.y });
  });

  it("property: every avatar always stands on a walkable tile", () => {
    const itemIds = [...room.furni.map((f) => f.itemId), "missing"];
    const anchors = ["desk", "board", "computer", "mailbox", "door", "home"] as const;
    const step = fc.oneof(
      fc.record({ k: fc.constant("move" as const), x: fc.integer({ min: -3, max: 15 }), y: fc.integer({ min: -3, max: 12 }) }),
      fc.record({ k: fc.constant("use" as const), item: fc.constantFrom(...itemIds) }),
      fc.record({ k: fc.constant("goto" as const), agent: fc.constantFrom(...AGENT_IDS), anchor: fc.constantFrom(...anchors) }),
      fc.record({ k: fc.constant("state" as const), agent: fc.constantFrom(...AGENT_IDS) }),
      fc.record({ k: fc.constant("wait" as const), ms: fc.integer({ min: 0, max: 700 }) }),
    );
    fc.assert(
      fc.property(fc.array(step, { maxLength: 40 }), (steps) => {
        const { sim, advance } = makeSim();
        const { you } = sim.join();
        // The seat of a sofa is solid: a sitting avatar stands on it, and a walk to a seat ends on it.
        const seats = new Set(room.furni.flatMap((p) => (isSeatDef(FURNI_CATALOG[p.defId]) ? [seatTile(p, FURNI_CATALOG[p.defId]!)] : [])).map((t) => `${t.x},${t.y}`));
        const standable = (x: number, y: number): boolean => isWalkable(grid, x, y) || seats.has(`${x},${y}`);
        const check = () => {
          for (const a of sim.snapshot().avatars) {
            expect(standable(a.x, a.y), `${String(a.id)} at ${a.x},${a.y}`).toBe(true);
          }
        };
        for (const s of steps) {
          let out: ServerMsg[] = [];
          if (s.k === "move") out = sim.handleIntent(you, { type: "move", x: s.x, y: s.y } satisfies ClientMsg);
          else if (s.k === "use") out = sim.handleIntent(you, { type: "use", itemId: s.item });
          else if (s.k === "goto") {
            const ev: AgentEvent = { ...base(), type: "agent.goto", agentId: s.agent, anchor: s.anchor };
            out = sim.handleAgentEvent(ev);
          } else if (s.k === "state") {
            out = sim.handleAgentEvent({ ...base(), type: "agent.state_changed", agentId: s.agent, state: "working" });
          } else advance(s.ms);
          for (const m of out) {
            if (m.type === "walk") for (const t of m.path) expect(standable(t.x, t.y)).toBe(true);
          }
          sim.dueMessages();
          check();
        }
      }),
      { numRuns: 200 },
    );
  });
});
