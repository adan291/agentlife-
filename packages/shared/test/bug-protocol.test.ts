import { describe, expect, it } from "vitest";
import { BUG_CHUNKS_MAX, BUG_CHUNK_CHARS, BUG_SHOT_BASE64_MAX, BUG_SHOT_MAX_BYTES, ClientMsgSchema, FURNI_CATALOG, MAX_MESSAGE_BYTES, PanelNameSchema, ServerMsgSchema, isTemplatePiece } from "../src/index.ts";

// Task 2 of the bug-sack spec: the messages of the Bug sack panel and the screenshot upload, and the bug jar.

describe("the messages that carry a screenshot", () => {
  const piece = { type: "bug_upload", id: "shot000001", seq: 0, last: false, data: "A".repeat(BUG_CHUNK_CHARS) };

  it("accepts a full piece, and a piece fits in one message of the gateway", () => {
    expect(ClientMsgSchema.safeParse(piece).success).toBe(true);
    expect(JSON.stringify(piece).length).toBeLessThan(MAX_MESSAGE_BYTES);
  });

  it("refuses a piece that is empty, too long, or whose number or id is wrong", () => {
    for (const bad of [{ data: "" }, { data: "A".repeat(BUG_CHUNK_CHARS + 1) }, { seq: -1 }, { seq: BUG_CHUNKS_MAX + 1 }, { id: "short" }, { id: "../../etc/passwd" }, { id: "UPPERCASE1" }, { last: "yes" }]) {
      expect(ClientMsgSchema.safeParse({ ...piece, ...bad }).success, JSON.stringify(bad).slice(0, 40)).toBe(false);
    }
  });

  it("has room for a screenshot of the biggest size in the pieces it allows", () => {
    expect(BUG_CHUNKS_MAX * BUG_CHUNK_CHARS).toBeGreaterThanOrEqual(BUG_SHOT_BASE64_MAX);
    expect(BUG_SHOT_BASE64_MAX).toBeGreaterThanOrEqual(Math.ceil((BUG_SHOT_MAX_BYTES * 4) / 3));
    // A report that names an upload keeps its own 8 KB limit.
    expect(ClientMsgSchema.safeParse({ type: "bug_report", kind: "manual", message: "x", upload: "shot000001" }).success).toBe(true);
    expect(ClientMsgSchema.safeParse({ type: "bug_report", kind: "manual", message: "x", upload: "no" }).success).toBe(false);
  });

  it("asks for the screenshot of a sample by an id that is a plain word", () => {
    expect(ClientMsgSchema.safeParse({ type: "bug_shot_get", sample: "b1abc2def" }).success).toBe(true);
    for (const sample of ["", "B1", "b/../x", "b1 2", "x1"]) expect(ClientMsgSchema.safeParse({ type: "bug_shot_get", sample }).success, sample).toBe(false);
  });

  it("answers with the PNG as base64, no longer than the biggest screenshot", () => {
    expect(ServerMsgSchema.safeParse({ type: "bug_shot", sample: "b1abc", png: "AAAA" }).success).toBe(true);
    expect(ServerMsgSchema.safeParse({ type: "bug_shot", sample: "b1abc", png: "A".repeat(BUG_SHOT_BASE64_MAX + 1) }).success).toBe(false);
    expect(ServerMsgSchema.safeParse({ type: "bug_shot", sample: "b1abc", png: "" }).success).toBe(false);
  });
});

describe("Copy for Kiro and the news", () => {
  it("names one group or one component, not both and not none", () => {
    expect(ClientMsgSchema.safeParse({ type: "bug_copy", id: "0123456789abcdef" }).success).toBe(true);
    expect(ClientMsgSchema.safeParse({ type: "bug_copy", component: "code" }).success).toBe(true);
    expect(ClientMsgSchema.safeParse({ type: "bug_copy" }).success).toBe(false);
    expect(ClientMsgSchema.safeParse({ type: "bug_copy", id: "0123456789abcdef", component: "game" }).success).toBe(false);
    expect(ClientMsgSchema.safeParse({ type: "bug_copy", component: "everything" }).success).toBe(false);
  });

  it("carries the text and how many groups it holds", () => {
    expect(ServerMsgSchema.safeParse({ type: "bug_text", text: "# Bugs (0)\n", count: 0 }).success).toBe(true);
    expect(ServerMsgSchema.safeParse({ type: "bug_text", text: "x", count: -1 }).success).toBe(false);
  });

  it("says how many are open and what changed", () => {
    for (const change of ["state", "new", "repeat", "reopened", "status"]) {
      expect(ServerMsgSchema.safeParse({ type: "bug_news", open: { game: 1, code: 0 }, change }).success, change).toBe(true);
    }
    expect(ServerMsgSchema.safeParse({ type: "bug_news", open: { game: 1, code: 0 }, change: "gone" }).success).toBe(false);
    expect(ServerMsgSchema.safeParse({ type: "bug_news", open: { game: 1 }, change: "new" }).success).toBe(false);
  });
});

describe("the bug jar", () => {
  it("is a lobby piece that opens the Bug sack and is never for sale", () => {
    const jar = FURNI_CATALOG["bug_jar"]!;
    expect(jar).toMatchObject({ interaction: "bugs", draw: "bug_jar", walkable: false });
    expect(jar.hint).toBeTruthy();
    expect(isTemplatePiece(jar)).toBe(true);
    expect(PanelNameSchema.safeParse("bugs").success).toBe(true);
  });
});
