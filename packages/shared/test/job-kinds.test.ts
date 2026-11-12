import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  AgentEventSchema,
  BranchReviewSchema,
  BranchesResponseSchema,
  EngineJobViewSchema,
  JOB_KINDS,
  StartJobBodySchema,
  isSafeBranchName,
  isSafeModulePath,
  isSafeTopic,
  targetProblem,
} from "../src/index.ts";

describe("StartJobBody kinds", () => {
  it("defaults to a change and keeps the old body valid", () => {
    const parsed = StartJobBodySchema.parse({ repoId: "r", goal: "do it" });
    expect(parsed.kind).toBe("change");
    expect(parsed.target).toBeUndefined();
  });

  it("needs a target for every other kind and none for a change", () => {
    expect(StartJobBodySchema.safeParse({ repoId: "r", goal: "g", kind: "review-branch" }).success).toBe(false);
    expect(StartJobBodySchema.safeParse({ repoId: "r", goal: "g", kind: "write-tests" }).success).toBe(false);
    expect(StartJobBodySchema.safeParse({ repoId: "r", goal: "g", kind: "document" }).success).toBe(false);
    expect(StartJobBodySchema.safeParse({ repoId: "r", goal: "g", kind: "change", target: "main" }).success).toBe(false);
    expect(StartJobBodySchema.safeParse({ repoId: "r", goal: "g", kind: "review-branch", target: "feature/login" }).success).toBe(true);
    expect(StartJobBodySchema.safeParse({ repoId: "r", goal: "g", kind: "write-tests", target: "src/utils" }).success).toBe(true);
    expect(StartJobBodySchema.safeParse({ repoId: "r", goal: "g", kind: "document", target: "How login works" }).success).toBe(true);
  });

  it("rejects an unknown kind and reports the problem on the target", () => {
    expect(StartJobBodySchema.safeParse({ repoId: "r", goal: "g", kind: "deploy", target: "x" }).success).toBe(false);
    const bad = StartJobBodySchema.safeParse({ repoId: "r", goal: "g", kind: "review-branch", target: "--output=x" });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0]?.path).toEqual(["target"]);
  });

  it("lists the four kinds of the spec", () => {
    expect([...JOB_KINDS].sort()).toEqual(["change", "document", "review-branch", "write-tests"]);
  });
});

describe("target rules (property tests)", () => {
  const dangerous = ["--output=x", "-x", "a..b", "a//b", "a/", "a.lock", "a/.hidden", "refs/heads/x y", "a b", "a~1", "a^", "a:b", "a?b", "a*b", "a[b", "a\\b", "a@{u}", "", "."];

  it("never accepts a branch name that could be read as an option or a revision expression", () => {
    for (const name of dangerous) expect(isSafeBranchName(name), name).toBe(false);
    fc.assert(
      fc.property(fc.string({ maxLength: 60 }), (s) => {
        if (!isSafeBranchName(s)) return;
        expect(s.startsWith("-")).toBe(false);
        expect(s).not.toMatch(/\.\.|\/\/|[\s~^:?*[\\@{]/);
        expect(s.endsWith("/") || s.endsWith(".") || s.endsWith(".lock")).toBe(false);
      }),
    );
  });

  it("accepts ordinary branch names", () => {
    for (const name of ["main", "feature/login", "release-1.2", "agentlife/task-1a2b3c4d", "fix_bug/42"]) expect(isSafeBranchName(name), name).toBe(true);
  });

  it("accepts only relative module paths that stay inside the project", () => {
    for (const bad of ["../x", "a/../b", "/etc/passwd", "C:\\x", "a//b", "./a", "a/.", "x\u0000y", "a\\b", "", "a.", "a/b "]) expect(isSafeModulePath(bad), bad).toBe(false);
    for (const ok of ["src", "src/utils", "src/utils/format.ts", "packages/core", "@scope/pkg"]) expect(isSafeModulePath(ok), ok).toBe(true);
    fc.assert(
      fc.property(fc.string({ maxLength: 80 }), (s) => {
        if (!isSafeModulePath(s)) return;
        expect(s.split("/")).not.toContain("..");
        expect(s.startsWith("/")).toBe(false);
        expect(s).not.toMatch(/[\\\u0000-\u001f]/);
      }),
    );
  });

  it("accepts a one-line topic and refuses control characters", () => {
    expect(isSafeTopic("How the cache is invalidated")).toBe(true);
    expect(isSafeTopic("line one\nline two")).toBe(false);
    expect(isSafeTopic("   ")).toBe(false);
    expect(isSafeTopic("x".repeat(201))).toBe(false);
  });

  it("names the problem for each kind", () => {
    expect(targetProblem("change", undefined)).toBeUndefined();
    expect(targetProblem("change", "x")).toMatch(/no target/);
    expect(targetProblem("review-branch", undefined)).toMatch(/branch/);
    expect(targetProblem("write-tests", "../x")).toMatch(/path/);
  });
});

describe("events and views with a kind", () => {
  it("task.created carries the kind and target only when set", () => {
    const base = { seq: 1, ts: 1, taskId: "t", type: "task.created", repoId: "r", goal: "g" };
    expect(AgentEventSchema.safeParse(base).success).toBe(true);
    expect(AgentEventSchema.safeParse({ ...base, kind: "review-branch", target: "feature/x" }).success).toBe(true);
    expect(AgentEventSchema.safeParse({ ...base, kind: "nope" }).success).toBe(false);
  });

  it("an engine job view without a kind is still valid (recorded runs)", () => {
    const view = { taskId: "t", repoId: "r", goal: "g", state: "created", steps: [], approvals: [], artifacts: [] };
    expect(EngineJobViewSchema.safeParse(view).success).toBe(true);
    expect(EngineJobViewSchema.safeParse({ ...view, kind: "document", target: "topic" }).success).toBe(true);
  });

  it("validates branch reviews and the branch list", () => {
    const review = { verdict: "pass", risk: "low", findings: [{ severity: "low", text: "nit", file: "a.ts" }] };
    expect(BranchReviewSchema.safeParse(review).success).toBe(true);
    expect(BranchReviewSchema.safeParse({ ...review, findings: [{ severity: "urgent", text: "x" }] }).success).toBe(false);
    expect(BranchReviewSchema.safeParse({ ...review, findings: Array.from({ length: 31 }, () => ({ severity: "low", text: "x" })) }).success).toBe(false);
    expect(BranchesResponseSchema.safeParse({ current: "main", branches: ["main", "feature/x"] }).success).toBe(true);
    expect(BranchesResponseSchema.safeParse({ current: null, branches: [] }).success).toBe(true);
  });
});
