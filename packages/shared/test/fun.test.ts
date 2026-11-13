import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ClientMsgSchema,
  FURNI_CATALOG,
  GRANT_LABELS,
  GRANT_REASONS,
  MOODS,
  MOOD_BUSY_MS,
  MOOD_TIRED_MS,
  SEAT_DEFS,
  SHOP_INTERACTIONS,
  ServerMsgSchema,
  WISPS_PER_DAY,
  WISPS_PER_JOB,
  WISP_LIFE_MS,
  WISP_MAX_MS,
  WISP_MIN_MS,
  WISP_REWARD,
  WorldSim,
  checkCatalogue,
  grantText,
  isSeatDef,
  moodLine,
  moodOf,
  nextWispRef,
  seatTile,
  useTile,
  validateRoom,
  wispRef,
  wispsToday,
} from "../src/index.ts";
import type { PlacedFurni, ServerMsg } from "../src/index.ts";
import fc from "fast-check";

const here = dirname(fileURLToPath(import.meta.url));
const room = validateRoom(JSON.parse(readFileSync(join(here, "..", "..", "world-server", "rooms", "office.json"), "utf8")));

describe("wisp rules", () => {
  it("keeps the numbers of the spec: 1 Ecto, 8 s, every 20 to 60 s, 10 per job, 50 per day", () => {
    expect(WISP_REWARD).toBe(1);
    expect(WISP_LIFE_MS).toBe(8000);
    expect(WISP_MIN_MS).toBe(20_000);
    expect(WISP_MAX_MS).toBe(60_000);
    expect(WISPS_PER_JOB).toBe(10);
    expect(WISPS_PER_DAY).toBe(50);
  });

  it("is a grant reason with its own toast text", () => {
    expect(GRANT_REASONS).toContain("wisp_caught");
    expect(GRANT_LABELS.wisp_caught).toBe("wisp caught");
    expect(grantText(1, "wisp_caught")).toBe("+1 Ecto: wisp caught");
  });

  it("numbers the catches of a job from 1 and runs out after ten", () => {
    const paid = new Set<string>();
    for (let n = 1; n <= WISPS_PER_JOB; n++) {
      const ref = nextWispRef("task-1", (r) => paid.has(r));
      expect(ref).toBe(wispRef("task-1", n));
      paid.add(ref!);
    }
    expect(nextWispRef("task-1", (r) => paid.has(r))).toBeUndefined();
    // Another job starts again at 1.
    expect(nextWispRef("task-2", (r) => paid.has(r))).toBe("task-2.1");
  });

  it("counts only the wisp entries of the same local day", () => {
    const now = new Date(2026, 10, 13, 15, 0, 0).getTime();
    const yesterday = new Date(2026, 10, 12, 23, 59, 0).getTime();
    const ledger = [
      { ts: yesterday, reason: "wisp_caught" },
      { ts: now - 1000, reason: "wisp_caught" },
      { ts: now - 2000, reason: "wisp_caught" },
      { ts: now - 3000, reason: "job_passed" },
      { ts: now - 4000, reason: "purchase" },
    ];
    expect(wispsToday(ledger, now)).toBe(2);
    expect(wispsToday([], now)).toBe(0);
  });
});

describe("wisp messages", () => {
  it("accepts the catch and the two server messages, and nothing sloppy", () => {
    expect(ClientMsgSchema.safeParse({ type: "wisp_catch", wispId: "wisp-3" }).success).toBe(true);
    expect(ClientMsgSchema.safeParse({ type: "wisp_catch", wispId: "a b" }).success).toBe(false);
    expect(ClientMsgSchema.safeParse({ type: "wisp_catch" }).success).toBe(false);
    expect(ServerMsgSchema.safeParse({ type: "wisp", wispId: "wisp-3", x: 2, y: 4, ttlMs: 8000 }).success).toBe(true);
    expect(ServerMsgSchema.safeParse({ type: "wisp", wispId: "wisp-3", x: 2, y: 4, ttlMs: 0 }).success).toBe(false);
    expect(ServerMsgSchema.safeParse({ type: "wisp_gone", wispId: "wisp-3", caught: false }).success).toBe(true);
    expect(ServerMsgSchema.safeParse({ type: "wisp_gone", wispId: "wisp-3" }).success).toBe(false);
  });
});

describe("free tiles of a room", () => {
  it("lists floor tiles without furniture, people and the door, and follows the user", () => {
    let t = 1_000_000;
    const sim = new WorldSim(room, () => t, { msPerTile: 100 });
    const { you } = sim.join();
    const free = sim.freeTiles();
    expect(free.length).toBeGreaterThan(10);
    const key = (p: { x: number; y: number }) => `${p.x},${p.y}`;
    const keys = new Set(free.map(key));
    expect(keys.size).toBe(free.length);
    expect(keys.has(key(room.door))).toBe(false);
    // A tile the user walks to is not free until the user stands elsewhere.
    const target = free.find((p) => sim.handleIntent(you, { type: "move", x: p.x, y: p.y }).some((m) => m.type === "walk"))!;
    expect(sim.freeTiles().some((p) => key(p) === key(target))).toBe(false);
    t += 60_000;
    expect(sim.freeTiles().some((p) => key(p) === key(target))).toBe(false);
  });
});

// ---- task 2: seats, emotes, mood, the coffee machine ----

function makeSim() {
  let t = 1_000_000;
  const sim = new WorldSim(room, () => t, { msPerTile: 100 });
  /** Moves the clock and returns the messages that came due. */
  const advance = (ms: number): ServerMsg[] => {
    t += ms;
    return sim.dueMessages();
  };
  return { sim, advance };
}
const walkOf = (msgs: ServerMsg[]) => msgs.find((m): m is Extract<ServerMsg, { type: "walk" }> => m.type === "walk");
const SOFA = { x: 6, y: 9 };
const SOFA_USE = { x: 6, y: 8 };

describe("seats", () => {
  it("are the pieces that people sit on, and the seat is the footprint tile next to the tile in front", () => {
    expect([...SEAT_DEFS].sort()).toEqual(["armchair", "beanbag", "bench", "chair", "sofa", "throne"]);
    for (const id of SEAT_DEFS) expect(FURNI_CATALOG[id], id).toBeDefined();
    expect(isSeatDef(FURNI_CATALOG["sofa"])).toBe(true);
    expect(isSeatDef(FURNI_CATALOG["plant"])).toBe(false);
    expect(isSeatDef(undefined)).toBe(false);
    // The seat is always next to the use tile, whatever the facing and the size of the piece.
    for (const id of SEAT_DEFS) {
      for (const dir of [0, 2, 4, 6] as const) {
        const p: PlacedFurni = { itemId: "x", defId: id, x: 4, y: 4, dir };
        const seat = seatTile(p, FURNI_CATALOG[id]!);
        const use = useTile(p);
        expect(Math.abs(seat.x - use.x) + Math.abs(seat.y - use.y), `${id} ${dir}`).toBe(1);
      }
    }
  });

  it("clicking a sofa walks to the front of it, steps onto it and sits facing the way it faces", () => {
    const { sim, advance } = makeSim();
    const { you } = sim.join();
    const out = sim.handleIntent(you, { type: "use", itemId: "sofa_1" });
    const walk = walkOf(out)!;
    expect(walk.path.at(-1)).toEqual(SOFA);
    expect(walk.path.at(-2)).toEqual(SOFA_USE);
    expect(out.some((m) => m.type === "sit")).toBe(false);
    expect(advance(walk.path.length * 100 - 1).some((m) => m.type === "sit")).toBe(false);
    expect(advance(1)).toContainEqual({ type: "sit", id: you, sitting: true, dir: 0, itemId: "sofa_1" });
    expect(sim.tileOf(you)).toEqual(SOFA);
    // Nobody can be put on the seat of a sitter.
    expect(sim.freeTiles().some((p) => p.x === SOFA.x && p.y === SOFA.y)).toBe(false);
  });

  it("refuses a seat that somebody sits on, and the avatar stays where it was", () => {
    const { sim, advance } = makeSim();
    const { you } = sim.join();
    // The Builder takes the sofa first.
    const builder = sim.sit("builder", "sofa_1");
    expect(walkOf(builder)).toBeDefined();
    advance(10_000);
    expect(sim.tileOf("builder")).toEqual(SOFA);
    const out = sim.handleIntent(you, { type: "use", itemId: "sofa_1" });
    expect(out).toEqual([{ type: "error", code: "seat_taken", message: "Somebody is sitting there." }]);
    expect(sim.tileOf(you)).toEqual({ x: room.door.x, y: room.door.y });
    // The seat is taken from the moment the walk is ordered, not only on arrival.
    const other = makeSim();
    const second = other.sim.join().you;
    other.sim.sit("builder", "sofa_1");
    expect(other.sim.handleIntent(second, { type: "use", itemId: "sofa_1" })).toEqual([expect.objectContaining({ type: "error", code: "seat_taken" })]);
  });

  it("is let go when the sitter gets up, by a new walk, by using the seat again or by leaving the room", () => {
    const { sim, advance } = makeSim();
    const { you } = sim.join();
    const sit = () => {
      const w = walkOf(sim.handleIntent(you, { type: "use", itemId: "sofa_1" }))!;
      advance(w.path.length * 100);
    };
    sit();
    // A new walk first says the avatar got up, then starts at the tile in front of the sofa.
    const away = sim.handleIntent(you, { type: "move", x: 5, y: 8 });
    expect(away[0]).toEqual({ type: "sit", id: you, sitting: false });
    expect(walkOf(away)!.path[0]).toEqual(SOFA_USE);
    advance(10_000);
    expect(sim.tileOf(you)).toEqual({ x: 5, y: 8 });
    expect(sim.sit("builder", "sofa_1").some((m) => m.type === "error")).toBe(false);
    advance(10_000);
    // The Builder gets off by walking elsewhere, then the user sits again, and uses the sofa a second time to get up.
    sim.handleAgentEvent({ type: "agent.goto", seq: 0, ts: 0, taskId: "t1", agentId: "builder", anchor: "desk" });
    advance(10_000);
    sit();
    expect(sim.tileOf(you)).toEqual(SOFA);
    const up = sim.handleIntent(you, { type: "use", itemId: "sofa_1" });
    expect(up[0]).toEqual({ type: "sit", id: you, sitting: false });
    expect(walkOf(up)!.path).toEqual([SOFA_USE]);
    advance(10_000);
    expect(sim.tileOf(you)).toEqual(SOFA_USE);
    // Leaving the room lets go of the seat as well.
    sit();
    sim.leave();
    sim.join();
    expect(sim.sit("builder", "sofa_1").some((m) => m.type === "error")).toBe(false);
  });

  it("is let go when the walk to it is cancelled by another walk", () => {
    const { sim } = makeSim();
    const { you } = sim.join();
    sim.handleIntent(you, { type: "use", itemId: "sofa_1" });
    sim.handleIntent(you, { type: "move", x: 2, y: 8 });
    expect(sim.sit("builder", "sofa_1").some((m) => m.type === "error")).toBe(false);
  });

  it("is dropped when the piece moves away: the sitter simply stands where it is", () => {
    const { sim, advance } = makeSim();
    const { you } = sim.join();
    advance(walkOf(sim.handleIntent(you, { type: "use", itemId: "sofa_1" }))!.path.length * 100);
    const moved = { ...room, furni: room.furni.map((p) => (p.itemId === "sofa_1" ? { ...p, x: 2, y: 9 } : p)) };
    sim.updateRoom(moved);
    const out = sim.handleIntent(you, { type: "move", x: 5, y: 8 });
    expect(out.some((m) => m.type === "sit")).toBe(false);
    expect(walkOf(out)!.path[0]).not.toEqual(SOFA_USE);
    expect(sim.sit("builder", "sofa_1").some((m) => m.type === "error")).toBe(false);
  });

  it("key 4 sits on the nearest free seat, gets up again, and says so when every seat is taken", () => {
    const { sim, advance } = makeSim();
    const { you } = sim.join();
    const seats = room.furni.filter((p) => isSeatDef(FURNI_CATALOG[p.defId]));
    const seatTiles = seats.map((p) => seatTile(p, FURNI_CATALOG[p.defId]!));
    const out = sim.handleIntent(you, { type: "sit_toggle" });
    const walk = walkOf(out)!;
    expect(seatTiles).toContainEqual(walk.path.at(-1));
    advance(walk.path.length * 100);
    expect(sim.tileOf(you)).toEqual(walk.path.at(-1));
    const up = sim.handleIntent(you, { type: "sit_toggle" });
    expect(up[0]).toEqual({ type: "sit", id: you, sitting: false });
    advance(10_000);

    // With every seat taken there is nothing to sit on.
    const full = makeSim();
    const me = full.sim.join().you;
    const sitters = ["architect", "developer", "qa", "builder"] as const;
    seats.forEach((p, i) => full.sim.sit(sitters[i]!, p.itemId));
    expect(seats.length).toBeLessThanOrEqual(sitters.length);
    expect(full.sim.handleIntent(me, { type: "sit_toggle" })).toEqual([{ type: "error", code: "seat_taken", message: "There is no free seat here." }]);
  });
});

describe("emotes", () => {
  it("are sent back for the user's own avatar, and a seated avatar does not dance", () => {
    const { sim, advance } = makeSim();
    const { you } = sim.join();
    for (const emote of ["wave", "dance", "cheer"] as const) {
      expect(sim.handleIntent(you, { type: "emote", emote })).toEqual([{ type: "emote", id: you, emote }]);
    }
    advance(walkOf(sim.handleIntent(you, { type: "use", itemId: "sofa_1" }))!.path.length * 100);
    expect(sim.handleIntent(you, { type: "emote", emote: "dance" })).toEqual([]);
    expect(sim.handleIntent(you, { type: "emote", emote: "wave" })).toEqual([{ type: "emote", id: you, emote: "wave" }]);
  });

  it("have messages that are checked: only the user's three can be asked for, and glum can be shown", () => {
    expect(ClientMsgSchema.safeParse({ type: "emote", emote: "wave" }).success).toBe(true);
    expect(ClientMsgSchema.safeParse({ type: "emote", emote: "glum" }).success).toBe(false);
    expect(ClientMsgSchema.safeParse({ type: "emote", emote: "backflip" }).success).toBe(false);
    expect(ClientMsgSchema.safeParse({ type: "sit_toggle" }).success).toBe(true);
    expect(ServerMsgSchema.safeParse({ type: "emote", id: "developer", emote: "glum" }).success).toBe(true);
    expect(ServerMsgSchema.safeParse({ type: "emote", id: 1, emote: "dance" }).success).toBe(true);
    expect(ServerMsgSchema.safeParse({ type: "sit", id: 1, sitting: true, dir: 0 }).success).toBe(true);
    expect(ServerMsgSchema.safeParse({ type: "sit", id: 1, sitting: false }).success).toBe(true);
    expect(ServerMsgSchema.safeParse({ type: "sit", id: 1, sitting: true, dir: 9 }).success).toBe(false);
    expect(ServerMsgSchema.safeParse({ type: "error", code: "seat_taken", message: "x" }).success).toBe(true);
  });
});

describe("mood", () => {
  it("is rested, busy, then tired as the work of the day grows, and the lines never claim an effect on work", () => {
    expect(moodOf(0)).toBe("rested");
    expect(moodOf(MOOD_BUSY_MS - 1)).toBe("rested");
    expect(moodOf(MOOD_BUSY_MS)).toBe("busy");
    expect(moodOf(MOOD_TIRED_MS - 1)).toBe("busy");
    expect(moodOf(MOOD_TIRED_MS)).toBe("tired");
    for (const mood of MOODS) expect(moodLine(mood)).toMatch(/^Mood: \w+\. Only for show: it never changes a job, a model or a permission\.$/);
  });

  it("property: more work is never a better mood", () => {
    const rank = { rested: 0, busy: 1, tired: 2 } as const;
    fc.assert(
      fc.property(fc.nat(10_000_000), fc.nat(10_000_000), (a, b) => {
        const [low, high] = a <= b ? [a, b] : [b, a];
        expect(rank[moodOf(high)]).toBeGreaterThanOrEqual(rank[moodOf(low)]);
      }),
    );
  });

  it("is told to the client with the room it belongs to", () => {
    expect(ServerMsgSchema.safeParse({ type: "mood", roomId: "project:alpha", moods: { architect: "rested", developer: "busy", qa: "tired" } }).success).toBe(true);
    expect(ServerMsgSchema.safeParse({ type: "mood", roomId: "project:alpha", moods: { developer: "furious" } }).success).toBe(false);
  });
});

describe("the coffee machine", () => {
  const coffee = (id = "coffee_machine") => ({ id, name: "Coffee machine", page: "tables" as const, price: 40, defId: "coffee_machine" });
  const SOLD_PLAIN = ["armchair", "bench", "beanbag", "throne", "side_table", "coffee_table", "round_table", "potion_bar", "candelabra", "floor_torch", "lava_lamp", "crystal_ball", "fern", "palm", "cactus", "bonsai", "gravestone", "coffin", "cauldron", "skeleton", "rune_rug", "wall_clock", "moon_poster", "tall_mirror", "banner"];
  const plain = SOLD_PLAIN.map((id) => ({ id, name: id, page: "tables" as const, price: 10, defId: id }));

  it("is an interactive piece with a hint, and the only interaction a shop item may have", () => {
    const def = FURNI_CATALOG["coffee_machine"]!;
    expect(def.interaction).toBe("coffee");
    expect(def.hint).toBe("Serve coffee to a tired agent");
    expect(SHOP_INTERACTIONS).toEqual(["coffee"]);
  });

  it("is accepted in the catalogue, while every other piece with an interaction is still refused", () => {
    expect(checkCatalogue([...plain, coffee()])).toEqual([]);
    for (const defId of ["mailbox", "computer_desk", "shop_counter", "elevator", "agent_desk"]) {
      const problems = checkCatalogue([...plain, { id: "x", name: "x", page: "tables" as const, price: 10, defId }]);
      expect(problems.join(), defId).toMatch(/template furniture/);
    }
  });

  it("makes the sim open the coffee panel on arrival, which the world-server answers by serving coffee", () => {
    const { sim, advance } = makeSim();
    const { you } = sim.join();
    const moved = { ...room, furni: [...room.furni, { itemId: "bought_1", defId: "coffee_machine", x: 2, y: 9, dir: 0 }] };
    sim.updateRoom(validateRoom(moved));
    const out = sim.handleIntent(you, { type: "use", itemId: "bought_1" });
    const walk = walkOf(out)!;
    expect(out.some((m) => m.type === "open_panel")).toBe(false);
    expect(advance(walk.path.length * 100)).toContainEqual({ type: "open_panel", panel: "coffee" });
  });
});
