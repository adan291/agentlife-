import { describe, expect, it } from "vitest";
import {
  FURNI_CATALOG,
  RoomValidationError,
  buildPathGrid,
  resolveAnchor,
  useTile,
  validateRoom,
} from "../src/index.ts";

function baseRoom() {
  return {
    id: "t",
    name: "Test",
    heightmap: Array.from({ length: 6 }, () => "000000"),
    door: { name: "door", x: 0, y: 5, dir: 2 },
    anchors: [
      { name: "computer", x: 1, y: 1, dir: 0 },
      { name: "mailbox", x: 3, y: 1, dir: 0 },
      { name: "board", x: 4, y: 1, dir: 0 },
      { name: "desk", x: 1, y: 3, dir: 6, agent: "architect" },
      { name: "desk", x: 2, y: 3, dir: 6, agent: "developer" },
      { name: "desk", x: 3, y: 3, dir: 6, agent: "qa" },
      { name: "desk", x: 4, y: 3, dir: 6, agent: "builder" },
      { name: "home_architect", x: 1, y: 4, dir: 4 },
      { name: "home_developer", x: 2, y: 4, dir: 4 },
      { name: "home_qa", x: 3, y: 4, dir: 4 },
      { name: "home_builder", x: 4, y: 4, dir: 4 },
    ],
    furni: [{ itemId: "pc", defId: "computer_desk", x: 1, y: 0, dir: 4 }],
  };
}

function paths(fn: () => unknown): string[] {
  try {
    fn();
  } catch (e) {
    if (e instanceof RoomValidationError) return e.issues.map((i) => i.path);
    throw e;
  }
  return [];
}

describe("catalog", () => {
  it("contains the required items", () => {
    for (const id of [
      "computer_desk",
      "mailbox",
      "board",
      "agent_desk",
      "chair",
      "plant",
      "lamp",
      "sofa",
      "jack_o_lantern_lamp",
      "cobweb",
    ]) {
      expect(FURNI_CATALOG[id]?.id).toBe(id);
    }
    expect(FURNI_CATALOG["computer_desk"]?.interaction).toBe("computer");
  });
});

describe("validateRoom", () => {
  it("accepts a valid room", () => {
    expect(validateRoom(baseRoom()).id).toBe("t");
  });

  it("rejects structurally bad input with a field path", () => {
    const r = baseRoom() as Record<string, unknown>;
    r["heightmap"] = ["00", "0q"];
    expect(paths(() => validateRoom(r))).toContain("heightmap.1");
  });

  it("rejects ragged heightmaps", () => {
    const r = baseRoom();
    r.heightmap = ["000", "00"];
    expect(paths(() => validateRoom(r))).toContain("heightmap");
  });

  it("rejects furniture footprints off the floor", () => {
    const r = baseRoom();
    r.furni = [{ itemId: "pc", defId: "computer_desk", x: 5, y: 0, dir: 4 }]; // 2 wide, spills past x=5
    expect(paths(() => validateRoom(r))).toContain("furni.0.x");
  });

  it("rejects anchors off the floor or on solid furniture", () => {
    const off = baseRoom();
    off.anchors[0] = { name: "computer", x: 9, y: 9, dir: 0 };
    expect(paths(() => validateRoom(off))).toContain("anchors.0.x");

    const blocked = baseRoom();
    blocked.anchors[1] = { name: "mailbox", x: 1, y: 0, dir: 0 }; // under the desk
    expect(paths(() => validateRoom(blocked))).toContain("anchors.1.x");
  });

  it("rejects an unwalkable use tile", () => {
    const r = baseRoom();
    r.furni = [{ itemId: "pc", defId: "computer_desk", x: 1, y: 0, dir: 0 }]; // faces north, off the floor
    expect(paths(() => validateRoom(r))).toContain("furni.0.dir");
  });

  it("rejects unknown defs, duplicate ids and overlapping solids", () => {
    const r = baseRoom();
    r.furni = [
      { itemId: "a", defId: "nope", x: 0, y: 0, dir: 4 },
      { itemId: "a", defId: "plant", x: 2, y: 2, dir: 4 },
      { itemId: "b", defId: "plant", x: 2, y: 2, dir: 4 },
    ];
    const p = paths(() => validateRoom(r));
    expect(p).toContain("furni.0.defId");
    expect(p).toContain("furni.1.itemId");
    expect(p).toContain("furni.2.x");
  });

  it("requires the semantic anchors", () => {
    const r = baseRoom();
    r.anchors = r.anchors.filter((a) => a.name !== "board");
    expect(paths(() => validateRoom(r))).toContain("anchors");
  });
});

describe("useTile and resolveAnchor", () => {
  it("returns the tile in front of the footprint", () => {
    expect(useTile({ itemId: "i", defId: "computer_desk", x: 4, y: 0, dir: 4 })).toEqual({ x: 4, y: 1 });
    expect(useTile({ itemId: "i", defId: "computer_desk", x: 4, y: 3, dir: 0 })).toEqual({ x: 4, y: 2 });
    // dir 2 swaps footprint to 1 wide x 2 long
    expect(useTile({ itemId: "i", defId: "agent_desk", x: 0, y: 2, dir: 2 })).toEqual({ x: 1, y: 2 });
    expect(useTile({ itemId: "i", defId: "agent_desk", x: 5, y: 2, dir: 6 })).toEqual({ x: 4, y: 2 });
  });

  it("resolves per-agent desks and homes", () => {
    const room = validateRoom(baseRoom());
    expect(resolveAnchor(room, "desk", "qa")).toMatchObject({ x: 3, y: 3 });
    expect(resolveAnchor(room, "home", "developer")).toMatchObject({ name: "home_developer" });
    expect(resolveAnchor(room, "desk")).toBeUndefined();
    expect(resolveAnchor(room, "door")).toEqual(room.door);
    expect(resolveAnchor(room, "board")).toMatchObject({ x: 4, y: 1 });
  });

  it("builds a path grid that blocks solid furniture only", () => {
    const grid = buildPathGrid(validateRoom(baseRoom()));
    expect(grid.blocked?.(1, 0)).toBe(true);
    expect(grid.blocked?.(2, 0)).toBe(true);
    expect(grid.blocked?.(1, 1)).toBe(false);
  });
});
