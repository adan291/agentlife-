import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { BUG_CHUNK_CHARS, BUG_SHOT_MAX_BYTES, BUG_UPLOAD_TTL_MS } from "@agentlife/shared";
import { ShotUpload } from "../src/bug-upload.ts";

const pieces = (b64: string, size: number): string[] => {
  const out: string[] = [];
  for (let i = 0; i < b64.length; i += size) out.push(b64.slice(i, i + size));
  return out;
};

/** Pushes every piece of `bytes`; returns the first refusal. */
function pushAll(up: ShotUpload, id: string, bytes: Uint8Array, size: number): string | undefined {
  const parts = pieces(Buffer.from(bytes).toString("base64"), size);
  for (let seq = 0; seq < parts.length; seq++) {
    const problem = up.push({ id, seq, last: seq === parts.length - 1, data: parts[seq]! });
    if (problem) return problem;
  }
  return undefined;
}

describe("ShotUpload", () => {
  it("puts the pieces of any byte string back together (property)", () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 1, maxLength: 3000 }), fc.integer({ min: 1, max: 50 }), (bytes, units) => {
        const up = new ShotUpload(() => 0);
        expect(pushAll(up, "abc123", bytes, units * 4)).toBeUndefined();
        expect(Buffer.from(up.take("abc123")!)).toEqual(Buffer.from(bytes));
      }),
    );
  });

  it("gives an upload once, and only to the id it was made for", () => {
    const up = new ShotUpload(() => 0);
    pushAll(up, "first1", Buffer.from("hello"), 8);
    expect(up.take("other1")).toBeUndefined();
    expect(Buffer.from(up.take("first1")!).toString()).toBe("hello");
    expect(up.take("first1")).toBeUndefined();
  });

  it("forgets an upload that nobody claimed within a minute", () => {
    let now = 0;
    const up = new ShotUpload(() => now);
    pushAll(up, "late01", Buffer.from("hello"), 8);
    now = BUG_UPLOAD_TTL_MS + 1;
    expect(up.take("late01")).toBeUndefined();
    pushAll(up, "soon01", Buffer.from("hello"), 8);
    now += BUG_UPLOAD_TTL_MS;
    expect(up.take("soon01")).toBeDefined();
  });

  it("starts again at piece 0, dropping what was half done and what was finished", () => {
    const up = new ShotUpload(() => 0);
    up.push({ id: "first1", seq: 0, last: false, data: "AAAA" });
    pushAll(up, "second", Buffer.from("two"), 4);
    expect(up.take("first1")).toBeUndefined();
    expect(Buffer.from(up.take("second")!).toString()).toBe("two");
    pushAll(up, "third1", Buffer.from("three"), 4);
    up.push({ id: "fourth", seq: 0, last: false, data: "AAAA" });
    expect(up.take("third1")).toBeUndefined();
  });

  it("drops the upload on a piece that is skipped, repeated or from another upload", () => {
    const cases: [string, { id: string; seq: number }[]][] = [
      ["skipped", [{ id: "same01", seq: 0 }, { id: "same01", seq: 2 }]],
      ["repeated", [{ id: "same01", seq: 0 }, { id: "same01", seq: 1 }, { id: "same01", seq: 1 }]],
      ["another upload", [{ id: "same01", seq: 0 }, { id: "other1", seq: 1 }]],
      ["no start", [{ id: "same01", seq: 1 }]],
    ];
    for (const [name, steps] of cases) {
      const up = new ShotUpload(() => 0);
      const problems = steps.map((s) => up.push({ ...s, last: false, data: "AAAA" }));
      expect(problems.at(-1), name).toContain("out of order");
      // Nothing is held after a refusal: the next piece 1 has nothing to follow.
      expect(up.push({ id: "same01", seq: 1, last: true, data: "AAAA" }), name).toContain("out of order");
    }
  });

  it("refuses text that is not base64, and a piece that is cut in the middle of a group of four", () => {
    const up = new ShotUpload(() => 0);
    expect(up.push({ id: "abc123", seq: 0, last: true, data: "not base64!" })).toContain("not valid");
    expect(up.push({ id: "abc123", seq: 0, last: false, data: "AAAAAA" })).toContain("not valid");
    expect(up.push({ id: "abc123", seq: 0, last: true, data: "AAAA".repeat(BUG_CHUNK_CHARS / 4 + 1) })).toContain("not valid");
  });

  it("refuses an upload past the biggest screenshot, and never holds more than that", () => {
    const up = new ShotUpload(() => 0);
    const piece = "A".repeat(BUG_CHUNK_CHARS);
    let problem: string | undefined;
    let seq = 0;
    while (!problem && seq < 200) problem = up.push({ id: "huge01", seq, last: false, data: piece }), seq++;
    expect(problem).toContain("too big");
    // The 1 MiB of bytes is 1 398 102 characters: that is 117 pieces of 12 000.
    expect(seq).toBeLessThanOrEqual(118);
    expect(up.take("huge01")).toBeUndefined();
    // A finished upload whose bytes pass the limit (padding does not matter here) is refused as well.
    const big = Buffer.alloc(BUG_SHOT_MAX_BYTES + 1, 1);
    expect(pushAll(new ShotUpload(() => 0), "big001", big, BUG_CHUNK_CHARS)).toContain("too big");
    expect(pushAll(new ShotUpload(() => 0), "ok0001", Buffer.alloc(BUG_SHOT_MAX_BYTES, 1), BUG_CHUNK_CHARS)).toBeUndefined();
  });
});
