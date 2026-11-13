import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ClientMsgSchema,
  GRANT_LABELS,
  GRANT_REASONS,
  ServerMsgSchema,
  WISPS_PER_DAY,
  WISPS_PER_JOB,
  WISP_LIFE_MS,
  WISP_MAX_MS,
  WISP_MIN_MS,
  WISP_REWARD,
  WorldSim,
  grantText,
  nextWispRef,
  validateRoom,
  wispRef,
  wispsToday,
} from "../src/index.ts";

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
