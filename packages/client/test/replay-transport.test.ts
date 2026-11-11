import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RunExportSchema, ServerMsgSchema, validateRoom } from "@agentlife/shared";
import type { RoomDef, RunExport, ServerMsg } from "@agentlife/shared";
import { REPLAY_REJECT_NOTE, ReplayTransport } from "../src/replay/transport.ts";

const here = dirname(fileURLToPath(import.meta.url));
const room: RoomDef = validateRoom(JSON.parse(readFileSync(join(here, "..", "..", "world-server", "rooms", "office.json"), "utf8")));
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
    expect(msgs.at(-1)?.type).toBe("welcome");
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
