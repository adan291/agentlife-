import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FURNI_CATALOG, buildPathGrid, findPath, validateRoom } from "@agentlife/shared";

const here = dirname(fileURLToPath(import.meta.url));
const roomPath = join(here, "..", "rooms", "office.json");

describe("rooms/office.json", () => {
  const room = validateRoom(JSON.parse(readFileSync(roomPath, "utf8")));

  it("validates and has the required furniture", () => {
    const defs = room.furni.map((f) => f.defId);
    expect(defs.filter((d) => d === "computer_desk")).toHaveLength(1);
    expect(defs.filter((d) => d === "mailbox")).toHaveLength(1);
    expect(defs.filter((d) => d === "board")).toHaveLength(1);
    expect(defs.filter((d) => d === "agent_desk")).toHaveLength(4);
    for (const d of ["plant", "lamp", "sofa", "jack_o_lantern_lamp", "cobweb"]) {
      expect(defs).toContain(d);
    }
    expect(room.furni.every((f) => f.defId in FURNI_CATALOG)).toBe(true);
  });

  it("is about 12x10", () => {
    expect(room.heightmap).toHaveLength(10);
    expect(room.heightmap[0]).toHaveLength(12);
  });

  it("lets every anchor be reached from the door", () => {
    const grid = buildPathGrid(room);
    for (const a of room.anchors) {
      expect(findPath(grid, room.door, a), `${a.name} ${a.agent ?? ""}`).not.toBeNull();
    }
  });
});
