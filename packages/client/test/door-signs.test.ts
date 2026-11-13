import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { roomForProject, validateRoom } from "@agentlife/shared";
import type { RoomDef } from "@agentlife/shared";
import { SIGN_MAX_CHARS, signLabel, signsFor } from "../src/scene/door-signs.ts";

const rooms = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "world-server", "rooms");
const load = (file: string): RoomDef => validateRoom(JSON.parse(readFileSync(join(rooms, file), "utf8")));
const template = load("project-template.json");

describe("door signs", () => {
  it("writes the project's name on one plaque over the elevator of its floor", () => {
    const room = roomForProject(template, { id: "todo", name: "Haunted Todo" });
    const signs = signsFor(room);
    expect(signs.map((s) => s.itemId)).toEqual(["elevator_1"]);
    for (const s of signs) expect(s.text).toBe("Haunted Todo");
  });

  it("cuts a long name so it fits over a door", () => {
    const room = roomForProject(template, { id: "long", name: "a-very-long-project-name-indeed" });
    const [sign] = signsFor(room);
    expect(sign!.text.length).toBeLessThanOrEqual(SIGN_MAX_CHARS);
    expect(sign!.text.endsWith("…")).toBe(true);
    expect(signLabel("short")).toBe("short");
  });

  it("the lobby and the HR office carry no project name", () => {
    expect(signsFor(load("lobby.json"))).toEqual([]);
    expect(signsFor(load("hr.json"))).toEqual([]);
  });
});
