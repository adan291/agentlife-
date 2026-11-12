import { describe, expect, it } from "vitest";
import {
  ClientMsgSchema,
  MEMORY_ENTRIES_MAX,
  MemoryActionSchema,
  MemoryStateSchema,
  MemoryUpdateBodySchema,
  ServerMsgSchema,
} from "../src/index.ts";

describe("Library protocol", () => {
  it("accepts the five actions with well-formed ids and refuses anything else", () => {
    for (const act of [
      { action: "edit", entryId: "mem-000001", text: "Tests sit beside the module.", kind: "decision" },
      { action: "delete", entryId: "mem-abc123" },
      { action: "accept", proposalId: "prop-000002" },
      { action: "accept", proposalId: "prop-000002", text: "Edited.", kind: "pitfall" },
      { action: "dismiss", proposalId: "prop-000002" },
      { action: "auto", autoRemember: true },
    ]) {
      expect(ClientMsgSchema.safeParse({ type: "memory_do", act }).success, JSON.stringify(act)).toBe(true);
    }
    for (const act of [
      { action: "delete", entryId: "../../etc/passwd" },
      { action: "delete", entryId: "prop-000001" },
      { action: "accept", proposalId: "mem-000001" },
      { action: "edit", entryId: "mem-000001", kind: "rumour" },
      { action: "edit", entryId: "mem-000001", text: "x".repeat(2001) },
      { action: "auto", autoRemember: "yes" },
      { action: "wipe" },
    ]) {
      expect(ClientMsgSchema.safeParse({ type: "memory_do", act }).success, JSON.stringify(act)).toBe(false);
    }
    expect(MemoryActionSchema.safeParse({ action: "auto" }).success).toBe(false);
    expect(ClientMsgSchema.safeParse({ type: "memory_state" }).success).toBe(true);
  });

  it("carries the state of a project to the client, and the new error code", () => {
    const state = { entries: [], proposals: [], autoRemember: false, learning: ["task-1"] };
    expect(ServerMsgSchema.safeParse({ type: "memory", projectId: "alpha", state }).success).toBe(true);
    expect(ServerMsgSchema.safeParse({ type: "memory", projectId: "alpha", state: { ...state, autoRemember: 1 } }).success).toBe(false);
    expect(ServerMsgSchema.safeParse({ type: "error", code: "memory_error", message: "no" }).success).toBe(true);
  });

  it("caps the state so a message stays small", () => {
    const entry = (i: number) => ({ id: `mem-${String(i).padStart(6, "0")}`, kind: "finding", text: "x", sourceTaskId: "task-1", createdAt: i });
    const many = Array.from({ length: MEMORY_ENTRIES_MAX + 1 }, (_, i) => entry(i));
    expect(MemoryStateSchema.safeParse({ entries: many.slice(0, MEMORY_ENTRIES_MAX), proposals: [], autoRemember: false, learning: [] }).success).toBe(true);
    expect(MemoryStateSchema.safeParse({ entries: many, proposals: [], autoRemember: false, learning: [] }).success).toBe(false);
  });

  it("an update needs something to change", () => {
    expect(MemoryUpdateBodySchema.safeParse({}).success).toBe(false);
    expect(MemoryUpdateBodySchema.safeParse({ text: "x" }).success).toBe(true);
    expect(MemoryUpdateBodySchema.safeParse({ kind: "decision" }).success).toBe(true);
  });
});
