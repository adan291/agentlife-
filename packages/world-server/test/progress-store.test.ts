import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ProgressFact } from "@agentlife/shared";
import { ProgressStore, defaultProgressFile, loadProgressConfig } from "../src/progress-store.ts";

let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "agentlife-progress-"));
  file = join(dir, "progress.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const SINCE = 1000;
const config = loadProgressConfig();
const store = (extra: { onLog?: (m: string) => void } = {}) => new ProgressStore({ file, config, now: () => SINCE, ...extra });
const fact = (source: ProgressFact["source"], ref: string, ts = SINCE + 1): ProgressFact => ({ source, ref, ts });
const DEV = "alpha/developer";

describe("config/progress.json", () => {
  it("is valid and pays the sources of the spec", () => {
    expect(config.xp.step_done.member).toBeGreaterThan(0);
    expect(config.xp.job_passed.user).toBeGreaterThan(0);
    expect(config.xp.branch_delivered.user).toBeGreaterThan(0);
  });

  it("uses AGENTLIFE_PROGRESS_FILE when it is set", () => {
    expect(defaultProgressFile({ AGENTLIFE_PROGRESS_FILE: "x.json" })).toBe("x.json");
    expect(defaultProgressFile({}).endsWith("progress.json")).toBe(true);
  });
});

describe("ProgressStore", () => {
  it("writes the file at once, so the start moment survives a restart", () => {
    store();
    expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({ version: 1, since: SINCE, members: {}, counted: [] });
    expect(new ProgressStore({ file, config, now: () => 5000 }).since).toBe(SINCE);
  });

  it("adds XP once per fact and reports the levels that went up", () => {
    const s = store();
    const first = s.record(fact("job_passed", "t1"), [DEV]);
    expect(first.changed).toBe(true);
    expect(s.view().user.xp).toBe(config.xp.job_passed.user);
    expect(s.view().members[0]).toMatchObject({ projectId: "alpha", memberId: "developer", xp: config.xp.job_passed.member });
    expect(s.record(fact("job_passed", "t1"), [DEV])).toEqual({ changed: false, levelUps: [] });
    expect(s.view().user.xp).toBe(config.xp.job_passed.user);
  });

  it("levels up the member whose XP crosses a threshold", () => {
    const s = store();
    let ups = 0;
    for (let i = 0; i < 6; i++) ups += s.record(fact("step_done", `t${i}.developer`), [DEV]).levelUps.length;
    expect(s.view().members[0]?.xp).toBe(6 * config.xp.step_done.member!);
    expect(s.view().members[0]?.level).toBe(1);
    expect(ups).toBe(1);
  });

  it("counts nothing that happened before the file was made", () => {
    const s = store();
    expect(s.record(fact("job_passed", "old", SINCE - 1), [DEV]).changed).toBe(false);
    expect(s.view().user.xp).toBe(0);
  });

  it("survives a restart, and a replay of the same facts adds nothing", () => {
    const a = store();
    a.record(fact("job_passed", "t1"), [DEV]);
    a.record(fact("branch_delivered", "t1"), []);
    const before = a.view();
    const b = store();
    expect(b.view()).toEqual(before);
    expect(b.record(fact("job_passed", "t1"), [DEV]).changed).toBe(false);
    expect(b.record(fact("branch_delivered", "t1"), []).changed).toBe(false);
    expect(b.view()).toEqual(before);
  });

  it("moves a file it cannot read aside and starts empty, without overwriting the old one", () => {
    writeFileSync(file, "{ not json");
    const logs: string[] = [];
    const s = store({ onLog: (m) => logs.push(m) });
    expect(s.view().user.xp).toBe(0);
    expect(logs.join("\n")).toContain("moved aside");
    const aside = readdirSync(dir).filter((f) => f.startsWith("progress.json.bad-"));
    expect(aside).toHaveLength(1);
    expect(readFileSync(join(dir, aside[0]!), "utf8")).toBe("{ not json");
    expect(existsSync(file)).toBe(true);
  });

  it("moves a file that fails the schema aside too", () => {
    writeFileSync(file, JSON.stringify({ version: 1, since: 0, user: { xp: -4 }, members: {}, counted: [] }));
    store();
    expect(readdirSync(dir).some((f) => f.startsWith("progress.json.bad-"))).toBe(true);
  });

  it("undoes the change in memory when the file cannot be written", () => {
    const logs: string[] = [];
    // A file where a folder should be makes every write fail.
    writeFileSync(join(dir, "blocker"), "");
    const broken = new ProgressStore({ file: join(dir, "blocker", "progress.json"), config, now: () => SINCE, onLog: (m) => logs.push(m) });
    expect(broken.record(fact("job_passed", "t1"), [DEV])).toEqual({ changed: false, levelUps: [] });
    expect(broken.view().user.xp).toBe(0);
    expect(logs.some((m) => m.includes("cannot write"))).toBe(true);
  });
});
