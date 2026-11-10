import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CrewEventSchema, resolveAnchor, validateRoom } from "../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const room = validateRoom(
  JSON.parse(readFileSync(join(here, "..", "..", "world-server", "rooms", "office.json"), "utf8")),
);

describe("builder", () => {
  it("has a desk and a home in the office", () => {
    expect(resolveAnchor(room, "desk", "builder")?.name).toBe("desk");
    expect(resolveAnchor(room, "home", "builder")?.name).toBe("home_builder");
  });
});

describe("CrewEventSchema", () => {
  it("accepts valid events and rejects bad ones", () => {
    expect(CrewEventSchema.safeParse({ kind: "started", session: "S9", spec: "x", model: "m" }).success).toBe(true);
    expect(CrewEventSchema.safeParse({ kind: "activity", session: "S9", activity: "edit", text: "editing a.ts" }).success).toBe(true);
    expect(CrewEventSchema.safeParse({ kind: "nope", session: "S9" }).success).toBe(false);
    expect(CrewEventSchema.safeParse({ kind: "started", session: "S1234567890" }).success).toBe(false);
    expect(CrewEventSchema.safeParse({ kind: "activity", session: "S9", text: "x".repeat(81) }).success).toBe(false);
    expect(CrewEventSchema.safeParse({ kind: "activity", session: "S9", activity: "fly" }).success).toBe(false);
  });
});
