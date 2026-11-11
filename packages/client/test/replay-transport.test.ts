import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RunExportSchema, ServerMsgSchema, validateRoom } from "@agentlife/shared";
import type { RunExport, ServerMsg } from "@agentlife/shared";
import { REPLAY_REJECT_NOTE, ReplayTransport } from "../src/replay/transport.ts";
import type { ReplayRooms } from "../src/replay/transport.ts";

const here = dirname(fileURLToPath(import.meta.url));
const roomFile = (name: string) => validateRoom(JSON.parse(readFileSync(join(here, "..", "..", "world-server", "rooms", name), "utf8")));
const room: ReplayRooms = { lobby: roomFile("lobby.json"), hr: roomFile("hr.json"), template: roomFile("project-template.json") };
const exp: RunExport = RunExportSchema.parse(JSON.parse(readFileSync(join(here, "..", "public", "demo", "run-001.json"), "utf8")));

function setup() {
  let t = 1_000_000;
  const transport = new ReplayTransport(exp, room, { now: () => t, startTicker: () => () => {}, autoBegin: false });
  const msgs: ServerMsg[] = [];
  transport.onMessage((m) => msgs.push(m));
  transport.begin();
  const advance = (ms: number, step = 50) => {
    for (let i = 0; i < ms; i += step) {
      t += step;
      transport.tick();
    }
  };
  const of = <T extends ServerMsg["type"]>(type: T) => msgs.filter((m): m is Extract<ServerMsg, { type: T }> => m.type === type);
  return { transport, msgs, advance, of, clock: () => t };
}

const repoId = exp.job.repoId;

describe("ReplayTransport", () => {
  it("reports open status and sends a valid welcome with the recorded models", () => {
    const { transport, msgs } = setup();
    const statuses: string[] = [];
    transport.onStatus((s) => statuses.push(s));
    expect(statuses).toEqual(["open"]);
    const welcome = msgs[0]!;
    expect(welcome.type).toBe("welcome");
    expect(ServerMsgSchema.safeParse(welcome).success).toBe(true);
    if (welcome.type === "welcome") expect(welcome.models).toBeUndefined();
  });

  it("takes the model per role from the recorded steps when there are any", () => {
    const withModels: RunExport = {
      ...exp,
      job: { ...exp.job, steps: exp.job.steps.map((s) => ({ ...s, model: `m-${s.step}` })) },
    };
    const t = new ReplayTransport(withModels, room, { now: () => 1, startTicker: () => () => {}, autoBegin: false });
    const got: ServerMsg[] = [];
    t.onMessage((m) => got.push(m));
    t.begin();
    const welcome = got[0]!;
    if (welcome.type !== "welcome") throw new Error("no welcome");
    expect(welcome.models).toEqual({ architect: "m-analyze", developer: "m-develop", qa: "m-review" });
  });

  it("keeps the user avatar controllable: use computer opens the panel with the recorded repo", () => {
    const { transport, advance, of } = setup();
    transport.send({ type: "use", itemId: "computer_desk_1" });
    expect(of("walk").some((w) => w.id === 1)).toBe(true);
    advance(20_000);
    const repos = of("repos");
    expect(repos.at(-1)?.repos.map((r) => r.id)).toEqual([repoId]);
    expect(of("open_panel").map((p) => p.panel)).toContain("computer");
  });

  it("rejects an unknown repo and a second start", () => {
    const { transport, of } = setup();
    transport.send({ type: "start_job", repoId: "other", goal: "x" });
    expect(of("error").at(-1)?.code).toBe("bad_message");
    transport.send({ type: "start_job", repoId, goal: "x" });
    transport.send({ type: "start_job", repoId, goal: "x" });
    expect(of("error").at(-1)?.code).toBe("busy");
  });

  it("plays the run, waits at the approval, continues after Approve and delivers the report", () => {
    const { transport, advance, of } = setup();
    transport.send({ type: "start_job", repoId, goal: "ignored" });
    expect(of("job_update").at(-1)?.job.goal).toBe(exp.job.goal);
    advance(5 * 60_000);
    const pending = of("approval").at(-1)!.approval;
    expect(pending.status).toBe("pending");
    expect(of("report")).toHaveLength(0);
    expect(of("job_update").at(-1)?.job.state).toBe("awaiting_plan_approval");

    transport.send({ type: "approve", approvalId: pending.approvalId, decision: "approve" });
    expect(of("approval").at(-1)?.approval.status).toBe("approved");
    advance(5 * 60_000);
    const report = of("report").at(-1)!.report;
    expect(report.markdown.length).toBeGreaterThan(0);
    expect(report.verdict).toBe("pass");
    expect(of("job_update").at(-1)?.job.state).toBe("delivered");
    expect(of("agent_state").length).toBeGreaterThan(0);
    expect(of("activity").length).toBeGreaterThan(0);
  });

  it("explains a Reject and continues with the recorded approval", () => {
    const { transport, advance, of } = setup();
    transport.send({ type: "start_job", repoId, goal: "x" });
    advance(5 * 60_000);
    const id = of("approval").at(-1)!.approval.approvalId;
    transport.send({ type: "approve", approvalId: id, decision: "reject" });
    expect(of("activity").some((a) => a.line.text === REPLAY_REJECT_NOTE)).toBe(true);
    expect(of("approval").at(-1)?.approval.status).toBe("approved");
    advance(5 * 60_000);
    expect(of("report")).toHaveLength(1);
  });

  it("does not reveal later artifacts in the job card before they exist", () => {
    const { transport, advance, of } = setup();
    transport.send({ type: "start_job", repoId, goal: "x" });
    advance(5 * 60_000);
    transport.send({ type: "job_details", taskId: exp.job.taskId });
    const early = of("job_details").at(-1)!.details;
    expect(early.artifacts.map((a) => a.kind)).toEqual(["plan"]);
    expect(early.job.state).toBe("awaiting_plan_approval");

    transport.send({ type: "approve", approvalId: of("approval").at(-1)!.approval.approvalId, decision: "approve" });
    advance(5 * 60_000);
    transport.send({ type: "job_details", taskId: exp.job.taskId });
    const full = of("job_details").at(-1)!.details;
    expect(full.artifacts.map((a) => a.kind)).toEqual(exp.artifacts.map((a) => a.kind));
    expect(full.job.state).toBe("delivered");
  });

  it("speed changes make the run faster", () => {
    const slow = setup();
    slow.transport.send({ type: "start_job", repoId, goal: "x" });
    slow.advance(2_000);
    const fast = setup();
    fast.transport.setSpeed(16);
    fast.transport.send({ type: "start_job", repoId, goal: "x" });
    fast.advance(2_000);
    expect(fast.of("activity").length + fast.of("agent_state").length).toBeGreaterThan(
      slow.of("activity").length + slow.of("agent_state").length,
    );
  });

  it("restart resets the room and lets the run start again", () => {
    const { transport, advance, of, msgs } = setup();
    transport.send({ type: "start_job", repoId, goal: "x" });
    advance(5 * 60_000);
    transport.restart();
    expect(transport.started).toBe(false);
    expect(msgs.filter((m) => m.type === "welcome")).toHaveLength(2);
    expect(msgs.at(-1)?.type).toBe("floors");
    const before = of("approval").length;
    transport.send({ type: "start_job", repoId, goal: "x" });
    advance(5 * 60_000);
    expect(of("approval").length).toBeGreaterThan(before);
    expect(of("approval").at(-1)?.approval.status).toBe("pending");
  });

  it("makes no network requests", () => {
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (() => {
      calls++;
      throw new Error("no network in replay");
    }) as typeof fetch;
    try {
      const { transport, advance } = setup();
      transport.send({ type: "start_job", repoId, goal: "x" });
      advance(60_000);
    } finally {
      globalThis.fetch = original;
    }
    expect(calls).toBe(0);
  });
});

describe("ReplayTransport floors", () => {
  const floorRoom = `project:${repoId}`;

  /** Walks to the elevator and opens its panel. */
  function atElevatorPanel(s: ReturnType<typeof setup>) {
    s.transport.send({ type: "use", itemId: "elevator_1" });
    s.advance(30_000);
    expect(s.of("open_panel").map((p) => p.panel)).toContain("elevator");
  }

  it("starts on the recorded floor, with its room id, its team and the floor list", () => {
    const { msgs, of } = setup();
    const welcome = of("welcome")[0]!;
    expect(welcome.roomId).toBe(floorRoom);
    expect(welcome.room.name).toBe(repoId);
    expect(welcome.agents.map((a) => a.agentId)).toEqual(["architect", "developer", "qa"]);
    const floors = of("floors").at(-1)!.floors;
    expect(floors.map((f) => f.roomId)).toEqual(["lobby", "hr", floorRoom]);
    expect(floors.every((f) => f.status === "idle")).toBe(true);
    expect(msgs.map((m) => m.type).slice(0, 2)).toEqual(["welcome", "floors"]);
  });

  it("takes the roomId of the export when it has one", () => {
    const named: RunExport = { ...exp, roomId: "project:other-name" };
    const t = new ReplayTransport(named, room, { now: () => 1, startTicker: () => () => {}, autoBegin: false });
    const got: ServerMsg[] = [];
    t.onMessage((m) => got.push(m));
    t.begin();
    const welcome = got.find((m) => m.type === "welcome");
    expect(welcome?.type === "welcome" && welcome.roomId).toBe("project:other-name");
  });

  it("follows the recorded job in the floor status and marks an unread report until the mailbox is opened", () => {
    const s = setup();
    const status = () => s.of("floors").at(-1)!.floors.find((f) => f.roomId === floorRoom)!;
    s.transport.send({ type: "start_job", repoId, goal: "x" });
    expect(status().status).toBe("working");
    s.advance(5 * 60_000);
    expect(status().status).toBe("waiting_approval");
    s.transport.send({ type: "approve", approvalId: s.of("approval").at(-1)!.approval.approvalId, decision: "approve" });
    s.advance(5 * 60_000);
    expect(status().status).toBe("report_ready");
    s.transport.send({ type: "use", itemId: "mailbox_1" });
    s.advance(30_000);
    expect(status().status).toBe("idle");
  });

  it("goes to the lobby and back by the elevator; nothing of the recorded job reaches the lobby", () => {
    const s = setup();
    s.transport.send({ type: "start_job", repoId, goal: "x" });
    atElevatorPanel(s);
    s.transport.send({ type: "go_to", roomId: "lobby" });
    const lobby = s.of("welcome").at(-1)!;
    expect(lobby.roomId).toBe("lobby");
    expect(lobby.agents.map((a) => a.agentId)).toEqual(["builder"]);
    expect(lobby.activity).toBeUndefined();

    const seen = s.msgs.length;
    s.advance(5 * 60_000); // the plan is ready by now, but the user is in the lobby
    const lobbyMsgs = s.msgs.slice(seen);
    for (const type of ["approval", "activity", "work", "job_update", "agent_state", "say"] as const) {
      expect(lobbyMsgs.some((m) => m.type === type), type).toBe(false);
    }
    expect(s.of("floors").at(-1)!.floors.find((f) => f.roomId === floorRoom)?.status).toBe("waiting_approval");

    s.transport.send({ type: "use", itemId: "elevator_1" });
    s.advance(30_000);
    s.transport.send({ type: "go_to", roomId: floorRoom });
    const back = s.of("welcome").at(-1)!;
    expect(back.roomId).toBe(floorRoom);
    // The plan that waited comes back with the floor, and so does the job.
    const after = s.msgs.slice(s.msgs.lastIndexOf(back));
    expect(after.some((m) => m.type === "approval" && m.approval.status === "pending")).toBe(true);
    expect(after.some((m) => m.type === "job_update" && m.job.state === "awaiting_plan_approval")).toBe(true);
    expect(back.activity?.length).toBeGreaterThan(0);
  });

  it("refuses the elevator away from it and an unknown floor", () => {
    const s = setup();
    s.transport.send({ type: "go_to", roomId: "project:nope" });
    expect(s.of("error").at(-1)?.message).toBe("unknown floor");
    s.transport.send({ type: "move", x: 6, y: 5 });
    s.advance(10_000);
    s.transport.send({ type: "go_to", roomId: "lobby" });
    expect(s.of("error").at(-1)?.message).toBe("use the elevator first");
    expect(s.of("welcome")).toHaveLength(1);
  });

  it("the HR door in the lobby leads to the HR office", () => {
    const s = setup();
    atElevatorPanel(s);
    s.transport.send({ type: "go_to", roomId: "lobby" });
    s.transport.send({ type: "use", itemId: "door_hr" });
    s.advance(30_000);
    expect(s.of("welcome").at(-1)!.roomId).toBe("hr");
    expect(s.of("open_panel").some((p) => p.panel === "door")).toBe(false);
  });

  it("starts a job only from the recorded floor", () => {
    const s = setup();
    atElevatorPanel(s);
    s.transport.send({ type: "go_to", roomId: "lobby" });
    s.transport.send({ type: "start_job", repoId, goal: "x" });
    expect(s.of("error").at(-1)?.message).toContain("project's floor");
    expect(s.transport.started).toBe(false);
  });

  it("restart returns the user to the recorded floor", () => {
    const s = setup();
    atElevatorPanel(s);
    s.transport.send({ type: "go_to", roomId: "lobby" });
    s.transport.restart();
    expect(s.of("welcome").at(-1)!.roomId).toBe(floorRoom);
  });
});
