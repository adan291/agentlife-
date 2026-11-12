import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { ClientMsgSchema, FURNI_CATALOG, JobViewSchema, PanelNameSchema, ServerMsgSchema } from "../src/index.ts";

const start = (extra: Record<string, unknown>) => ClientMsgSchema.safeParse({ type: "start_job", repoId: "demo", goal: "Do it", ...extra });

describe("start_job with a kind (job-types)", () => {
  it("is a change when it has no kind, as before", () => {
    const r = start({});
    expect(r.success).toBe(true);
    expect(r.data).toMatchObject({ type: "start_job", repoId: "demo", goal: "Do it" });
  });

  it("accepts the target each kind needs", () => {
    expect(start({ kind: "review-branch", target: "feature/login" }).success).toBe(true);
    expect(start({ kind: "write-tests", target: "src/todo.ts" }).success).toBe(true);
    expect(start({ kind: "document", target: "How the build works" }).success).toBe(true);
    expect(start({ kind: "change" }).success).toBe(true);
  });

  it("refuses a missing or unfit target", () => {
    expect(start({ kind: "review-branch" }).success).toBe(false);
    expect(start({ kind: "review-branch", target: "-rf" }).success).toBe(false);
    expect(start({ kind: "review-branch", target: "a..b" }).success).toBe(false);
    expect(start({ kind: "write-tests" }).success).toBe(false);
    expect(start({ kind: "write-tests", target: "../secrets" }).success).toBe(false);
    expect(start({ kind: "document", target: "line one\nline two" }).success).toBe(false);
    expect(start({ kind: "change", target: "main" }).success).toBe(false);
    expect(start({ kind: "deploy", target: "x" }).success).toBe(false);
  });

  it("property: a module path with a parent folder is never accepted", () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom("src", "lib", "a", "..", "test"), { minLength: 1, maxLength: 5 }), (parts) => {
        const target = parts.join("/");
        const ok = start({ kind: "write-tests", target }).success;
        if (parts.includes("..")) expect(ok).toBe(false);
      }),
    );
  });
});

describe("branch picker messages", () => {
  it("asks for branches without a payload", () => {
    expect(ClientMsgSchema.safeParse({ type: "list_branches" }).success).toBe(true);
  });

  it("answers with the project, the checked-out branch and the names", () => {
    const ok = ServerMsgSchema.safeParse({ type: "branches", projectId: "demo", current: "main", branches: ["main", "feature/x"] });
    expect(ok.success).toBe(true);
    expect(ServerMsgSchema.safeParse({ type: "branches", projectId: "demo", current: null, branches: [] }).success).toBe(true);
    expect(ServerMsgSchema.safeParse({ type: "branches", projectId: "demo", branches: ["main"] }).success).toBe(false);
  });
});

describe("furniture per kind", () => {
  it("has a review desk, a test lab and a library shelf, each with its own panel and a hint", () => {
    const wanted = [
      ["review_desk", "review"],
      ["test_lab", "tests"],
      ["library_shelf", "library"],
    ] as const;
    for (const [id, panel] of wanted) {
      const def = FURNI_CATALOG[id];
      expect(def?.interaction).toBe(panel);
      expect(def?.hint).toBeTruthy();
      expect(PanelNameSchema.safeParse(panel).success).toBe(true);
    }
  });
});

describe("job view", () => {
  it("carries the kind and target of a job that is not a change", () => {
    const base = { taskId: "t1", repoId: "demo", goal: "g", state: "reviewing", timeline: [] };
    expect(JobViewSchema.safeParse(base).success).toBe(true);
    expect(JobViewSchema.safeParse({ ...base, kind: "review-branch", target: "feature/x" }).success).toBe(true);
    expect(JobViewSchema.safeParse({ ...base, kind: "nope" }).success).toBe(false);
  });
});
