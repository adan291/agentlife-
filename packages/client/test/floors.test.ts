import { describe, expect, it } from "vitest";
import type { ActivityLine, FloorStatus, ServerMsg } from "@agentlife/shared";
import { renderFloorList } from "../src/ui/elevator.ts";
import { FLOOR_KEY, attentionCount, elevatorLabel, floorTag, loadFloor, restoreTarget, saveFloor, statusText } from "../src/ui/floors.ts";
import { PanelState } from "../src/ui/panel-state.ts";
import { TERMINAL_MAX_LINES, TerminalModel } from "../src/ui/terminal.ts";
import { TeamModel } from "../src/ui/team-bar.ts";
import { DOOR_CLOSE_MS, DOOR_GIVE_UP_MS, DOOR_HOLD_MS, DOOR_OPEN_MS, DoorSequence } from "../src/ui/transition.ts";
import type { DoorPhase } from "../src/ui/transition.ts";
import { fakeDoc, findAll, textOf } from "./fake-dom.ts";

const floor = (roomId: string, over: Partial<FloorStatus> = {}): FloorStatus => ({
  roomId,
  name: roomId === "lobby" ? "Lobby" : roomId === "hr" ? "HR office" : roomId.replace("project:", "").toUpperCase(),
  kind: roomId === "lobby" ? "lobby" : roomId === "hr" ? "hr" : "project",
  status: "idle",
  ...over,
});
const FLOORS: FloorStatus[] = [
  floor("lobby"),
  floor("hr"),
  floor("project:alpha", { status: "working", who: "developer" }),
  floor("project:beta", { status: "waiting_approval" }),
  floor("project:gamma", { status: "report_ready" }),
];

describe("floor status text and tags", () => {
  it("says every status in words", () => {
    expect(statusText(floor("lobby"))).toBe("Idle");
    expect(statusText(floor("p", { status: "working", who: "qa" }))).toBe("Working: QA");
    expect(statusText(floor("p", { status: "waiting_approval" }))).toBe("Waiting for your approval");
    expect(statusText(floor("p", { status: "report_ready" }))).toBe("Report ready");
    expect(statusText(floor("p", { status: "failed" }))).toBe("Failed");
    expect(statusText(floor("p", { status: "queued", queuePosition: 2 }))).toBe("Queued (place 2)");
  });

  it("names the lobby L, the HR office HR and numbers the project floors from 1", () => {
    expect(floorTag(FLOORS, "lobby")).toBe("L");
    expect(floorTag(FLOORS, "hr")).toBe("HR");
    expect(floorTag(FLOORS, "project:alpha")).toBe("1");
    expect(floorTag(FLOORS, "project:gamma")).toBe("3");
    expect(floorTag(FLOORS, "project:nope")).toBe("");
  });

  it("counts the other floors that wait for the user in the Elevator label", () => {
    expect(attentionCount(FLOORS, "lobby")).toBe(2);
    expect(elevatorLabel(FLOORS, "lobby")).toBe("Elevator (2)");
    // The floor the user is on does not count: they can see it.
    expect(elevatorLabel(FLOORS, "project:beta")).toBe("Elevator (1)");
    expect(elevatorLabel([floor("lobby"), floor("project:alpha")], "lobby")).toBe("Elevator");
  });
});

describe("remembered floor", () => {
  const store = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
  };

  it("saves and loads the room id", () => {
    const s = store();
    expect(loadFloor(s)).toBeNull();
    saveFloor(s, "project:alpha");
    expect(s.m.get(FLOOR_KEY)).toBe("project:alpha");
    expect(loadFloor(s)).toBe("project:alpha");
  });

  it("survives storage that throws or is missing", () => {
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(loadFloor(broken)).toBeNull();
    expect(() => saveFloor(broken, "lobby")).not.toThrow();
    expect(loadFloor(undefined)).toBeNull();
  });

  it("returns to the remembered floor only when it still exists and differs from the current one", () => {
    expect(restoreTarget("project:alpha", "lobby", FLOORS)).toBe("project:alpha");
    expect(restoreTarget("project:alpha", "project:alpha", FLOORS)).toBeNull();
    expect(restoreTarget("project:removed", "lobby", FLOORS)).toBeNull();
    expect(restoreTarget(null, "lobby", FLOORS)).toBeNull();
  });
});

describe("floor list", () => {
  it("lists every floor with its status and highlights the ones that wait for the user", () => {
    const root = renderFloorList(fakeDoc(), FLOORS, "lobby");
    const rows = findAll(root, (e) => e.tagName === "li");
    expect(rows.map((r) => r.dataset["room"])).toEqual(FLOORS.map((f) => f.roomId));
    const attention = rows.filter((r) => r.dataset["attention"] === "true").map((r) => r.dataset["room"]);
    expect(attention).toEqual(["project:beta", "project:gamma"]);
    expect(textOf(rows[3])).toContain("Waiting for your approval");
    expect(textOf(rows[0])).toContain("You are here");
  });

  it("is read-only without actions (the directory board) and has Go buttons with them (the elevator)", () => {
    expect(findAll(renderFloorList(fakeDoc(), FLOORS, "lobby"), (e) => e.tagName === "button")).toHaveLength(0);

    const went: string[] = [];
    const root = renderFloorList(fakeDoc(), FLOORS, "lobby", { go: (id) => went.push(id) });
    const buttons = findAll(root, (e) => e.tagName === "button");
    expect(buttons).toHaveLength(FLOORS.length);
    expect(buttons[0]!.disabled).toBe(true); // the floor the user is on
    buttons[3]!.click();
    buttons[0]!.click();
    expect(went).toEqual(["project:beta"]);
  });

  it("puts names in text, never in markup", () => {
    const root = renderFloorList(fakeDoc(), [floor("lobby"), floor("project:x", { name: "<img src=x onerror=1>" })], "lobby");
    const names = findAll(root, (e) => e.className === "al-floor-name").map(textOf);
    expect(names).toEqual(["Lobby", "<img src=x onerror=1>"]);
    expect(findAll(root, (e) => e.tagName === "img")).toHaveLength(0);
  });

  it("says so when there are no floors yet", () => {
    expect(textOf(renderFloorList(fakeDoc(), [], undefined))).toBe("No floors yet.");
  });
});

describe("PanelState and floors", () => {
  const welcome = (roomId: string): ServerMsg =>
    ({
      type: "welcome",
      protocol: 1,
      room: { id: roomId, name: roomId } as never,
      roomId,
      you: 1,
      avatars: [],
      agents: [],
    }) as ServerMsg;

  it("keeps the floors and re-renders only the floor lists", () => {
    const s = new PanelState();
    s.apply({ type: "open_panel", panel: "computer" });
    expect(s.apply({ type: "floors", floors: FLOORS })).toBe(false); // the computer form must not be redrawn while typing
    expect(s.floors).toEqual(FLOORS);
    s.apply({ type: "open_panel", panel: "elevator" });
    expect(s.apply({ type: "floors", floors: [floor("lobby")] })).toBe(true);
    s.apply({ type: "open_panel", panel: "directory" });
    expect(s.apply({ type: "floors", floors: FLOORS })).toBe(true);
  });

  it("forgets the job, approvals and reports of the old floor on a new welcome, and remembers the room", () => {
    const s = new PanelState();
    s.apply({ type: "job_update", job: { taskId: "t1", repoId: "alpha", goal: "g", state: "analyzing", timeline: [] } });
    s.apply({ type: "approval", approval: { approvalId: "a1", taskId: "t1", kind: "plan", summary: "s", status: "pending" } });
    s.apply({ type: "report", report: { reportId: "r1", taskId: "t1", title: "t", markdown: "m" } });
    s.apply({ type: "open_panel", panel: "mailbox" });
    s.apply({ type: "floors", floors: FLOORS });

    s.apply(welcome("project:beta"));
    expect(s.roomId).toBe("project:beta");
    expect(s.open).toBeNull();
    expect(s.data.job).toBeNull();
    expect(s.data.approvals).toEqual([]);
    expect(s.data.reports).toEqual([]);
    expect(s.floors).toEqual(FLOORS); // the list is hotel-wide
  });
});

describe("terminal scope", () => {
  const line = (ts: number, roomId: string | undefined, text = `l${ts}`): ActivityLine => ({
    ts,
    agentId: "architect",
    text,
    ...(roomId ? { roomId } : {}),
  });

  it("shows the current floor's lines by default and every floor's with 'All floors'", () => {
    const m = new TerminalModel();
    m.room = "project:alpha";
    m.push(line(1, "project:alpha"));
    m.push(line(2, "project:beta"));
    m.push(line(3, undefined));
    expect(m.visible().map((l) => l.ts)).toEqual([1, 3]); // a line without a room belongs to every floor's view
    m.scope = "all";
    expect(m.visible().map((l) => l.ts)).toEqual([1, 2, 3]);
  });

  it("follows the user to another floor", () => {
    const m = new TerminalModel();
    m.push(line(1, "project:alpha"));
    m.push(line(2, "project:beta"));
    m.room = "project:beta";
    expect(m.visible().map((l) => l.ts)).toEqual([2]);
  });

  it("puts a late line (a floor's buffered backlog) at its place by time and drops a repeat", () => {
    const m = new TerminalModel();
    m.room = "project:alpha";
    m.push(line(10, "project:alpha"));
    m.push(line(30, "project:alpha"));
    m.push(line(20, "project:beta"));
    m.push(line(20, "project:beta"));
    expect(m.visible().map((l) => l.ts)).toEqual([10, 30]);
    m.scope = "all";
    expect(m.visible().map((l) => l.ts)).toEqual([10, 20, 30]);
    expect(m.size).toBe(3);
  });

  it("keeps the agent filter together with the scope", () => {
    const m = new TerminalModel();
    m.room = "project:alpha";
    m.push(line(1, "project:alpha"));
    m.push({ ...line(2, "project:alpha"), agentId: "qa" });
    m.filter = "qa";
    expect(m.visible().map((l) => l.ts)).toEqual([2]);
  });

  it("still drops the oldest lines beyond the limit", () => {
    const m = new TerminalModel();
    for (let i = 1; i <= TERMINAL_MAX_LINES + 5; i++) m.push(line(i, "lobby"));
    expect(m.size).toBe(TERMINAL_MAX_LINES);
    expect(m.latest()?.ts).toBe(TERMINAL_MAX_LINES + 5);
  });
});

describe("team of a floor", () => {
  const welcome = (agents: ("architect" | "developer" | "qa" | "builder")[]): ServerMsg =>
    ({
      type: "welcome",
      protocol: 1,
      room: {} as never,
      you: 1,
      avatars: [],
      agents: agents.map((agentId) => ({ agentId, state: "idle" })),
    }) as ServerMsg;

  it("lists only the agents that live on the floor", () => {
    const t = new TeamModel(0);
    expect(t.rows().map((r) => r.agentId)).toEqual(["architect", "developer", "qa", "builder"]);
    t.apply(welcome(["builder"]), 1);
    expect(t.rows().map((r) => r.agentId)).toEqual(["builder"]);
    expect(t.isPresent("qa")).toBe(false);
    t.apply(welcome(["architect", "developer", "qa"]), 2);
    expect(t.rows().map((r) => r.agentId)).toEqual(["architect", "developer", "qa"]);
  });
});

describe("door transition", () => {
  function setup(reduced = false) {
    let now = 0;
    const timers: { at: number; fn: () => void; live: boolean }[] = [];
    const phases: DoorPhase[] = [];
    const seq = new DoorSequence({
      reducedMotion: () => reduced,
      timers: {
        now: () => now,
        after: (ms, fn) => {
          const t = { at: now + ms, fn, live: true };
          timers.push(t);
          return () => {
            t.live = false;
          };
        },
      },
      onPhase: (p) => phases.push(p),
    });
    const advance = (ms: number) => {
      const end = now + ms;
      for (;;) {
        const next = timers.filter((t) => t.live && t.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!next) break;
        now = next.at;
        next.live = false;
        next.fn();
      }
      now = end;
    };
    return { seq, phases, advance };
  }

  it("closes, shows the floor, then opens", () => {
    const { seq, phases, advance } = setup();
    seq.begin();
    expect(seq.current).toBe("closing");
    advance(DOOR_CLOSE_MS);
    expect(seq.current).toBe("closed");
    seq.arrive();
    advance(DOOR_HOLD_MS);
    expect(seq.current).toBe("opening");
    advance(DOOR_OPEN_MS);
    expect(seq.current).toBe("open");
    expect(phases).toEqual(["closing", "closed", "closed", "opening", "open"]);
  });

  it("waits for the doors to finish closing when the floor arrives early", () => {
    const { seq, advance } = setup();
    seq.begin();
    advance(100);
    seq.arrive();
    expect(seq.current).toBe("closing");
    advance(DOOR_CLOSE_MS - 100);
    expect(seq.current).toBe("closed");
    advance(DOOR_HOLD_MS);
    expect(seq.current).toBe("opening");
  });

  it("a door in the lobby (no begin) snaps shut, shows the floor and opens", () => {
    const { seq, phases, advance } = setup();
    seq.arrive();
    expect(seq.current).toBe("closed");
    advance(DOOR_HOLD_MS + DOOR_OPEN_MS);
    expect(seq.current).toBe("open");
    expect(phases[0]).toBe("closed");
  });

  it("opens again when the server refuses, and when nothing ever arrives", () => {
    const refused = setup();
    refused.seq.begin();
    refused.advance(DOOR_CLOSE_MS);
    refused.seq.abort();
    expect(refused.seq.current).toBe("opening");
    refused.advance(DOOR_OPEN_MS);
    expect(refused.seq.current).toBe("open");

    const silent = setup();
    silent.seq.begin();
    silent.advance(DOOR_GIVE_UP_MS);
    expect(silent.seq.current).toBe("opening");
    silent.advance(DOOR_OPEN_MS);
    expect(silent.seq.current).toBe("open");
  });

  it("does nothing under reduced motion", () => {
    const { seq, phases, advance } = setup(true);
    seq.begin();
    seq.arrive();
    seq.abort();
    advance(10_000);
    expect(phases).toEqual([]);
    expect(seq.current).toBe("open");
  });

  it("a second begin while closing does not restart the sequence", () => {
    const { seq, phases } = setup();
    seq.begin();
    seq.begin();
    expect(phases).toEqual(["closing"]);
  });
});
