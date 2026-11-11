import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BuildBoardSchema, CrewEventSchema } from "@agentlife/shared";
import {
  applyPhase,
  parseSessionLog,
  parseTaskmap,
  parseTasks,
  parseVerdict,
  readBuildBoard,
  readVerifyReport,
  waitingFirst,
} from "../src/build-board.ts";
import { createCrewRelay } from "../src/crew.ts";
import { startEngine, type Engine } from "../src/engine.ts";

const TASKMAP = [
  "# TASKMAP",
  "| # | Spec | Sessions | Live | Status | What it gives the user |",
  "|---|---|---|---|---|---|",
  "| 1 | `project-registry` | S14 | yes | needs-check | Reception |",
  "| 2 | `hotel-floors` | S15 S16 | yes | done | Lobby |",
  "| 3 | `build-board` | S15B | no | todo | Construction board |",
  "| 4 | `../evil` | S1 | no | todo | path trick |",
  "| x | `bad-number` | S1 | no | todo | not a row |",
  "| 5 | `old` | S2 | no | skip | skipped |",
  "| 6 | `short` |",
].join("\n");

const LOG = [
  "# Session log",
  "| S14 | 2026-11-11 21:07 | claude-sonnet-5.5 | medium | 32.9 | ok | data/sessions/a.jsonl |",
  "| S15 | 2026-11-11 22:54 | claude-sonnet-5.5 | medium | 23.0 | failed | data/sessions/b.jsonl |",
  "| Sxx | broken | line |",
  "| S16 | 2026-11-11 23:11 | auto | low | nope | ok | c |",
].join("\n");

describe("parsers", () => {
  it("reads TASKMAP rows and skips malformed ones and path tricks", () => {
    const rows = parseTaskmap(TASKMAP);
    expect(rows.map((r) => r.spec)).toEqual(["project-registry", "hotel-floors", "build-board", "old"]);
    expect(rows.map((r) => r.status)).toEqual(["waits_for_you", "merged", "todo", "skipped"]);
    expect(rows[1]).toMatchObject({ number: 2, sessions: ["S15", "S16"], live: true, purpose: "Lobby" });
    expect(rows[0]?.reason).toMatch(/HUMAN-CHECKS/);
    expect(rows[2]?.sessions).toEqual(["S15B"]);
  });

  it("reads checkboxes of top-level tasks only", () => {
    const t = parseTasks("# Plan\n\n- [x] 1. Engine: data\n  - [ ] sub item\n- [ ] 2. World\n- [x] 3 Third\nnot a task\n");
    expect(t).toEqual({
      tasks: [
        { number: "1", title: "Engine: data", done: true },
        { number: "2", title: "World", done: false },
        { number: "3", title: "Third", done: true },
      ],
      done: 2,
      total: 3,
    });
    expect(parseTasks("")).toEqual({ tasks: [], done: 0, total: 0 });
    expect(parseTasks("\u0000garbage \n- [x]").total).toBe(0);
  });

  it("reads the session log, keeps the last 10 and ignores broken lines", () => {
    const s = parseSessionLog(LOG);
    expect(s.map((x) => x.session)).toEqual(["S14", "S15"]);
    expect(s[0]).toEqual({ session: "S14", date: "2026-11-11 21:07", model: "claude-sonnet-5.5", minutes: 32.9, status: "ok" });
    const many = Array.from({ length: 14 }, (_, i) => `| S${i + 1} | d | m | low | 1 | ok | f |`).join("\n");
    const last = parseSessionLog(many);
    expect(last).toHaveLength(10);
    expect(last[9]?.session).toBe("S14");
  });

  it("reads the verdict from the first line only", () => {
    expect(parseVerdict("VERDICT: PASS\n\nbody")).toBe("PASS");
    expect(parseVerdict("VERDICT: FAIL")).toBe("FAIL");
    expect(parseVerdict("\nVERDICT: PASS")).toBe("none");
    expect(parseVerdict("VERDICT: MAYBE")).toBe("none");
    expect(parseVerdict("")).toBe("none");
  });
});

describe("phase to board state", () => {
  const rows = parseTaskmap(TASKMAP);
  const at = 1;

  it("marks the running spec and the verifying spec", () => {
    expect(applyPhase(rows, { text: "session S15B", spec: "build-board", at }).find((r) => r.spec === "build-board")?.status).toBe("running");
    expect(applyPhase(rows, { text: "verify", spec: "build-board", at }).find((r) => r.spec === "build-board")?.status).toBe("verifying");
    expect(applyPhase(rows, { text: "fix 2", spec: "build-board", at }).find((r) => r.spec === "build-board")?.status).toBe("running");
  });

  it("a stop waits for the user with its reason and goes to the top; merged rows stay merged", () => {
    const stopped = applyPhase(rows, { text: "stopped: pnpm check fails", spec: "build-board", at });
    const row = stopped.find((r) => r.spec === "build-board");
    expect(row).toMatchObject({ status: "waits_for_you", reason: "pnpm check fails" });
    expect(waitingFirst(stopped).slice(0, 2).map((r) => r.spec)).toEqual(["project-registry", "build-board"]);
    expect(applyPhase(rows, { text: "review", spec: "hotel-floors", at }).find((r) => r.spec === "hotel-floors")?.status).toBe("merged");
  });

  it("done and a phase without a spec change nothing", () => {
    expect(applyPhase(rows, { text: "done", spec: "build-board", at })).toEqual(rows);
    expect(applyPhase(rows, { text: "merge", at })).toEqual(rows);
  });
});

describe("crew relay phase events", () => {
  function harness() {
    const out: Record<string, unknown>[] = [];
    let t = 0;
    const relay = createCrewRelay({ append: (ev) => out.push(ev as Record<string, unknown>), now: () => (t += 10) });
    return { relay, out };
  }

  it("accepts the phase kind in the schema", () => {
    expect(CrewEventSchema.safeParse({ kind: "phase", session: "conduct", phase: "review", spec: "x" }).success).toBe(true);
    expect(CrewEventSchema.safeParse({ kind: "phase", session: "conduct", phase: "x".repeat(81) }).success).toBe(false);
  });

  it("stores the phase and makes the Builder work and say it", () => {
    const { relay, out } = harness();
    relay.handle({ kind: "phase", session: "conduct", phase: "verify", spec: "build-board" });
    expect(relay.phase()).toMatchObject({ text: "verify", spec: "build-board" });
    const says = out.filter((e) => e["type"] === "agent.say");
    expect(says.map((e) => e["text"])).toEqual(["verify"]);
    expect(out.some((e) => e["type"] === "agent.state_changed" && e["state"] === "working" && e["agentId"] === "builder")).toBe(true);
    expect(out.every((e) => String(e["taskId"]).startsWith("build:"))).toBe(true);
  });

  it("a stop sends the Builder home with an error flash; done sends it home", () => {
    const { relay, out } = harness();
    relay.handle({ kind: "phase", session: "conduct", phase: "stopped: tests", spec: "x" });
    expect(out.some((e) => e["type"] === "agent.state_changed" && e["state"] === "error")).toBe(true);
    expect(out.some((e) => e["type"] === "agent.goto" && e["anchor"] === "home")).toBe(true);
    expect(relay.phase()?.text).toBe("stopped: tests");
    relay.handle({ kind: "phase", session: "conduct", phase: "done" });
    expect(relay.phase()?.text).toBe("done");
  });

  it("ignores an empty phase and drops a spec that is not a valid name", () => {
    const { relay, out } = harness();
    relay.handle({ kind: "phase", session: "conduct", phase: "  " });
    expect(out).toEqual([]);
    relay.handle({ kind: "phase", session: "conduct", phase: "review", spec: "../x" });
    expect(relay.phase()?.spec).toBeUndefined();
  });
});

describe("readBuildBoard", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  function fixture(): string {
    const root = mkdtempSync(path.join(os.tmpdir(), "al-board-"));
    dirs.push(root);
    mkdirSync(path.join(root, "docs", "reviews"), { recursive: true });
    mkdirSync(path.join(root, ".kiro", "specs", "hotel-floors"), { recursive: true });
    mkdirSync(path.join(root, "data", "sessions"), { recursive: true });
    writeFileSync(path.join(root, "docs", "TASKMAP.md"), TASKMAP);
    writeFileSync(path.join(root, ".kiro", "specs", "hotel-floors", "tasks.md"), "- [x] 1. One\n- [ ] 2. Two\n");
    writeFileSync(path.join(root, "docs", "reviews", "feat-hotel-floors-verify.md"), "VERDICT: PASS\n\n# Report\n");
    writeFileSync(path.join(root, "data", "sessions", "log.md"), LOG);
    return root;
  }

  it("builds a valid board from the files", () => {
    const board = readBuildBoard(fixture(), undefined);
    expect(BuildBoardSchema.safeParse(board).success).toBe(true);
    expect(board.rows[0]?.spec).toBe("project-registry");
    const floors = board.specs.find((s) => s.spec === "hotel-floors");
    expect(floors).toMatchObject({ done: 1, total: 2, verdict: "PASS" });
    expect(board.specs.find((s) => s.spec === "build-board")).toMatchObject({ total: 0, verdict: "none" });
    expect(board.sessions).toHaveLength(2);
  });

  it("returns empty sections when the files are missing", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "al-board-"));
    dirs.push(root);
    expect(readBuildBoard(root, undefined)).toEqual({ rows: [], specs: [], sessions: [] });
  });

  it("reads verify reports only for valid spec names", () => {
    const root = fixture();
    expect(readVerifyReport(root, "hotel-floors")).toContain("VERDICT: PASS");
    for (const bad of ["../TASKMAP", "..\\x", "a/b", "A", "", "hotel floors", "x".repeat(41)]) expect(readVerifyReport(root, bad)).toBe("");
  });
});

describe("GET /build/board", () => {
  const engines: Engine[] = [];
  const tmp: string[] = [];
  afterEach(async () => {
    for (const e of engines.splice(0)) await e.close();
    for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("serves the board of this repository, the phase and the report of a spec", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "agentlife-board-"));
    tmp.push(dir);
    const engine = await startEngine({ storeOptions: { dbPath: ":memory:", runsDir: dir }, port: 0 });
    engines.push(engine);
    const base = `http://127.0.0.1:${engine.port}`;
    const res = await fetch(`${base}/build/board`);
    expect(res.status).toBe(200);
    const first = BuildBoardSchema.parse(await res.json());
    expect(first.phase).toBeUndefined();
    await fetch(`${base}/crew/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "phase", session: "conduct", phase: "review", spec: "build-board" }),
    });
    const second = BuildBoardSchema.parse(await (await fetch(`${base}/build/board`)).json());
    expect(second.phase).toMatchObject({ text: "review", spec: "build-board" });
    expect((await fetch(`${base}/build/verify/${encodeURIComponent("../x")}`)).status).toBe(404);
    expect((await fetch(`${base}/build/verify/nope-nothing`)).status).toBe(404);
  });
});
