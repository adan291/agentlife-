import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ClientMsgSchema, ServerMsgSchema, validateRoom } from "../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const template = validateRoom(JSON.parse(readFileSync(join(here, "..", "..", "world-server", "rooms", "project-template.json"), "utf8")));

describe("furni-move messages", () => {
  it("accepts furni_move and furni_reset from the client", () => {
    expect(ClientMsgSchema.safeParse({ type: "furni_move", itemId: "plant_2", x: 3, y: 4, dir: 2 }).success).toBe(true);
    expect(ClientMsgSchema.safeParse({ type: "furni_reset" }).success).toBe(true);
  });

  it.each([
    ["a direction that is not 0, 2, 4 or 6", { itemId: "plant_2", x: 3, y: 4, dir: 3 }],
    ["an empty item id", { itemId: "", x: 3, y: 4, dir: 2 }],
    ["a coordinate far outside any room", { itemId: "plant_2", x: 1000, y: 4, dir: 2 }],
    ["a fractional coordinate", { itemId: "plant_2", x: 1.5, y: 4, dir: 2 }],
    ["a missing direction", { itemId: "plant_2", x: 3, y: 4 }],
  ])("refuses furni_move with %s", (_name, body) => {
    expect(ClientMsgSchema.safeParse({ type: "furni_move", ...body }).success).toBe(false);
  });

  it("accepts room_layout and the layout_error code from the server", () => {
    const msg = { type: "room_layout", roomId: "project:demo", furni: template.furni, anchors: template.anchors };
    expect(ServerMsgSchema.safeParse(msg).success).toBe(true);
    expect(ServerMsgSchema.safeParse({ ...msg, furni: [{ itemId: "x", defId: "plant", x: 1, y: 1, dir: 3 }] }).success).toBe(false);
    expect(ServerMsgSchema.safeParse({ type: "error", code: "layout_error", message: "That tile is taken." }).success).toBe(true);
  });
});
