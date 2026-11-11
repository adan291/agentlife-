import { describe, expect, it } from "vitest";
import { roomAgents } from "@agentlife/shared";
import { loadHotelRooms } from "../src/load-room.ts";

describe("rooms/", () => {
  const { lobby, hr, template } = loadHotelRooms();

  it("loads and validates the lobby, the HR office and the project template", () => {
    expect([lobby.kind, hr.kind, template.kind]).toEqual(["lobby", "hr", "project"]);
    expect(roomAgents(lobby)).toEqual(["builder"]);
    expect(roomAgents(hr)).toEqual([]);
    expect(roomAgents(template)).toEqual(["architect", "developer", "qa"]);
  });

  it("every room has an elevator", () => {
    for (const room of [lobby, hr, template]) expect(room.furni.some((f) => f.defId === "elevator")).toBe(true);
  });

  it("the Reception is in the lobby, not on the project floors", () => {
    expect(lobby.furni.some((f) => f.defId === "reception_desk")).toBe(true);
    expect(template.furni.some((f) => f.defId === "reception_desk")).toBe(false);
  });
});
