import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { CrewEventSchema } from "../../packages/shared/src/crew.ts";
import { baseName, commandLabel, createSendGate, crewEventFromLine, sanitize } from "../crew-map.ts";

const here = dirname(fileURLToPath(import.meta.url));
const lines = readFileSync(join(here, "fixtures", "stream-sample.jsonl"), "utf8").split("\n").filter((l) => l.length > 0);

const FORBIDDEN = /[A-Za-z]:[\\/]|ksk_/;

describe("crewEventFromLine on the fixture", () => {
  const events = lines.map((l) => crewEventFromLine(l, "S9"));

  it("ignores lifecycle, bookkeeping and invalid lines", () => {
    expect(events[0]).toBeNull(); // runStarted
    expect(events[1]).toBeNull(); // available_commands_update
    expect(events[9]).toBeNull(); // tool_call_update
    expect(events[10]).toBeNull(); // session_info_update
    expect(events[11]).toBeNull(); // not json
    expect(events[12]).toBeNull(); // runFinished
  });

  it("maps thoughts, reads, edits, runs and commits", () => {
    expect(events[2]).toEqual({ kind: "activity", session: "S9", activity: "think" });
    expect(events[3]).toEqual({ kind: "activity", session: "S9", activity: "read", text: "reading tasks.md" });
    expect(events[4]).toEqual({ kind: "activity", session: "S9", activity: "edit", text: "editing crew.ts" });
    expect(events[5]).toEqual({ kind: "activity", session: "S9", activity: "run", text: "running pnpm" });
    expect(events[6]).toEqual({ kind: "activity", session: "S9", activity: "run", text: "running pnpm check" });
    expect(events[7]).toMatchObject({ kind: "activity", activity: "commit" });
    expect(events[8]).toEqual({ kind: "activity", session: "S9", activity: "think", text: "list directory" });
  });

  it("keeps only the first 60 chars of the commit message", () => {
    const text = events[7]?.text ?? "";
    expect(text.startsWith("committing: build-crew: 1 Shared builder agent")).toBe(true);
    expect(text.length).toBeLessThanOrEqual("committing: ".length + 60);
    expect(text).not.toContain("past the limit");
  });

  it("only produces events that satisfy the shared schema", () => {
    for (const e of events) if (e) expect(CrewEventSchema.safeParse(e).success).toBe(true);
  });
});

describe("helpers", () => {
  it("baseName handles both separators", () => {
    expect(baseName("D:\\a\\b\\c.ts")).toBe("c.ts");
    expect(baseName("/a/b/c.ts")).toBe("c.ts");
    expect(baseName("c.ts")).toBe("c.ts");
  });

  it("commandLabel keeps the tool and a plain sub-command only", () => {
    expect(commandLabel("pnpm check")).toBe("pnpm check");
    expect(commandLabel("git add -A")).toBe("git add");
    expect(commandLabel("cd packages/x; vitest run")).toBe("vitest");
    expect(commandLabel("node ./scripts/a.ts --flag")).toBe("node");
    expect(commandLabel("")).toBe("");
  });

  it("sanitize removes paths and key-like tokens", () => {
    expect(sanitize("see C:\\Users\\me\\secret.txt now")).toBe("see now");
    expect(sanitize("open /etc/passwd please")).toBe("open please");
    expect(sanitize("key ksk_abc123 end")).toBe("key end");
  });
});

describe("sanitize (property)", () => {
  it("never exceeds 80 chars and never leaks drive paths or ksk_", () => {
    const alphabet = fc.constantFrom("a", "k", "s", "_", "C", ":", "\\", "/", " ", "x", "1", ".");
    fc.assert(
      fc.property(fc.array(alphabet, { maxLength: 200 }).map((a) => a.join("")), (s) => {
        const out = sanitize(s);
        return out.length <= 80 && !FORBIDDEN.test(out);
      }),
      { numRuns: 500 },
    );
    fc.assert(
      fc.property(fc.string({ maxLength: 300 }), (s) => {
        const out = sanitize(s);
        return out.length <= 80 && !FORBIDDEN.test(out);
      }),
    );
  });

  it("crewEventFromLine text obeys the same limits for arbitrary commands and paths", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), fc.string({ maxLength: 200 }), fc.constantFrom("execute", "read", "edit", "delete", "search"), (command, path, kind) => {
        const line = JSON.stringify({
          type: "sessionUpdate",
          data: { update: { sessionUpdate: "tool_call", kind, title: path, locations: [{ path }], rawInput: { command, path } } },
        });
        const ev = crewEventFromLine(line, "S1");
        const text = ev?.text ?? "";
        return text.length <= 80 && !FORBIDDEN.test(text) && (ev === null || CrewEventSchema.safeParse(ev).success);
      }),
      { numRuns: 500 },
    );
  });
});

describe("createSendGate", () => {
  it("limits think events and repeats, but forwards new tool calls", () => {
    const gate = createSendGate(1000);
    const think = { kind: "activity", session: "S1", activity: "think" } as const;
    const read = { kind: "activity", session: "S1", activity: "read", text: "reading a.ts" } as const;
    const edit = { kind: "activity", session: "S1", activity: "edit", text: "editing a.ts" } as const;
    expect(gate(think, 0)).toBe(true);
    expect(gate(think, 100)).toBe(false);
    expect(gate(read, 200)).toBe(true);
    expect(gate(read, 300)).toBe(false);
    expect(gate(edit, 400)).toBe(true);
    expect(gate(think, 500)).toBe(false);
    expect(gate(think, 1500)).toBe(true);
  });
});
