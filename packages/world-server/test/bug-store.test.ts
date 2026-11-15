import { appendFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BUG_GROUPS_MAX, BUG_SHOT_MAX_BYTES } from "@agentlife/shared";
import type { BugInput } from "@agentlife/shared";
import { bugFiles, createBugReporter, parseBugFile } from "@agentlife/shared/bugs-node";
import { createLeakScanner } from "@agentlife/shared/leaks";
import { BugStore, isAcceptableScreenshot } from "../src/bug-store.ts";
import type { BugChange } from "../src/bug-store.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "agentlife-bug-store-"));
});
afterEach(() => {
  vi.useRealTimers();
  rmSync(dir, { recursive: true, force: true });
});

const files = () => bugFiles({ AGENTLIFE_BUGS_FILE: join(dir, "bugs.jsonl") });
const mask = { secrets: [] as string[], repoRoot: "D:\\Kiroween", projectRoots: ["D:\\AgentHotel"], home: "C:\\Users\\someone" };
const store = (over: Partial<ConstructorParameters<typeof BugStore>[0]> = {}) => new BugStore({ files: files(), debounceMs: 0, mask, ...over });
const code = (over: Partial<BugInput> = {}): BugInput => ({ component: "code", process: "world-server", kind: "handler", message: "boom", ...over });
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const scan = (text: string) => {
  const s = createLeakScanner();
  s.scanText(text, "bugs");
  return s.findings;
};

describe("BugStore", () => {
  it("keeps a report in a file that a new store reads back", () => {
    const a = store();
    const { group } = a.record(code({ message: "Tile 1,2 blocked", context: { floor: "lobby" } }));
    a.record(code({ message: "Tile 3,4 blocked" }));
    const b = store();
    expect(b.get(group.id)).toMatchObject({ count: 2, status: "open", last: {} });
    expect(b.openCount()).toEqual({ game: 0, code: 1 });
    expect(parseBugFile(readFileSync(files().file, "utf8"))).toHaveLength(1);
  });

  it("writes through a temporary file that does not stay", () => {
    store().record(code());
    expect(readdirSync(dir)).toEqual(["bugs.jsonl"]);
  });

  it("waits for the debounce and writes the changes within it once", () => {
    vi.useFakeTimers();
    const s = store({ debounceMs: 500 });
    s.record(code({ message: "a" }));
    s.record(code({ message: "b" }));
    s.record(code({ message: "c" }));
    expect(existsSync(files().file)).toBe(false);
    vi.advanceTimersByTime(499);
    expect(existsSync(files().file)).toBe(false);
    vi.advanceTimersByTime(2);
    expect(parseBugFile(readFileSync(files().file, "utf8"))).toHaveLength(3);
  });

  it("flush writes at once and close writes what is left", () => {
    vi.useFakeTimers();
    const s = store({ debounceMs: 500 });
    s.record(code());
    expect(s.flush()).toBe(true);
    expect(existsSync(files().file)).toBe(true);
    s.record(code({ message: "later" }));
    s.close();
    expect(parseBugFile(readFileSync(files().file, "utf8"))).toHaveLength(2);
  });

  it("moves a damaged file aside and starts empty", () => {
    writeFileSync(files().file, "{not a bug file\n");
    const logs: string[] = [];
    const s = store({ now: () => 77, onLog: (m) => logs.push(m) });
    expect(s.list()).toEqual([]);
    expect(readFileSync(`${files().file}.bad-77`, "utf8")).toBe("{not a bug file\n");
    expect(logs[0]).toContain("moved aside");
    s.record(code());
    expect(existsSync(`${files().file}.bad-77`)).toBe(true);
  });

  it("masks every text, whoever sent it", () => {
    const token = `ghp_${"a1B2".repeat(10)}`;
    const email = ["someone", "example-corp.io"].join("@");
    const s = store();
    s.record({ component: "game", process: "client", kind: "manual", message: `crash ${token}`, stack: `Error\n    at f (D:\\Kiroween\\a.ts:1:1) ${email}`, note: "C:\\Users\\someone\\notes", context: { panel: "shop", floor: "D:\\AgentHotel\\p" } });
    const text = readFileSync(files().file, "utf8");
    expect(scan(text)).toEqual([]);
    expect(text).toContain("[github-token]");
    expect(text).toContain("<repo>");
    expect(text).not.toContain("AgentHotel\\\\p");
  });

  it("changes a status, keeps it, and reopens a fixed group that comes back", () => {
    const s = store();
    const id = s.record(code()).group.id;
    expect(s.setStatus(id, "fixed")?.status).toBe("fixed");
    expect(store().get(id)?.status).toBe("fixed");
    expect(s.record(code()).reopened).toBe(true);
    expect(s.get(id)).toMatchObject({ status: "open", reopened: 1 });
    expect(s.setStatus(id, "ignored")?.status).toBe("ignored");
    expect(s.record(code()).group.status).toBe("ignored");
    expect(s.setStatus("0123456789abcdef", "fixed")).toBeUndefined();
  });

  it("tells a listener what changed, and a listener that throws changes nothing", () => {
    const s = store();
    const seen: BugChange["kind"][] = [];
    s.onChange((c) => seen.push(c.kind));
    s.onChange(() => {
      throw new Error("bad listener");
    });
    const id = s.record(code()).group.id;
    s.record(code());
    s.setStatus(id, "fixed");
    s.record(code());
    s.setStatus(id, "fixed");
    s.setStatus(id, "fixed");
    expect(seen).toEqual(["new", "repeat", "status", "reopened", "status"]);
    expect(s.get(id)?.count).toBe(3);
  });

  it("summaries have no samples and follow the filters", () => {
    const s = store();
    s.record({ component: "game", process: "client", kind: "uncaught", message: "pixi" });
    s.record(code({ message: "docker" }));
    expect(s.summaries({ component: "game" })).toHaveLength(1);
    expect("samples" in s.summaries()[0]!).toBe(false);
    expect(s.summaries({ search: "dock" })[0]?.message).toBe("docker");
  });

  it("recordError builds a world-server report and never throws", () => {
    const s = store();
    s.recordError("uncaught", new TypeError("x is undefined"), { task: "task-1" });
    s.recordError("handler", undefined);
    s.recordError("handler", { weird: true });
    const [a] = s.list({ search: "x is undefined" });
    expect(a).toMatchObject({ component: "code", process: "world-server", kind: "uncaught", message: "TypeError: x is undefined", last: { task: "task-1" } });
    expect(s.list().length).toBe(2);
  });

  it("keeps at most 500 groups", () => {
    // Debounced: 503 records write the file once, not 503 times (with a write per record the test ran out of time under load).
    const s = store({ debounceMs: 60_000 });
    const letters = (i: number) => String.fromCharCode(97 + (i % 26), 97 + (Math.floor(i / 26) % 26), 97 + Math.floor(i / 676));
    for (let i = 0; i < BUG_GROUPS_MAX + 3; i++) s.record(code({ message: `bug ${letters(i)}` }), { at: 1000 + i });
    expect(s.list()).toHaveLength(BUG_GROUPS_MAX);
  });

  it("a failed write is kept in memory and written at the next flush", () => {
    const logs: string[] = [];
    // The folder of the file is a regular file for now, so every write fails.
    const blocker = join(dir, "blocker");
    writeFileSync(blocker, "x");
    const f = { ...files(), file: join(blocker, "bugs.jsonl") };
    const s = new BugStore({ files: f, debounceMs: 0, mask, onLog: (m) => logs.push(m) });
    s.record(code());
    s.record(code({ message: "again" }));
    expect(s.list()).toHaveLength(2);
    expect(logs).toHaveLength(1);
    rmSync(blocker);
    expect(s.flush()).toBe(true);
    expect(parseBugFile(readFileSync(f.file, "utf8"))).toHaveLength(2);
  });
});

describe("screenshots", () => {
  it("accepts a PNG up to the limit and nothing else", () => {
    expect(isAcceptableScreenshot(PNG)).toBe(true);
    expect(isAcceptableScreenshot(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]))).toBe(false);
    expect(isAcceptableScreenshot(new Uint8Array(8))).toBe(false);
    const big = new Uint8Array(BUG_SHOT_MAX_BYTES + 1);
    big.set(PNG);
    expect(isAcceptableScreenshot(big)).toBe(false);
    big.fill(0, 0).set(PNG);
    expect(isAcceptableScreenshot(big.subarray(0, BUG_SHOT_MAX_BYTES))).toBe(true);
  });

  it("stores the picture of a sample and says so", () => {
    const s = store();
    const { group } = s.record({ component: "game", process: "client", kind: "manual", message: "it froze" }, { screenshot: PNG });
    const sample = group.samples[0]!;
    expect(sample.shot).toBe(true);
    expect([...readFileSync(s.screenshotPath(sample.id))]).toEqual([...PNG]);
  });

  it("keeps the report but not a picture that is not a PNG", () => {
    const s = store();
    const { group } = s.record({ component: "game", process: "client", kind: "manual", message: "it froze" }, { screenshot: new Uint8Array(20) });
    expect(group.samples[0]?.shot).toBe(false);
    expect(existsSync(s.screenshotPath(group.samples[0]!.id))).toBe(false);
  });

  it("removes a picture when its sample leaves the group", () => {
    const s = store();
    const first = s.record({ component: "game", process: "client", kind: "manual", message: "froze" }, { screenshot: PNG }).group.samples[0]!;
    for (let i = 0; i < 5; i++) s.record({ component: "game", process: "client", kind: "manual", message: "froze" });
    expect(existsSync(s.screenshotPath(first.id))).toBe(false);
  });
});

describe("the inbox", () => {
  const reporter = (now = 5000) => createBugReporter({ process: "agent-engine", files: files(), now: () => now, mask });

  it("takes in what other processes appended, then empties the inbox", () => {
    reporter(5000).report({ kind: "step-error", message: "failed at step 3", context: { task: "task-1" } });
    reporter(6000).report({ kind: "step-error", message: "failed at step 4" });
    reporter(7000).error("docker", new Error("docker is gone"));
    const s = store();
    expect(s.drainInbox()).toBe(3);
    expect(s.list()).toHaveLength(2);
    expect(s.list({ search: "failed at step" })[0]).toMatchObject({ count: 2, firstSeen: 5000, lastSeen: 6000, process: "agent-engine" });
    expect(existsSync(files().inbox)).toBe(false);
    expect(existsSync(files().draining)).toBe(false);
    expect(store().list()).toHaveLength(2);
    expect(s.drainInbox()).toBe(0);
  });

  it("reads a leftover .draining file first, then the new inbox", () => {
    reporter(1000).report({ kind: "step-error", message: "old one" });
    writeFileSync(files().draining, readFileSync(files().inbox));
    rmSync(files().inbox);
    reporter(2000).report({ kind: "step-error", message: "new one" });
    const s = store();
    expect(s.drainInbox()).toBe(1);
    expect(s.list().map((g) => g.message)).toEqual(["old one"]);
    expect(s.drainInbox()).toBe(1);
    expect(s.list().map((g) => g.message).sort()).toEqual(["new one", "old one"]);
  });

  it("skips lines that are not valid", () => {
    reporter().report({ kind: "step-error", message: "good" });
    appendFileSync(files().inbox, "garbage\n");
    const logs: string[] = [];
    const s = store({ onLog: (m) => logs.push(m) });
    expect(s.drainInbox()).toBe(1);
    expect(logs[0]).toContain("1 line(s)");
  });

  it("keeps the draining file until the groups are saved, and counts nothing twice", () => {
    reporter().report({ kind: "step-error", message: "kept" });
    const blocker = join(dir, "blocker");
    writeFileSync(blocker, "x");
    const f = { ...files(), file: join(blocker, "bugs.jsonl") };
    const s = new BugStore({ files: f, debounceMs: 0, mask, onLog: () => undefined });
    expect(s.drainInbox()).toBe(1);
    expect(existsSync(f.draining)).toBe(true);
    expect(s.drainInbox()).toBe(0);
    rmSync(blocker);
    expect(s.drainInbox()).toBe(0);
    expect(existsSync(f.draining)).toBe(false);
    expect(s.get(s.list()[0]!.id)?.count).toBe(1);
    expect(parseBugFile(readFileSync(f.file, "utf8"))).toHaveLength(1);
  });

  it("masks what a hand-written inbox line holds", () => {
    const token = `ghp_${"a1B2".repeat(10)}`;
    writeFileSync(files().inbox, `${JSON.stringify({ at: 9, report: { component: "code", process: "session", kind: "session-failed", message: `leak ${token}` } })}\n`);
    const s = store();
    s.drainInbox();
    expect(scan(readFileSync(files().file, "utf8"))).toEqual([]);
  });

  it("startDraining reads at once and then on a timer", () => {
    vi.useFakeTimers();
    const s = store();
    reporter().report({ kind: "step-error", message: "first" });
    const stop = s.startDraining(1000);
    expect(s.list()).toHaveLength(1);
    reporter().report({ kind: "step-error", message: "second" });
    vi.advanceTimersByTime(1000);
    expect(s.list()).toHaveLength(2);
    stop();
    reporter().report({ kind: "step-error", message: "third" });
    vi.advanceTimersByTime(5000);
    expect(s.list()).toHaveLength(2);
  });
});
