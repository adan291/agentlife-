import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BugBook } from "../../packages/shared/src/bugs.ts";
import type { BugInput } from "../../packages/shared/src/bugs.ts";
import { bugFiles, createBugReporter, serializeBugFile, writeTextAtomic } from "../../packages/shared/src/bugs-node.ts";
import { bugsCommand, parseBugsArgs, readBugBook } from "../bugs.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "agentlife-bugs-cli-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const files = () => bugFiles({ AGENTLIFE_BUGS_FILE: join(dir, "bugs.jsonl") });
const code = (over: Partial<BugInput> = {}): BugInput => ({ component: "code", process: "agent-engine", kind: "step-error", message: "boom", ...over });
const game = (over: Partial<BugInput> = {}): BugInput => ({ component: "game", process: "client", kind: "uncaught", message: "pixi crashed", ...over });

/** A bugs.jsonl with a code bug, a game bug and a fixed code bug. */
function seed(): void {
  const book = new BugBook();
  const stack = "Error: x\n    at run (steps/develop.ts:9:9)";
  book.record(code({ message: "develop failed", context: { task: "task-1", step: "develop" }, stack }), Date.UTC(2026, 10, 15, 10, 0), "ba001");
  book.record(code({ message: "develop failed", context: { task: "task-1", step: "develop" }, stack }), Date.UTC(2026, 10, 15, 11, 0), "ba002");
  book.record(game({ context: { floor: "lobby", panel: "shop" } }), Date.UTC(2026, 10, 15, 12, 0), "ba003");
  const old = book.record(code({ kind: "docker", message: "docker is gone" }), Date.UTC(2026, 10, 15, 9, 0), "ba004").group;
  book.setStatus(old.id, "fixed");
  writeTextAtomic(files().file, serializeBugFile(book.all(), 1));
}

describe("parseBugsArgs", () => {
  it("reads the flags", () => {
    expect(parseBugsArgs([])).toEqual({ all: false, md: false });
    expect(parseBugsArgs(["--all", "--md", "--component", "game"])).toEqual({ all: true, md: true, component: "game" });
    expect(parseBugsArgs(["--component=code"])).toEqual({ all: false, md: false, component: "code" });
  });

  it("refuses what it does not know", () => {
    expect(parseBugsArgs(["--nope"])).toEqual({ error: 'unknown argument "--nope"' });
    expect(parseBugsArgs(["--component", "web"])).toEqual({ error: '--component needs game or code, not "web"' });
    expect(parseBugsArgs(["--component"])).toEqual({ error: '--component needs game or code, not ""' });
  });
});

describe("pnpm run bugs", () => {
  it("lists the open groups, newest first, with where and the first frame", () => {
    seed();
    const { code: exit, out } = bugsCommand([], files());
    expect(exit).toBe(0);
    expect(out).toContain("Open bugs (2)");
    expect(out.indexOf("pixi crashed")).toBeLessThan(out.indexOf("develop failed"));
    expect(out).toContain("game/client  uncaught  x1  open");
    expect(out).toContain("code/agent-engine  step-error  x2  open");
    expect(out).toContain("where: floor lobby, panel shop");
    expect(out).toContain("where: task task-1, step develop");
    expect(out).toContain("at run@develop.ts");
    expect(out).not.toContain("docker is gone");
  });

  it("--all adds fixed and ignored groups, --component narrows", () => {
    seed();
    expect(bugsCommand(["--all"], files()).out).toContain("docker is gone");
    const onlyGame = bugsCommand(["--component", "game"], files()).out;
    expect(onlyGame).toContain("Open bugs (1)");
    expect(onlyGame).not.toContain("develop failed");
    expect(bugsCommand(["--all", "--component", "code"], files()).out).toContain("Bugs (2)");
  });

  it("--md prints Markdown to paste into a chat", () => {
    seed();
    const { out } = bugsCommand(["--md"], files());
    expect(out).toContain("# Open bugs (2)");
    expect(out).toContain("## [code/agent-engine] step-error: develop failed");
    expect(out).toContain("where: task `task-1`, step `develop`");
  });

  it("says so when there is nothing", () => {
    expect(bugsCommand([], files())).toEqual({ code: 0, out: "No open bugs.\n" });
    expect(bugsCommand(["--all"], files()).out).toBe("No bugs.\n");
    expect(bugsCommand(["--md"], files()).out).toBe("# Open bugs (0)\n");
  });

  it("exits with 2 and the usage for an unknown flag", () => {
    const r = bugsCommand(["--wat"], files());
    expect(r.code).toBe(2);
    expect(r.out).toContain("Usage: pnpm run bugs");
  });

  it("shows what is still in the inbox, and never writes anything", () => {
    seed();
    const f = files();
    createBugReporter({ process: "conductor", files: f, now: () => Date.UTC(2026, 10, 15, 13, 0), mask: { secrets: [] } }).report({ kind: "conductor-stop", message: "session S9 did not finish", context: { spec: "bug-sack" } });
    writeFileSync(f.draining, `${JSON.stringify({ at: Date.UTC(2026, 10, 15, 8, 0), report: code({ message: "left over" }) })}\n`);
    const before = Object.fromEntries(readdirSync(dir).map((n) => [n, readFileSync(join(dir, n), "utf8")]));
    const { out } = bugsCommand([], f);
    expect(out).toContain("Open bugs (4)");
    expect(out).toContain("code/conductor  conductor-stop");
    expect(out).toContain("where: spec bug-sack");
    expect(out).toContain("left over");
    const after = Object.fromEntries(readdirSync(dir).map((n) => [n, readFileSync(join(dir, n), "utf8")]));
    expect(after).toEqual(before);
  });

  it("warns about an unreadable file, leaves it where it is and still shows the inbox", () => {
    const f = files();
    writeFileSync(f.file, "not a bug file\n");
    createBugReporter({ process: "session", files: f, mask: { secrets: [] } }).report({ kind: "session-failed", message: "S1 failed" });
    const { code: exit, out } = bugsCommand([], f);
    expect(exit).toBe(0);
    expect(out).toContain("warning:");
    expect(out).toContain("S1 failed");
    expect(readFileSync(f.file, "utf8")).toBe("not a bug file\n");
    expect(readdirSync(dir).some((n) => n.includes(".bad-"))).toBe(false);
  });

  it("groups inbox reports with the same error", () => {
    const f = files();
    const bugs = createBugReporter({ process: "agent-engine", files: f, mask: { secrets: [] } });
    for (let i = 0; i < 3; i++) bugs.report({ kind: "step-error", message: `step ${i} failed` });
    expect(readBugBook(f).openCount()).toEqual({ game: 0, code: 1 });
    expect(bugsCommand([], f).out).toContain("x3");
  });
});
