import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FURNI_CATALOG, WorldSim, buildPathGrid, findPath, useTile, validateRoom } from "@agentlife/shared";

const here = dirname(fileURLToPath(import.meta.url));
const roomPath = join(here, "..", "rooms", "office.json");

describe("rooms/office.json", () => {
  const room = validateRoom(JSON.parse(readFileSync(roomPath, "utf8")));

  it("validates and has the required furniture", () => {
    const defs = room.furni.map((f) => f.defId);
    expect(defs.filter((d) => d === "computer_desk")).toHaveLength(1);
    expect(defs.filter((d) => d === "mailbox")).toHaveLength(1);
    expect(defs.filter((d) => d === "board")).toHaveLength(1);
    expect(defs.filter((d) => d === "reception_desk")).toHaveLength(1);
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

  it("has a Reception desk that can be reached from the door and opens the reception panel", () => {
    const desk = room.furni.find((f) => f.defId === "reception_desk");
    expect(desk).toBeDefined();
    expect(FURNI_CATALOG["reception_desk"]).toMatchObject({ interaction: "reception", hint: "Register and manage projects" });
    const grid = buildPathGrid(room);
    expect(findPath(grid, room.door, useTile(desk!))).not.toBeNull();
    let now = 0;
    const sim = new WorldSim(room, () => now);
    sim.join();
    const msgs = sim.handleIntent(1, { type: "use", itemId: desk!.itemId });
    expect(msgs.some((m) => m.type === "walk")).toBe(true);
    now += 60_000;
    expect(sim.dueMessages()).toContainEqual({ type: "open_panel", panel: "reception" });
  });
});
