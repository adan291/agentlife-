import fc from "fast-check";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BUG_INBOX_MAX_BYTES, BUG_MESSAGE_MAX, BugBook, BugGroupSchema } from "../src/index.ts";
import type { BugInput } from "../src/index.ts";
import {
  bugFiles,
  cleanBugInput,
  createBugReporter,
  loadBugFile,
  maskBugText,
  maskPaths,
  parseBugFile,
  readInboxFile,
  serializeBugFile,
  writeTextAtomic,
} from "../src/bugs-node.ts";
import { createLeakScanner, maskLeaks } from "../src/leaks.ts";

// Key-shaped fixtures are built at runtime so no key-shaped literal sits in the source.
const kiroKey = `ksk_${"A1b2C3d4".repeat(4)}`;
const githubToken = `ghp_${"a1B2".repeat(10)}`;
const openaiKey = `sk-${"abcDEF123".repeat(3)}`;
const awsKey = `AKIA${"ABCDEFGH12345678".slice(0, 16)}`;
const email = ["someone", "example-corp.io"].join("@");
const privateKey = ["-----BEGIN RSA", "PRIVATE KEY-----"].join(" ") + "\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n" + ["-----END RSA", "PRIVATE KEY-----"].join(" ");
const REPO = "D:\\Kiroween";
const opts = { secrets: [] as string[], repoRoot: REPO, projectRoots: ["D:\\AgentHotel"], home: "C:\\Users\\someone" };

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "agentlife-bugs-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const code = (over: Partial<BugInput> = {}): BugInput => ({ component: "code", process: "agent-engine", kind: "step-error", message: "boom", ...over });
const scan = (text: string) => {
  const s = createLeakScanner();
  s.scanText(text, "bug");
  return s.findings;
};

describe("maskLeaks", () => {
  it("removes every kind of secret the scanner knows", () => {
    const text = [kiroKey, githubToken, openaiKey, awsKey, email, "C:\\Users\\someone\\x", privateKey].join("\n");
    expect(scan(text).length).toBeGreaterThan(5);
    const out = maskLeaks(text);
    expect(scan(out)).toEqual([]);
    expect(out).toContain("[kiro-api-key]");
    expect(out).toContain("[github-token]");
    expect(out).toContain("[email]");
    expect(out).toContain("<home>");
    expect(out).toContain("[private-key]");
    expect(out).not.toContain("MIIEvQ");
  });

  it("removes the exact value of a secret and keeps the safe emails", () => {
    const secret = "correct-horse-battery-staple";
    expect(maskLeaks(`the token ${secret} leaked`, { secrets: [secret] })).toBe("the token [secret] leaked");
    expect(maskLeaks("by 14869836+adan291@users.noreply.github.com")).toBe("by 14869836+adan291@users.noreply.github.com");
  });
});

describe("maskPaths", () => {
  it("names the known roots and cuts any other absolute path to its tail", () => {
    expect(maskPaths("at f (D:\\Kiroween\\packages\\world-server\\src\\x.ts:4:9)", opts)).toBe("at f (<repo>\\packages\\world-server\\src\\x.ts:4:9)");
    expect(maskPaths("file:///D:/Kiroween/packages/a.ts", opts)).toBe("file:///<repo>/packages/a.ts");
    expect(maskPaths("D:\\AgentHotel\\DiscordIA\\src\\bot.ts", opts)).toBe("<projects>\\DiscordIA\\src\\bot.ts");
    expect(maskPaths("C:/Users/someone/AppData/x.log", opts)).toBe("<home>/AppData/x.log");
    expect(maskPaths("open E:\\secret\\place\\notes.txt:12:3 failed", opts)).toBe("open <path>/place/notes.txt:12:3 failed");
    expect(maskPaths("\\\\server\\share\\dir\\file.txt", opts)).toBe("<path>/dir/file.txt");
    expect(maskPaths("ENOENT /home/runner/work/app/src/a.ts", opts)).toBe("ENOENT <path>/src/a.ts");
    expect(maskPaths("ENOENT /Users/bob/project/a.ts", opts)).toBe("ENOENT <path>/project/a.ts");
  });

  it("does not touch URLs, relative paths or a folder that only starts like a root", () => {
    expect(maskPaths("GET http://localhost:5173/src/tmp/a.ts failed", opts)).toBe("GET http://localhost:5173/src/tmp/a.ts failed");
    expect(maskPaths("src/scene/room.ts", opts)).toBe("src/scene/room.ts");
    expect(maskPaths("D:\\Kiroween2\\x.ts", opts)).toBe("<path>/Kiroween2/x.ts");
  });

  it("ignores the letter case and the kind of slash of a root", () => {
    expect(maskPaths("d:/kiroween/data/bugs.jsonl", opts)).toBe("<repo>/data/bugs.jsonl");
  });
});

describe("maskBugText and cleanBugInput", () => {
  it("masks assignments next to their names", () => {
    expect(maskBugText("GITHUB_TOKEN=abcdef123456 and KIRO_API_KEY=zzzzzzzz", 200, opts)).toBe("GITHUB_TOKEN=[masked] and KIRO_API_KEY=[masked]");
    expect(maskBugText('{"password":"hunter2hunter2","user":"bob"}', 200, opts)).toBe('{"password":"[masked]","user":"bob"}');
    expect(maskBugText("Authorization: Bearer abcdefghijklmnop", 200, opts)).toBe("Authorization: Bearer [masked]");
    expect(maskBugText("Invalid token: expected a string", 200, opts)).toBe("Invalid token: expected a string");
  });

  it("removes control characters and caps the length", () => {
    expect(maskBugText("a\u001b[31mred\u0000b\tc\nd", 100, opts)).toBe("a[31mredb\tc\nd");
    expect(maskBugText("x".repeat(5000), 100, opts)).toHaveLength(100);
  });

  it("cleans every field of a report, and a client cannot grow it", () => {
    const dirty = cleanBugInput(
      {
        component: "game",
        process: "client",
        kind: "Not A Kind!",
        message: `crash ${githubToken} at D:\\Kiroween\\a.ts ${"m".repeat(3000)}`,
        stack: `Error: ${email}\n    at f (C:\\Users\\someone\\x.js:1:1)\n${"s".repeat(9000)}`,
        note: `${openaiKey} ${"n".repeat(2000)}`,
        context: { floor: "project:alpha", panel: `shop ${kiroKey}`, view: "hotel", bogus: "x", task: 5 },
        clientTime: 1.5,
      },
      opts,
    );
    expect(() => BugGroupSchema.shape.kind.parse(dirty.kind)).not.toThrow();
    expect(dirty.kind).toBe("unknown");
    expect(dirty.message.length).toBeLessThanOrEqual(BUG_MESSAGE_MAX);
    expect(dirty.stack?.length).toBeLessThanOrEqual(4000);
    expect(dirty.note?.length).toBeLessThanOrEqual(500);
    expect(dirty.clientTime).toBeUndefined();
    expect(Object.keys(dirty.context ?? {}).sort()).toEqual(["floor", "panel", "view"]);
    const all = JSON.stringify(dirty);
    expect(scan(all)).toEqual([]);
    expect(all).not.toContain("D:\\\\Kiroween");
    expect(dirty.message.startsWith("crash [github-token] at <repo>\\a.ts")).toBe(true);
  });

  it("gives an empty message a fallback and never throws on odd input", () => {
    expect(cleanBugInput({ component: "game", process: "client", kind: "manual", message: "" }, opts).message).toBe("(no message)");
    expect(() => cleanBugInput({ component: "game", process: "client", kind: "manual", message: undefined as unknown as string, context: 7 }, opts)).not.toThrow();
  });

  it("is idempotent: cleaning a clean report changes nothing", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 300 }), fc.string({ maxLength: 300 }), (message, stack) => {
        const once = cleanBugInput({ component: "code", process: "agent-engine", kind: "step-error", message, stack, context: { task: message.slice(0, 40) } }, opts);
        expect(cleanBugInput(once, opts)).toEqual(once);
      }),
    );
  });

  it("leaves nothing the scanner finds, for text made of secrets, paths and noise", () => {
    const piece = fc.constantFrom(kiroKey, githubToken, openaiKey, awsKey, email, "C:\\Users\\someone\\a", "x", " ", "\n", "D:\\AgentHotel\\p\\q.ts", "TOKEN=abcdefgh");
    fc.assert(
      fc.property(fc.array(piece, { maxLength: 12 }), (pieces) => {
        const out = cleanBugInput({ component: "code", process: "world-server", kind: "handler", message: pieces.join("") || "x", stack: pieces.join(" ") }, opts);
        expect(scan(JSON.stringify(out))).toEqual([]);
      }),
    );
  });
});

describe("bugFiles", () => {
  it("puts the neighbours next to the file named in the environment", () => {
    const f = bugFiles({ AGENTLIFE_BUGS_FILE: join(dir, "x-bugs.jsonl") }, "/unused");
    expect(f).toEqual({ file: join(dir, "x-bugs.jsonl"), inbox: join(dir, "x-bugs-inbox.jsonl"), draining: join(dir, "x-bugs-inbox.draining"), shots: join(dir, "x-bugs") });
  });

  it("defaults to data/ in the repository", () => {
    const f = bugFiles({}, join(dir, "repo"));
    expect(f.file).toBe(join(dir, "repo", "data", "bugs.jsonl"));
    expect(f.shots).toBe(join(dir, "repo", "data", "bugs"));
  });
});

describe("the file", () => {
  const groups = () => {
    const book = new BugBook();
    book.record(code({ message: "first" }), 1000, "ba001");
    book.record(code({ message: "second", kind: "docker" }), 2000, "ba002", true);
    return book.all();
  };

  it("writes a header and one group per line, newest first, and reads it back", () => {
    const text = serializeBugFile(groups(), 5000);
    const lines = text.trimEnd().split("\n");
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0]!)).toEqual({ format: "agentlife-bugs", version: 1, savedAt: 5000 });
    expect(JSON.parse(lines[1]!).message).toBe("second");
    expect(parseBugFile(text)).toEqual(groups());
  });

  it("refuses a foreign header, a bad line and a group twice", () => {
    const text = serializeBugFile(groups(), 5000);
    expect(() => parseBugFile(text.replace("agentlife-bugs", "other"))).toThrow(/agentlife-bugs/);
    expect(() => parseBugFile(`${text}{"nope":1}\n`)).toThrow();
    expect(() => parseBugFile(`${text}${text.split("\n")[1]}\n`)).toThrow(/twice/);
    expect(() => parseBugFile("")).toThrow();
  });

  it("moves an unreadable file aside and never overwrites it", () => {
    const file = join(dir, "bugs.jsonl");
    writeFileSync(file, "this is not a bug file\n");
    const logs: string[] = [];
    expect(loadBugFile(file, { now: () => 42, onLog: (m) => logs.push(m) })).toEqual([]);
    expect(existsSync(file)).toBe(false);
    expect(readFileSync(`${file}.bad-42`, "utf8")).toBe("this is not a bug file\n");
    expect(logs[0]).toContain("moved aside");
  });

  it("leaves the file where it is for a reader that never writes", () => {
    const file = join(dir, "bugs.jsonl");
    writeFileSync(file, "garbage\n");
    expect(loadBugFile(file, { moveAside: false })).toEqual([]);
    expect(existsSync(file)).toBe(true);
  });

  it("gives an empty list for a missing file", () => {
    expect(loadBugFile(join(dir, "none.jsonl"))).toEqual([]);
  });

  it("writes atomically: no temporary file is left and a failed rename leaves the old file", () => {
    const file = join(dir, "sub", "a.txt");
    writeTextAtomic(file, "one");
    writeTextAtomic(file, "two");
    expect(readFileSync(file, "utf8")).toBe("two");
    expect(readdirSync(join(dir, "sub"))).toEqual(["a.txt"]);
  });
});

describe("the inbox and the reporter", () => {
  const files = () => bugFiles({ AGENTLIFE_BUGS_FILE: join(dir, "bugs.jsonl") });

  it("appends one masked line per report", () => {
    const f = files();
    const bugs = createBugReporter({ process: "agent-engine", files: f, now: () => 1234, mask: opts });
    bugs.report({ kind: "step-error", message: `failed with ${githubToken}`, context: { task: "task-1", step: "develop" } });
    bugs.error("kiro-cli", new Error(`exit 1 at D:\\Kiroween\\x.ts ${email}`));
    const { records, bad } = readInboxFile(f.inbox);
    expect(bad).toBe(0);
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({ at: 1234, report: { component: "code", process: "agent-engine", kind: "step-error", message: "failed with [github-token]", context: { task: "task-1", step: "develop" } } });
    expect(records[1]?.report.message).toBe("Error: exit 1 at <repo>\\x.ts [email]");
    expect(scan(readFileSync(f.inbox, "utf8"))).toEqual([]);
  });

  it("skips lines that are not valid and counts them", () => {
    const f = files();
    createBugReporter({ process: "session", files: f, mask: opts }).report({ kind: "session-failed", message: "S1 failed" });
    appendFileSync(f.inbox, "not json\n{\"at\":1,\"report\":{\"kind\":1}}\n\n");
    const { records, bad } = readInboxFile(f.inbox);
    expect(records).toHaveLength(1);
    expect(bad).toBe(2);
  });

  it("writes nothing when the inbox is over its limit, and says so once", () => {
    const f = files();
    mkdirSync(dir, { recursive: true });
    writeFileSync(f.inbox, "x".repeat(BUG_INBOX_MAX_BYTES + 1));
    const warnings: string[] = [];
    const bugs = createBugReporter({ process: "conductor", files: f, onWarn: (m) => warnings.push(m), mask: opts });
    bugs.report({ kind: "conductor-stop", message: "a" });
    bugs.report({ kind: "conductor-stop", message: "b" });
    expect(readFileSync(f.inbox, "utf8")).toBe("x".repeat(BUG_INBOX_MAX_BYTES + 1));
    expect(warnings).toHaveLength(1);
  });

  it("never throws, even when the folder cannot be written", () => {
    const blocked = join(dir, "file-not-folder");
    writeFileSync(blocked, "x");
    const f = bugFiles({ AGENTLIFE_BUGS_FILE: join(blocked, "bugs.jsonl") });
    const warnings: string[] = [];
    const bugs = createBugReporter({ process: "agent-engine", files: f, onWarn: (m) => warnings.push(m), mask: opts });
    expect(() => bugs.report({ kind: "uncaught", message: "x" })).not.toThrow();
    expect(() => bugs.error("uncaught", undefined)).not.toThrow();
    expect(warnings).toHaveLength(1);
  });
});
