import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  ClientMsgSchema,
  DEFAULT_PIPELINE,
  PIPELINE_REQUIRED_KINDS,
  PIPELINE_STEP_KINDS,
  PIPELINE_STEP_ROLES,
  PipelineSchema,
  SavePipelineBodySchema,
  ServerMsgSchema,
  validatePipeline,
  type PipelineMember,
  type PipelineStep,
  type PipelineStepKind,
} from "../src/index.ts";

const TEAM: PipelineMember[] = [
  { id: "architect", role: "architect", displayName: "Architect", model: "m-a" },
  { id: "developer", role: "developer", displayName: "Developer", model: "m-d" },
  { id: "qa", role: "qa", displayName: "QA", model: "m-q" },
  { id: "reviewer-1", role: "reviewer", displayName: "Rex", model: "m-r" },
  { id: "researcher-1", role: "researcher", displayName: "Rae", model: "m-s" },
];

const k = (...kinds: PipelineStepKind[]): PipelineStep[] => kinds.map((kind) => ({ kind }));
const rules = (steps: PipelineStep[], team: PipelineMember[] = TEAM): string[] => {
  const check = validatePipeline(steps, team);
  return check.ok ? [] : check.errors.map((e) => `${e.index ?? "-"}: ${e.rule}`);
};

describe("validatePipeline: the fixed rules", () => {
  it("accepts the default pipeline, with and without the optional steps", () => {
    expect(validatePipeline(DEFAULT_PIPELINE, TEAM)).toEqual({ ok: true });
    expect(validatePipeline(k("research", "plan", "approve", "develop", "test", "review", "report"), TEAM)).toEqual({ ok: true });
    expect(validatePipeline(k("plan", "approve", "develop", "test", "review", "second-review", "report"), TEAM)).toEqual({ ok: true });
    expect(validatePipeline(k("plan", "approve", "develop", "test", "second-review", "review", "report"), TEAM)).toEqual({ ok: true });
    expect(validatePipeline(k("research", "plan", "approve", "develop", "test", "review", "second-review", "report"), TEAM)).toEqual({ ok: true });
  });

  it("does not let develop run before the approval", () => {
    expect(rules(k("plan", "develop", "approve", "test", "review", "report"))).toEqual([
      "2: Approval must come before Develop: nothing is built without your approval.",
    ]);
    expect(rules(k("approve", "plan", "develop", "test", "review", "report"))).toContain("0: Approval must come after Plan: you approve the plan.");
    expect(rules(k("plan", "develop", "test", "review", "report"))).toEqual(["-: A pipeline needs a Approval step."]);
  });

  it("does not let a review run before the tests", () => {
    expect(rules(k("plan", "approve", "develop", "review", "test", "report"))).toEqual(["3: Review must come after Tests."]);
    expect(rules(k("plan", "approve", "develop", "test", "second-review", "review", "report"))).toEqual([]);
    expect(rules(k("plan", "approve", "develop", "second-review", "test", "review", "report"))).toEqual(["3: Second review must come after Tests."]);
    expect(rules(k("plan", "approve", "develop", "test", "report"))).toEqual(["-: A pipeline needs a Review step."]);
    expect(rules(k("plan", "approve", "test", "develop", "review", "report"))).toContain("2: Tests must run after Develop.");
  });

  it("starts with the plan, which only research may precede", () => {
    expect(rules(k("approve", "plan", "develop", "test", "review", "report"))[0]).toBe("0: A pipeline starts with Plan. Only Research may come before it.");
    expect(rules(k("plan", "research", "approve", "develop", "test", "review", "report"))).toEqual(["1: Research can only come first, before Plan."]);
    expect(rules(k("research", "approve", "plan", "develop", "test", "review", "report"))[0]).toBe("1: A pipeline starts with Plan. Only Research may come before it.");
  });

  it("ends with the report", () => {
    expect(rules(k("plan", "approve", "develop", "report", "test", "review"))).toEqual(["3: Report must be the last step."]);
    expect(rules(k("plan", "approve", "develop", "test", "review"))).toEqual(["-: A pipeline needs a Report step."]);
  });

  it("keeps every kind to one step and asks for the required ones", () => {
    expect(rules(k("plan", "approve", "develop", "test", "review", "review", "report"))).toEqual(["5: Review can only appear once."]);
    expect(rules(k("plan")).sort()).toEqual(
      ["-: A pipeline needs a Approval step.", "-: A pipeline needs a Develop step.", "-: A pipeline needs a Tests step.", "-: A pipeline needs a Review step.", "-: A pipeline needs a Report step."].sort(),
    );
    expect(rules([])).toHaveLength(PIPELINE_REQUIRED_KINDS.length);
  });
});

describe("validatePipeline: members", () => {
  const withMember = (kind: PipelineStepKind, memberId: string): PipelineStep[] =>
    DEFAULT_PIPELINE.map((s) => (s.kind === kind ? { kind, memberId } : { ...s }));

  it("accepts a member with a role the step needs", () => {
    expect(rules(withMember("review", "qa"))).toEqual([]);
    expect(rules(withMember("review", "reviewer-1"))).toEqual([]);
    expect(rules(withMember("plan", "architect"))).toEqual([]);
  });

  it("refuses a member of the wrong role, a stranger, and a member on a step without one", () => {
    expect(rules(withMember("develop", "qa"))).toEqual(["2: QA is a qa; Develop needs a developer."]);
    expect(rules(withMember("review", "researcher-1"))).toEqual(["4: Rae is a researcher; Review needs a qa or reviewer."]);
    expect(rules(withMember("plan", "nobody"))).toEqual(["0: nobody is not on this team."]);
    expect(rules(withMember("approve", "architect"))).toEqual(["1: Approval is not done by a team member."]);
    expect(rules(withMember("report", "architect"))).toEqual(["5: Report is not done by a team member."]);
    expect(rules(withMember("test", "developer"))).toEqual(["3: Tests is not done by a team member."]);
  });

  it("asks for a researcher and a reviewer on the team when those steps have none named", () => {
    const small = TEAM.filter((m) => m.role !== "reviewer" && m.role !== "researcher");
    expect(rules(k("research", "plan", "approve", "develop", "test", "review", "report"), small)).toEqual([
      "0: Research needs a researcher on the team. Hire one at the HR desk.",
    ]);
    expect(rules(k("plan", "approve", "develop", "test", "review", "second-review", "report"), small)).toEqual([
      "5: Second review needs a reviewer on the team. Hire one at the HR desk.",
    ]);
  });

  it("wants the second review done by someone else, on another model", () => {
    const steps = k("plan", "approve", "develop", "test", "review", "second-review", "report");
    expect(rules(steps)).toEqual([]);
    expect(rules(steps.map((s) => (s.kind === "second-review" ? { ...s, memberId: "qa" } : s)))).toEqual([
      "5: The second review needs someone other than the Review. Choose another team member.",
    ]);
    const same = TEAM.map((m) => (m.id === "reviewer-1" ? { ...m, model: "m-q" } : m));
    expect(rules(steps, same)).toEqual(["5: The second review needs a different model than the Review (both use m-q). Change the model of one of them."]);
  });
});

describe("pipeline schemas", () => {
  it("accepts the default and refuses unknown kinds, extra fields and a bad member id", () => {
    expect(PipelineSchema.safeParse(DEFAULT_PIPELINE).success).toBe(true);
    expect(PipelineSchema.safeParse([{ kind: "deploy" }]).success).toBe(false);
    expect(PipelineSchema.safeParse([{ kind: "plan", tools: ["shell"] }]).success).toBe(false);
    expect(PipelineSchema.safeParse([{ kind: "plan", memberId: "../x" }]).success).toBe(false);
    expect(PipelineSchema.safeParse([]).success).toBe(false);
    expect(PipelineSchema.safeParse(Array.from({ length: 9 }, () => ({ kind: "plan" }))).success).toBe(false);
    expect(SavePipelineBodySchema.safeParse({ steps: DEFAULT_PIPELINE, extra: 1 }).success).toBe(false);
  });

  it("gives approval, tests and report no role", () => {
    for (const kind of ["approve", "test", "report"] as const) expect(PIPELINE_STEP_ROLES[kind]).toEqual([]);
  });
});

/** Any list of steps, valid or not: kinds drawn at random, a member sometimes. */
const stepArb = fc.record(
  { kind: fc.constantFrom(...PIPELINE_STEP_KINDS), memberId: fc.constantFrom("architect", "developer", "qa", "reviewer-1", "researcher-1", "nobody") },
  { requiredKeys: ["kind"] },
);

/** A valid pipeline, then a few random edits (swap, delete, duplicate, change a member), so many results are still valid. */
const mutatedArb = fc
  .record({
    research: fc.boolean(),
    second: fc.constantFrom("none", "after", "before"),
    edits: fc.array(fc.record({ op: fc.constantFrom("swap", "delete", "dup", "member"), a: fc.nat(9), b: fc.nat(9), member: fc.constantFrom("architect", "developer", "qa", "reviewer-1", "researcher-1", "nobody") }), { maxLength: 3 }),
  })
  .map(({ research, second, edits }) => {
    const kinds: PipelineStepKind[] = ["plan", "approve", "develop", "test"];
    if (research) kinds.unshift("research");
    if (second === "before") kinds.push("second-review", "review");
    else if (second === "after") kinds.push("review", "second-review");
    else kinds.push("review");
    kinds.push("report");
    let steps: PipelineStep[] = kinds.map((kind) => ({ kind }));
    for (const e of edits) {
      const i = e.a % Math.max(1, steps.length);
      const j = e.b % Math.max(1, steps.length);
      if (e.op === "swap") [steps[i], steps[j]] = [steps[j]!, steps[i]!];
      else if (e.op === "delete") steps = steps.filter((_, n) => n !== i);
      else if (e.op === "dup" && steps[i]) steps = [...steps.slice(0, j), { ...steps[i]! }, ...steps.slice(j)];
      else if (steps[i]) steps[i] = { ...steps[i]!, memberId: e.member };
    }
    return steps.filter((s): s is PipelineStep => s !== undefined);
  });

describe("validatePipeline: properties", () => {
  it("a valid pipeline always keeps the safety order", () => {
    let valid = 0;
    fc.assert(
      fc.property(fc.oneof(mutatedArb, fc.array(stepArb, { maxLength: 10 })), (steps) => {
        if (!validatePipeline(steps, TEAM).ok) return;
        valid += 1;
        const at = (kind: PipelineStepKind): number => steps.findIndex((s) => s.kind === kind);
        // Plan first (research may come before it), the approval between plan and develop, tests after develop.
        expect(steps[0]!.kind === "plan" || (steps[0]!.kind === "research" && steps[1]!.kind === "plan")).toBe(true);
        expect(at("plan")).toBeLessThan(at("approve"));
        expect(at("approve")).toBeLessThan(at("develop"));
        expect(at("develop")).toBeLessThan(at("test"));
        // Every review after the tests, the report last.
        steps.forEach((s, i) => {
          if (s.kind === "review" || s.kind === "second-review") expect(i).toBeGreaterThan(at("test"));
        });
        expect(steps[steps.length - 1]!.kind).toBe("report");
        // Each kind once.
        expect(new Set(steps.map((s) => s.kind)).size).toBe(steps.length);
      }),
      { numRuns: 3000 },
    );
    // The generator must reach the rule checks, not only the refusals.
    expect(valid).toBeGreaterThan(300);
  });

  it("every shuffle of a valid pipeline is either valid or says why", () => {
    fc.assert(
      fc.property(fc.shuffledSubarray([...PIPELINE_STEP_KINDS], { minLength: 1 }), (kinds) => {
        const check = validatePipeline(kinds.map((kind) => ({ kind })), TEAM);
        if (!check.ok) expect(check.errors.length).toBeGreaterThan(0);
        for (const e of check.ok ? [] : check.errors) {
          expect(e.rule.length).toBeGreaterThan(0);
          expect(e.index === null || (e.index >= 0 && e.index < kinds.length)).toBe(true);
        }
      }),
    );
  });
});

describe("pipeline protocol", () => {
  it("accepts the board messages and refuses what is not a pipeline", () => {
    expect(ClientMsgSchema.safeParse({ type: "pipeline_state" }).success).toBe(true);
    expect(ClientMsgSchema.safeParse({ type: "pipeline_reset" }).success).toBe(true);
    expect(ClientMsgSchema.safeParse({ type: "pipeline_save", steps: DEFAULT_PIPELINE }).success).toBe(true);
    for (const steps of [[], [{ kind: "deploy" }], [{ kind: "plan", tools: ["shell"] }], [{ kind: "plan", memberId: "../x" }], "plan"]) {
      expect(ClientMsgSchema.safeParse({ type: "pipeline_save", steps }).success, JSON.stringify(steps)).toBe(false);
    }
  });

  it("accepts the server messages", () => {
    const state = { projectId: "alpha", customised: false, steps: DEFAULT_PIPELINE, members: [{ id: "qa", displayName: "QA", role: "qa", model: "m" }] };
    expect(ServerMsgSchema.safeParse({ type: "pipeline", state }).success).toBe(true);
    expect(ServerMsgSchema.safeParse({ type: "pipeline", state: { ...state, steps: [] } }).success).toBe(false);
    expect(ServerMsgSchema.safeParse({ type: "error", code: "pipeline_error", message: "no" }).success).toBe(true);
  });
});
