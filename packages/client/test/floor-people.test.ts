import { describe, expect, it } from "vitest";
import { GUEST_IDS } from "@agentlife/shared";
import type { ServerMsg, StaffId, TeamViewGuest } from "@agentlife/shared";
import { FloorPeople } from "../src/scene/floor-people.ts";
import { guestTooltip } from "../src/ui/tooltip.ts";
import { HAIR_COLOURS, ROLE_COLOURS } from "../src/palette.ts";

const welcome = { type: "welcome" } as unknown as ServerMsg;
const view = (guests: TeamViewGuest[], desks = ["Architect", "Developer", "QA"]): ServerMsg => ({
  type: "team_view",
  roomId: "project:alpha",
  members: [
    { agentId: "architect", name: desks[0]! },
    { agentId: "developer", name: desks[1]! },
    { agentId: "qa", name: desks[2]! },
  ],
  guests,
});
const presence = (agentId: StaffId, present: boolean): ServerMsg => ({ type: "agent_presence", agentId, present });
const shownGuests = (p: FloorPeople, walking = false) => GUEST_IDS.filter((g) => p.isShown(g, walking));

/** The team of hr-desk requirement 4.3: a second developer, a reviewer, a researcher and the Night intern. */
const TEAM: TeamViewGuest[] = [
  { guestId: "guest2", name: "Dex", role: "developer", model: "auto" },
  { guestId: "guest5", name: "Rhea", role: "reviewer" },
  { guestId: "guest6", name: "Rue", role: "researcher" },
  { guestId: "guest1", name: "Nox", role: "researcher", model: "qwen3.5:4b" },
];

describe("FloorPeople", () => {
  it("shows nobody at the standing spots until the team view lists somebody there", () => {
    const p = new FloorPeople();
    p.apply(welcome);
    expect(shownGuests(p)).toEqual([]);
    expect(p.listedGuests()).toEqual([]);
  });

  it("shows a second developer, a reviewer, a researcher and the Night intern, each at their own spot", () => {
    const p = new FloorPeople();
    p.apply(welcome);
    p.apply(view(TEAM));
    expect(shownGuests(p)).toEqual(["guest1", "guest2", "guest5", "guest6"]);
    expect(p.listedGuests().map((g) => `${g.guestId}:${g.name}:${g.role}`)).toEqual([
      "guest1:Nox:researcher",
      "guest2:Dex:developer",
      "guest5:Rhea:reviewer",
      "guest6:Rue:researcher",
    ]);
    expect(p.guest("guest1")).toMatchObject({ name: "Nox", model: "qwen3.5:4b" });
    expect(p.guest("guest3")).toBeUndefined();
    // The three desk ghosts are drawn too.
    for (const id of ["architect", "developer", "qa"] as const) expect(p.isShown(id, false)).toBe(true);
    expect(p.member("qa")?.name).toBe("QA");
  });

  it("shows all eight members of a full team: three at desks, five at spots", () => {
    const p = new FloorPeople();
    p.apply(welcome);
    p.apply(
      view([
        ...TEAM,
        { guestId: "guest3", name: "Wren", role: "qa" },
      ]),
    );
    expect(p.listedGuests()).toHaveLength(5);
    expect(shownGuests(p)).toHaveLength(5);
    expect(new Set([...p.listedGuests().map((g) => g.name), ...["Architect", "Developer", "QA"]]).size).toBe(8);
  });

  it("keeps a member who was let go in view until the ghost has walked to the elevator, then hides it", () => {
    const p = new FloorPeople();
    p.apply(welcome);
    p.apply(view(TEAM));
    p.apply(presence("guest2", false));
    expect(p.isShown("guest2", true)).toBe(true); // still walking out
    expect(p.isShown("guest2", false)).toBe(false); // arrived at the elevator
    expect(p.isShown("guest5", false)).toBe(true); // the others are not touched
  });

  it("hides a spot once the team view stops listing it, and shows a returning member again", () => {
    const p = new FloorPeople();
    p.apply(welcome);
    p.apply(view(TEAM));
    p.apply(presence("guest2", false));
    p.apply(view(TEAM.filter((g) => g.guestId !== "guest2")));
    expect(p.isShown("guest2", true)).toBe(false);
    p.apply(presence("guest2", true));
    expect(p.isShown("guest2", false)).toBe(false); // present, but nobody is listed there
    p.apply(view(TEAM));
    expect(p.isShown("guest2", false)).toBe(true);
  });

  it("hides a desk ghost that was let go and shows its successor when it comes back", () => {
    const p = new FloorPeople();
    p.apply(welcome);
    p.apply(view([]));
    p.apply(presence("qa", false));
    expect(p.isShown("qa", false)).toBe(false);
    p.apply(view([], ["Architect", "Developer", "Wren"]));
    p.apply(presence("qa", true));
    expect(p.isShown("qa", false)).toBe(true);
    expect(p.member("qa")?.name).toBe("Wren");
  });

  it("forgets everything on a new welcome (another floor)", () => {
    const p = new FloorPeople();
    p.apply(welcome);
    p.apply(view(TEAM));
    p.apply(presence("qa", false));
    p.apply(welcome);
    expect(shownGuests(p)).toEqual([]);
    expect(p.isShown("qa", false)).toBe(true);
    expect(p.member("qa")).toBeUndefined();
  });

  it("ignores a team view without guests (an older server, the demo)", () => {
    const p = new FloorPeople();
    p.apply(welcome);
    p.apply({ type: "team_view", roomId: "project:alpha", members: [] });
    expect(shownGuests(p)).toEqual([]);
  });
});

describe("how a guest looks", () => {
  it("has a colour and a hair colour for every role that can stand on the floor", () => {
    for (const role of ["architect", "developer", "qa", "reviewer", "researcher"] as const) {
      expect(ROLE_COLOURS[role], role).toBeTypeOf("number");
      expect(HAIR_COLOURS[role], role).toBeTypeOf("number");
    }
    expect(ROLE_COLOURS.reviewer).not.toBe(ROLE_COLOURS.researcher);
  });

  it("has a tooltip with the name, the role and the model", () => {
    const tip = guestTooltip("Nox", "Researcher", "qwen3.5:4b");
    expect(tip.title).toBe("Nox (Researcher)");
    expect(tip.lines.join("\n")).toContain("Model: qwen3.5:4b");
    expect(guestTooltip("Rhea", "Reviewer", undefined).lines.join("\n")).not.toContain("Model");
  });
});
