import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  BUG_GROUPS_MAX,
  BUG_SAMPLES_MAX,
  BugBook,
  BugGroupSchema,
  BugInputSchema,
  ClientMsgSchema,
  ServerMsgSchema,
  bugFingerprint,
  bugSummary,
  firstBugFrame,
  groupsToMarkdown,
  normalizeBugMessage,
} from "../src/index.ts";
import type { BugInput } from "../src/index.ts";

const input = (over: Partial<BugInput> = {}): BugInput => ({ component: "code", process: "agent-engine", kind: "step-error", message: "boom", ...over });

describe("normalizeBugMessage", () => {
  it("takes numbers, ids, times and URL queries out and keeps the words", () => {
    expect(normalizeBugMessage("Tile 12,40 is blocked")).toBe("Tile #,# is blocked");
    expect(normalizeBugMessage("task-25942b7f failed at 2026-11-15T10:02:03.123Z")).toBe("task-<id> failed at <time>");
    expect(normalizeBugMessage("job 3f2b8c1e-1111-4222-8333-444455556666 stopped")).toBe("job <id> stopped");
    expect(normalizeBugMessage("GET http://localhost:5173/src/a.ts?t=1731 failed")).toBe("GET http://localhost:#/src/a.ts failed");
    expect(normalizeBugMessage("Cannot read properties of undefined (reading 'x')")).toBe("Cannot read properties of undefined (reading 'x')");
  });

  it("uses the first line only", () => {
    expect(normalizeBugMessage("first 1\nsecond 2")).toBe("first #");
  });

  it("treats a long plain number as a number, not as an id", () => {
    expect(normalizeBugMessage("id 123456789")).toBe(normalizeBugMessage("id 12"));
  });
});

describe("firstBugFrame", () => {
  it("reads V8 frames without line, column or query", () => {
    expect(firstBugFrame("Error: x\n    at draw (http://localhost:5173/src/scene/room.ts?t=17:12:5)\n    at other (a.ts:1:1)")).toBe("draw@room.ts");
    expect(firstBugFrame("Error: x\n    at file:///D:/repo/src/main.ts:4:9")).toBe("@main.ts");
    expect(firstBugFrame("Error: x\n    at async Runner.drive (D:\\repo\\src\\jobs\\runner.ts:410:11)")).toBe("Runner.drive@runner.ts");
  });

  it("reads Firefox and Safari frames", () => {
    expect(firstBugFrame("draw@http://localhost:5173/src/scene/room.ts:12:5\nother@x.js:1:1")).toBe("draw@room.ts");
  });

  it("drops the hash Vite puts in a built file name, but not a word", () => {
    expect(firstBugFrame("Error: x\n    at f (https://x.test/assets/index-AbC123de.js:1:2)")).toBe("f@index.js");
    expect(firstBugFrame("Error: x\n    at f (https://x.test/assets/my-component.js:1:2)")).toBe("f@my-component.js");
  });

  it("gives an empty string without a frame", () => {
    expect(firstBugFrame(undefined)).toBe("");
    expect(firstBugFrame("Error: only a message")).toBe("");
  });
});

describe("bugFingerprint", () => {
  it("is 16 hex characters and stable", () => {
    const id = bugFingerprint(input());
    expect(id).toMatch(/^[0-9a-f]{16}$/);
    expect(bugFingerprint(input())).toBe(id);
  });

  it("tells component, process, kind and message apart", () => {
    const base = bugFingerprint(input());
    expect(bugFingerprint(input({ component: "game" }))).not.toBe(base);
    expect(bugFingerprint(input({ process: "world-server" }))).not.toBe(base);
    expect(bugFingerprint(input({ kind: "docker" }))).not.toBe(base);
    expect(bugFingerprint(input({ message: "bang" }))).not.toBe(base);
    expect(bugFingerprint(input({ stack: "Error: boom\n    at f (a.ts:1:1)" }))).not.toBe(base);
  });

  it("puts the same error with other numbers, ids and line numbers in one group", () => {
    fc.assert(
      fc.property(fc.nat(), fc.nat(), fc.nat(), fc.nat(), fc.nat(), fc.stringMatching(/^[0-9a-f]{8}$/), (a, b, c, d, e, hex) => {
        const make = (x: number, y: number, line: number, col: number, id: string): BugInput =>
          input({ message: `Tile ${x},${y} is blocked for task-${id} after ${line} ms`, stack: `Error: x\n    at walk (http://localhost:5173/src/sim.ts?t=${x}:${line}:${col})` });
        // A hex id of letters only is not an id (see normalizeBugMessage); the property is about ids with a digit.
        const id = `1${hex.slice(1)}`;
        expect(bugFingerprint(make(a, b, c, d, id))).toBe(bugFingerprint(make(b, a, d, e, `2${hex.slice(1)}`)));
      }),
    );
  });
});

describe("BugBook", () => {
  it("groups repeats, counts them and keeps the last context", () => {
    const book = new BugBook();
    const first = book.record(input({ message: "Tile 1,2 blocked", context: { floor: "lobby" } }), 1000, "ba001");
    expect(first).toMatchObject({ created: true, reopened: false });
    const again = book.record(input({ message: "Tile 7,8 blocked", context: { floor: "project:a", panel: "report" } }), 2000, "ba002");
    expect(again.created).toBe(false);
    expect(book.size).toBe(1);
    expect(again.group).toMatchObject({ count: 2, firstSeen: 1000, lastSeen: 2000, last: { floor: "project:a", panel: "report" }, message: "Tile 1,2 blocked" });
    expect(again.group.samples.map((s) => s.id)).toEqual(["ba001", "ba002"]);
  });

  it("keeps at most 5 samples and says which ones left", () => {
    const book = new BugBook();
    const dropped: string[] = [];
    for (let i = 0; i < 8; i++) dropped.push(...book.record(input(), 1000 + i, `bs${i}`).dropped);
    expect(dropped).toEqual(["bs0", "bs1", "bs2"]);
    const [g] = book.all();
    expect(g?.samples).toHaveLength(BUG_SAMPLES_MAX);
    expect(g?.count).toBe(8);
  });

  it("reopens a fixed group that happens again and keeps an ignored one ignored", () => {
    const book = new BugBook();
    const id = book.record(input(), 1000, "ba1").group.id;
    book.setStatus(id, "fixed");
    const again = book.record(input(), 2000, "ba2");
    expect(again.reopened).toBe(true);
    expect(again.group).toMatchObject({ status: "open", reopened: 1 });
    book.setStatus(id, "ignored");
    const third = book.record(input(), 3000, "ba3");
    expect(third.reopened).toBe(false);
    expect(third.group).toMatchObject({ status: "ignored", count: 3, reopened: 1 });
  });

  it("returns undefined for a status change of an unknown group", () => {
    expect(new BugBook().setStatus("0123456789abcdef", "fixed")).toBeUndefined();
  });

  it("evicts fixed and ignored groups first, the oldest of them, and never the new group", () => {
    const book = new BugBook();
    const ids: string[] = [];
    for (let i = 0; i < BUG_GROUPS_MAX; i++) ids.push(book.record(input({ message: `bug ${String.fromCharCode(97 + (i % 26))}${"x".repeat(Math.floor(i / 26))}` }), 1000 + i, `bg${i}`).group.id);
    expect(book.size).toBe(BUG_GROUPS_MAX);
    // Group 5 is fixed and newer than group 0: it still goes first.
    book.setStatus(ids[5]!, "fixed");
    const r = book.record(input({ message: "a brand new one" }), 9000, "bnew1");
    expect(r.dropped).toEqual(["bg5"]);
    expect(book.get(ids[5]!)).toBeUndefined();
    expect(book.get(ids[0]!)).toBeDefined();
    expect(book.size).toBe(BUG_GROUPS_MAX);
    // All open: the oldest open group goes.
    const r2 = book.record(input({ message: "another new one" }), 9001, "bnew2");
    expect(r2.dropped).toEqual(["bg0"]);
    expect(book.get(r2.group.id)).toBeDefined();
  });

  it("lists newest first and filters by component, status and search", () => {
    const book = new BugBook();
    const a = book.record(input({ component: "game", process: "client", kind: "uncaught", message: "Pixi crashed", context: { panel: "shop" } }), 1000, "ba1").group;
    const b = book.record(input({ message: "docker is gone", kind: "docker", context: { task: "task-9" } }), 2000, "ba2").group;
    book.setStatus(a.id, "fixed");
    expect(book.list().map((g) => g.id)).toEqual([b.id, a.id]);
    expect(book.list({ component: "game" }).map((g) => g.id)).toEqual([a.id]);
    expect(book.list({ status: "open" }).map((g) => g.id)).toEqual([b.id]);
    expect(book.list({ search: "SHOP" }).map((g) => g.id)).toEqual([a.id]);
    expect(book.list({ search: "task-9" }).map((g) => g.id)).toEqual([b.id]);
    expect(book.list({ search: "nothing like it" })).toEqual([]);
    expect(book.openCount()).toEqual({ game: 0, code: 1 });
  });

  it("makes groups that pass their own schema, and summaries without samples", () => {
    const book = new BugBook();
    const g = book.record(input({ stack: "Error: boom\n    at f (a.ts:1:1)", note: "by hand", clientTime: 5, context: { floor: "lobby" } }), 1000, "ba1", true).group;
    expect(BugGroupSchema.safeParse(g).success).toBe(true);
    expect(bugSummary(g)).toMatchObject({ id: g.id, shots: 1 });
    expect("samples" in bugSummary(g)).toBe(false);
  });
});

describe("groupsToMarkdown", () => {
  it("lists the groups with where, the frame and the last stack, and no screenshot", () => {
    const book = new BugBook();
    book.record(input({ message: "docker is gone", kind: "docker", stack: "Error: x\n    at run (steps/test.ts:5:5)", context: { task: "task-9", step: "test" } }), Date.UTC(2026, 10, 15, 10, 2), "ba1", true);
    const md = groupsToMarkdown(book.all(), "Open bugs");
    expect(md).toContain("# Open bugs (1)");
    expect(md).toContain("## [code/agent-engine] docker: docker is gone");
    expect(md).toContain("first seen 2026-11-15 10:02 UTC");
    expect(md).toContain("where: task `task-9`, step `test`");
    expect(md).toContain("first frame: `run@test.ts`");
    expect(md).toContain("```text");
    expect(md).not.toContain(".png");
  });

  it("cannot be broken out of by a stack that holds a code fence", () => {
    const book = new BugBook();
    book.record(input({ stack: "Error: x\n```\nat evil (a.ts:1:1)" }), 1000, "ba1");
    const fences = groupsToMarkdown(book.all()).split("\n").filter((l) => l.startsWith("```"));
    expect(fences).toEqual(["```text", "```"]);
  });
});

describe("the messages", () => {
  it("accepts a bug_report with game kinds only and refuses anything else", () => {
    expect(ClientMsgSchema.safeParse({ type: "bug_report", kind: "manual", message: "it froze", note: "n", floor: "lobby", view: "hotel" }).success).toBe(true);
    expect(ClientMsgSchema.safeParse({ type: "bug_report", kind: "step-error", message: "x" }).success).toBe(false);
    expect(ClientMsgSchema.safeParse({ type: "bug_report", kind: "manual", message: "" }).success).toBe(false);
    expect(ClientMsgSchema.safeParse({ type: "bug_report", kind: "manual", message: "x".repeat(1001) }).success).toBe(false);
    expect(ClientMsgSchema.safeParse({ type: "bug_report", kind: "manual", message: "x", view: "map" }).success).toBe(false);
    expect(ClientMsgSchema.safeParse({ type: "bug_status", id: "0123456789abcdef", status: "fixed" }).success).toBe(true);
    expect(ClientMsgSchema.safeParse({ type: "bug_status", id: "short", status: "fixed" }).success).toBe(false);
  });

  it("accepts the server messages of the Bug sack", () => {
    const g = new BugBook().record(input(), 1000, "ba1").group;
    expect(ServerMsgSchema.safeParse({ type: "bug_saved", id: g.id, count: 1 }).success).toBe(true);
    expect(ServerMsgSchema.safeParse({ type: "bugs", groups: [bugSummary(g)], open: { game: 0, code: 1 } }).success).toBe(true);
    expect(ServerMsgSchema.safeParse({ type: "bug_detail", group: g }).success).toBe(true);
    expect(ServerMsgSchema.safeParse({ type: "error", code: "bug_error", message: "x" }).success).toBe(true);
  });

  it("has a report schema that bounds every text", () => {
    expect(BugInputSchema.safeParse(input({ stack: "x".repeat(4001) })).success).toBe(false);
    expect(BugInputSchema.safeParse(input({ note: "x".repeat(501) })).success).toBe(false);
    expect(BugInputSchema.safeParse(input({ context: { floor: "x".repeat(101) } })).success).toBe(false);
    expect(BugInputSchema.safeParse(input({ kind: "Bad Kind" })).success).toBe(false);
  });
});
