import { appendFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MEMORY_ENTRIES_MAX, MEMORY_PROPOSALS_MAX, MEMORY_TEXT_MAX, MemoryEntrySchema } from "@agentlife/shared";
import { NotFoundError } from "../src/errors.ts";
import { checkMemoryText, MemoryRejectedError } from "../src/memory/safety.ts";
import { MemoryStore } from "../src/memory/store.ts";

let tmp: string;
let clock: number;
let n: number;
beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "al-memory-"));
  clock = 1_000;
  n = 0;
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

function store(extra: { secrets?: string[] } = {}): MemoryStore {
  return new MemoryStore({
    dir: path.join(tmp, "memory"),
    now: () => clock++,
    newSuffix: () => String(++n).padStart(6, "0"),
    ...extra,
  });
}

const entry = (text: string, kind: "decision" | "convention" | "pitfall" | "finding" = "decision") => ({ kind, text, sourceTaskId: "task-aaaa1111" });

function rejects(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(MemoryRejectedError);
    expect((e as MemoryRejectedError).code).toBe(code);
    return;
  }
  throw new Error(`expected a ${code} rejection`);
}

describe("what the Library refuses (requirement 1.2)", () => {
  it("paths of any kind", () => {
    const homePath = ["C:", "Users", "someone", "app"].join("/");
    for (const t of ["See D:\\work\\app\\src\\a.ts for the setup", `Config lives in ${homePath}`, "Run /usr/local/bin/tool first", "Edit \\\\server\\share\\x"]) {
      rejects(() => checkMemoryText(t, []), "path_or_secret");
    }
  });

  it("token formats and NAME=value settings, built at run time so the repository holds no key-shaped literal", () => {
    const fakeKey = ["sk", "x".repeat(24)].join("-");
    const fakeGithub = ["ghp", "a1".repeat(18)].join("_");
    for (const t of [`The key is ${fakeKey}`, `Token ${fakeGithub} works`, "Authorization: Bearer abcdef123456", "Set NODE_ENV=production before the build", "Use $env:HOME to find it"]) {
      expect(() => checkMemoryText(t, []), t).toThrow(MemoryRejectedError);
    }
  });

  it("emails, home folders and the secrets of this machine", () => {
    rejects(() => checkMemoryText(`Ask ${["someone", "company.io"].join("@")} about the schema`, []), "secret");
    rejects(() => checkMemoryText(`The author's folder is ${["C:", "Users", "jdoe"].join("\\")}`, []), "path_or_secret");
    const secret = ["hunter", "2".repeat(14)].join("");
    rejects(() => checkMemoryText(`The deploy password is ${secret} in staging`, [secret]), "secret");
  });

  it("empty text, and text over the cap (not cut: it is refused)", () => {
    rejects(() => checkMemoryText("   \n\t ", []), "empty");
    rejects(() => checkMemoryText("a".repeat(MEMORY_TEXT_MAX + 1), []), "too_long");
    expect(checkMemoryText("a".repeat(MEMORY_TEXT_MAX), [])).toHaveLength(MEMORY_TEXT_MAX);
  });

  it("keeps relative file names and plain sentences, on one line", () => {
    expect(checkMemoryText("Tests for\n  src/todo.ts   live in test/todo.test.ts.", [])).toBe("Tests for src/todo.ts live in test/todo.test.ts.");
  });

  it("the message never repeats the text", () => {
    const fakeKey = ["sk", "y".repeat(24)].join("-");
    try {
      checkMemoryText(`key ${fakeKey}`, []);
    } catch (e) {
      expect((e as Error).message).not.toContain(fakeKey);
      return;
    }
    throw new Error("expected a rejection");
  });

  it("property: whatever is stored survives sanitize unchanged and fits the cap", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 700 }), (text) => {
        let stored: string;
        try {
          stored = checkMemoryText(text, []);
        } catch (e) {
          expect(e).toBeInstanceOf(MemoryRejectedError);
          return;
        }
        expect(stored.length).toBeLessThanOrEqual(MEMORY_TEXT_MAX);
        expect(stored).toBe(stored.replace(/\s+/g, " ").trim());
        expect(stored).not.toMatch(/[A-Za-z]:[\\/]/);
      }),
      { numRuns: 300 },
    );
  });
});

describe("the store", () => {
  it("keeps one JSON line per entry in data/memory/<project>.jsonl, valid against the schema", () => {
    const s = store();
    const a = s.add("haunted-todo", entry("Dates are stored as ISO strings."));
    s.add("haunted-todo", entry("Do not mutate the list passed to summarize.", "pitfall"));
    const file = path.join(tmp, "memory", "haunted-todo.jsonl");
    const lines = readFileSync(file, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    for (const l of lines) expect(MemoryEntrySchema.safeParse(JSON.parse(l)).success).toBe(true);
    expect(JSON.parse(lines[0]!)).toEqual({ id: a.id, kind: "decision", text: "Dates are stored as ISO strings.", sourceTaskId: "task-aaaa1111", createdAt: a.createdAt });
  });

  it("lists newest first, also for entries added in the same millisecond", () => {
    const s = new MemoryStore({ dir: path.join(tmp, "memory"), now: () => 5, newSuffix: () => String(++n).padStart(6, "0") });
    s.add("p", entry("first"));
    s.add("p", entry("second"));
    s.add("p", entry("third"));
    expect(s.list("p").map((e) => e.text)).toEqual(["third", "second", "first"]);
    clock = 1_000;
    const t = store();
    t.add("q", entry("old"));
    t.add("q", entry("newer"));
    expect(t.list("q").map((e) => e.text)).toEqual(["newer", "old"]);
  });

  it("keeps the memory of each project apart", () => {
    const s = store();
    s.add("one", entry("Only for one."));
    s.add("two", entry("Only for two."));
    expect(s.list("one").map((e) => e.text)).toEqual(["Only for one."]);
    expect(s.list("two").map((e) => e.text)).toEqual(["Only for two."]);
    expect(s.list("three")).toEqual([]);
  });

  it("refuses repeated text (any letter case) and a full Library, and stores nothing then", () => {
    const s = store();
    s.add("p", entry("Use pnpm, not npm."));
    rejects(() => s.add("p", entry("use PNPM, not npm.")), "duplicate");
    for (let i = 1; i < MEMORY_ENTRIES_MAX; i++) s.add("p", entry(`Note number ${i}.`));
    expect(s.list("p")).toHaveLength(MEMORY_ENTRIES_MAX);
    rejects(() => s.add("p", entry("One too many.")), "full");
    expect(s.list("p")).toHaveLength(MEMORY_ENTRIES_MAX);
  });

  it("refuses an unsafe text before anything is written", () => {
    const s = store();
    rejects(() => s.add("p", entry("Look in D:\\code\\x")), "path_or_secret");
    expect(existsSync(path.join(tmp, "memory", "p.jsonl"))).toBe(false);
  });

  it("edits text and kind, keeps date, source and place; the edit is checked too", () => {
    const s = store();
    const a = s.add("p", entry("Original."));
    s.add("p", entry("Another."));
    const b = s.update("p", a.id, { text: "Better wording.", kind: "convention" });
    expect(b).toMatchObject({ id: a.id, text: "Better wording.", kind: "convention", createdAt: a.createdAt, sourceTaskId: a.sourceTaskId });
    expect(s.list("p").map((e) => e.text)).toEqual(["Another.", "Better wording."]);
    rejects(() => s.update("p", a.id, { text: "See /etc/passwd now" }), "path_or_secret");
    rejects(() => s.update("p", a.id, { text: "another." }), "duplicate");
    expect(s.get("p", a.id)?.text).toBe("Better wording.");
    expect(() => s.update("p", "mem-nothere1", { text: "x" })).toThrow(NotFoundError);
  });

  it("deletes one entry or a whole project", () => {
    const s = store();
    const a = s.add("p", entry("One."));
    s.add("p", entry("Two."));
    s.remove("p", a.id);
    expect(s.list("p").map((e) => e.text)).toEqual(["Two."]);
    expect(() => s.remove("p", a.id)).toThrow(NotFoundError);
    s.propose("p", "task-1", [{ kind: "finding", text: "Pending." }]);
    s.setAutoRemember("p", true);
    s.removeProject("p");
    expect(s.list("p")).toEqual([]);
    expect(s.proposals("p")).toEqual([]);
    expect(s.autoRemember("p")).toBe(false);
  });

  it("a project id can never leave the folder", () => {
    const s = store();
    for (const id of ["..", "../x", "a/b", "a\\b", "", "A", "x.y"]) expect(() => s.add(id, entry("Text."))).toThrow("invalid project id");
    expect(s.autoRemember("../x")).toBe(false);
  });

  it("skips a damaged line, keeps a copy of the original before rewriting, and loses no good entry", () => {
    const s = store();
    const a = s.add("p", entry("Good one."));
    const file = path.join(tmp, "memory", "p.jsonl");
    appendFileSync(file, "{not json\n", "utf8");
    s.add("p", entry("Added after the damage."));
    expect(s.list("p").map((e) => e.text)).toEqual(["Added after the damage.", "Good one."]);
    expect(readdirSync(path.join(tmp, "memory")).some((f) => f.startsWith("p.jsonl.bad-"))).toBe(true);
    expect(readFileSync(file, "utf8")).not.toContain("not json");
    expect(s.get("p", a.id)).toBeDefined();
  });
});

describe("proposals and auto-remember (requirement 2.2)", () => {
  it("keeps at most five per job, checks each one, and drops what is unsafe or already known", () => {
    const s = store();
    s.add("p", entry("Already known."));
    const out = s.propose("p", "task-1", [
      { kind: "decision", text: "First." },
      { kind: "decision", text: "already KNOWN." },
      { kind: "pitfall", text: "Bad: D:\\x\\y" },
      { kind: "convention", text: "Second." },
      { kind: "finding", text: "Third." },
      { kind: "finding", text: "Fourth." },
      { kind: "finding", text: "Fifth." },
      { kind: "finding", text: "Sixth." },
      { kind: "finding", text: "Seventh." },
    ]);
    expect(out.map((p) => p.text)).toEqual(["Fifth.", "Fourth.", "Third.", "Second.", "First."]);
    expect(out).toHaveLength(MEMORY_PROPOSALS_MAX);
    expect(s.list("p")).toHaveLength(1); // nothing is stored without the user
  });

  it("a second proposal for the same job replaces the first; other jobs are kept", () => {
    const s = store();
    s.propose("p", "task-1", [{ kind: "decision", text: "From one." }]);
    s.propose("p", "task-2", [{ kind: "decision", text: "From two." }]);
    s.propose("p", "task-1", [{ kind: "decision", text: "From one, again." }]);
    expect(s.proposals("p").map((x) => x.text).sort()).toEqual(["From one, again.", "From two."]);
    expect(s.proposals("p", "task-2").map((x) => x.text)).toEqual(["From two."]);
  });

  it("accepting stores the entry with the job as its source, and the proposal is gone", () => {
    const s = store();
    const [p] = s.propose("p", "task-9", [{ kind: "pitfall", text: "Watch the timezone." }]);
    const e = s.accept("p", p!.id);
    expect(e).toMatchObject({ text: "Watch the timezone.", kind: "pitfall", sourceTaskId: "task-9" });
    expect(s.list("p")).toHaveLength(1);
    expect(s.proposals("p")).toEqual([]);
    expect(() => s.accept("p", p!.id)).toThrow(NotFoundError);
  });

  it("the user may edit the text while accepting, and the edit is checked", () => {
    const s = store();
    const [p] = s.propose("p", "task-9", [{ kind: "finding", text: "Rough note." }]);
    rejects(() => s.accept("p", p!.id, { text: "Open C:\\secret\\file" }), "path_or_secret");
    expect(s.proposals("p")).toHaveLength(1); // still pending
    expect(s.accept("p", p!.id, { text: "Polished note.", kind: "convention" })).toMatchObject({ text: "Polished note.", kind: "convention" });
  });

  it("dismissing removes a proposal and stores nothing", () => {
    const s = store();
    const [p] = s.propose("p", "task-9", [{ kind: "finding", text: "Not useful." }]);
    s.dismiss("p", p!.id);
    expect(s.proposals("p")).toEqual([]);
    expect(s.list("p")).toEqual([]);
    expect(() => s.dismiss("p", p!.id)).toThrow(NotFoundError);
  });

  it("auto-remember is off until switched on, per project, and survives a restart", () => {
    const s = store();
    expect(s.autoRemember("p")).toBe(false);
    s.setAutoRemember("p", true);
    expect(s.autoRemember("p")).toBe(true);
    expect(s.autoRemember("q")).toBe(false);
    expect(store().autoRemember("p")).toBe(true);
    s.setAutoRemember("p", false);
    expect(s.autoRemember("p")).toBe(false);
  });

  it("an unreadable proposals or settings file is moved aside and does not stop the Library", () => {
    const s = store();
    s.add("p", entry("Kept."));
    writeFileSync(path.join(tmp, "memory", "p.proposals.json"), "{broken", "utf8");
    writeFileSync(path.join(tmp, "memory", "_settings.json"), "{broken", "utf8");
    expect(s.proposals("p")).toEqual([]);
    expect(s.autoRemember("p")).toBe(false);
    expect(s.list("p")).toHaveLength(1);
    expect(readdirSync(path.join(tmp, "memory")).filter((f) => f.includes(".bad-")).length).toBe(2);
  });
});
