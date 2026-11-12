import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JOB_KINDS, kindWritesFiles } from "@agentlife/shared";
import {
  AUDIT_MAX_ITEMS,
  MARK_AUDIT,
  MARK_END,
  MARK_OUTDATED,
  OFFLINE_NOTE,
  auditLine,
  auditVerdict,
  parseAudit,
  parseAuditOutput,
  parseOutdated,
  type AuditResult,
} from "../src/jobs/audit.ts";
import { PIPELINES, hasApproval, writesFiles } from "../src/jobs/kinds.ts";
import type { StepContext } from "../src/jobs/steps.ts";
import { PROJECT_ROOT } from "../src/paths.ts";
import { ProjectRegistry } from "../src/projects/registry.ts";
import { AUDIT_COMMAND, auditDepsStep } from "../src/steps/audit-deps.ts";
import { buildReport } from "../src/steps/report.ts";
import type { DockerExec, DockerRunResult } from "../src/steps/test.ts";
import { NODE_FILES, jobHarness, makeRepo, type JobHarness } from "./helpers.ts";
import { runnerFor, scripted, states, useSandbox } from "./job-types-helpers.ts";

const OUTDATED = JSON.stringify({
  zeta: { current: "1.0.0", wanted: "1.0.1", latest: "2.0.0", dependent: "demo" },
  alpha: [{ current: "0.1.0", wanted: "0.1.0", latest: "0.2.0" }],
});
const AUDIT = JSON.stringify({
  auditReportVersion: 2,
  vulnerabilities: {
    low1: { name: "low1", severity: "low", range: "<1.0.0", fixAvailable: false },
    crit: { name: "crit", severity: "critical", range: "<1.2.6", fixAvailable: { name: "crit", version: "1.2.6" } },
    mod: { name: "mod", severity: "moderate", fixAvailable: true },
  },
});
const container = (outdated: string, audit: string): string => `${MARK_OUTDATED}\n${outdated}\n${MARK_AUDIT}\n${audit}\n${MARK_END}\n`;

const clean: AuditResult = { outdated: [], vulnerabilities: [], outdatedOk: true, auditOk: true, notes: [] };

describe("npm outdated", () => {
  it("lists packages by name, takes the first location of a package found in several, and reads no extra fields", () => {
    const r = parseOutdated(OUTDATED);
    expect(r.ok).toBe(true);
    expect(r.items).toEqual([
      { name: "alpha", current: "0.1.0", wanted: "0.1.0", latest: "0.2.0" },
      { name: "zeta", current: "1.0.0", wanted: "1.0.1", latest: "2.0.0" },
    ]);
  });

  it("an empty object is a good, empty list; anything else is a problem", () => {
    expect(parseOutdated("{}")).toEqual({ ok: true, items: [] });
    expect(parseOutdated("").ok).toBe(false);
    expect(parseOutdated("not json").ok).toBe(false);
    expect(parseOutdated("[1]").ok).toBe(false);
    const err = parseOutdated(JSON.stringify({ error: { code: "ENOTFOUND", summary: "no network" } }));
    expect(err).toMatchObject({ ok: false, problem: "no network" });
  });

  it("caps the list and flattens control characters in names and versions", () => {
    const many = Object.fromEntries(Array.from({ length: AUDIT_MAX_ITEMS + 50 }, (_, i) => [`p${i}`, { current: "1" }]));
    expect(parseOutdated(JSON.stringify(many)).items).toHaveLength(AUDIT_MAX_ITEMS);
    const odd = parseOutdated(JSON.stringify({ "bad\nname": { current: "1.0.0\u0007\n# heading", latest: "x".repeat(500) } }));
    const item = odd.items[0]!;
    expect(item.name).toBe("bad name");
    expect(item.current).toBe("1.0.0 # heading");
    expect(item.latest!.length).toBeLessThanOrEqual(100);
  });
});

describe("npm audit", () => {
  it("sorts by severity, then name, and reads the fix", () => {
    const r = parseAudit(AUDIT);
    expect(r.ok).toBe(true);
    expect(r.items.map((v) => [v.name, v.severity, v.fix])).toEqual([
      ["crit", "critical", "crit@1.2.6"],
      ["mod", "moderate", "yes"],
      ["low1", "low", undefined],
    ]);
  });

  it("treats an unknown severity as info and a missing list as a problem", () => {
    expect(parseAudit(JSON.stringify({ vulnerabilities: { x: { severity: "scary" } } })).items[0]?.severity).toBe("info");
    expect(parseAudit(JSON.stringify({ vulnerabilities: {} }))).toEqual({ ok: true, items: [] });
    expect(parseAudit(JSON.stringify({ metadata: {} })).ok).toBe(false);
    expect(parseAudit("").ok).toBe(false);
    expect(parseAudit(JSON.stringify({ error: { code: "ENOLOCK" } }))).toMatchObject({ ok: false, problem: "ENOLOCK" });
  });
});

describe("container output", () => {
  it("reads both lists between the markers and always says the lists may be stale", () => {
    const r = parseAuditOutput(container(OUTDATED, AUDIT));
    expect(r.outdated.map((p) => p.name)).toEqual(["alpha", "zeta"]);
    expect(r.vulnerabilities.map((v) => v.name)).toEqual(["crit", "mod", "low1"]);
    expect(r).toMatchObject({ outdatedOk: true, auditOk: true });
    expect(r.notes).toEqual([OFFLINE_NOTE]);
  });

  it("copes with Windows line endings and with noise before the first marker", () => {
    const r = parseAuditOutput(`npm warn something\r\n${container(OUTDATED, AUDIT).replace(/\n/g, "\r\n")}`);
    expect(r.outdated).toHaveLength(2);
    expect(r.vulnerabilities).toHaveLength(3);
  });

  it("keeps one list when the other is missing, and notes the problem", () => {
    const r = parseAuditOutput(container(OUTDATED, ""));
    expect(r).toMatchObject({ outdatedOk: true, auditOk: false });
    expect(r.notes.join(" ")).toContain("The list of vulnerabilities is missing");
  });

  it("gives two missing lists when the markers are not there at all", () => {
    const r = parseAuditOutput("sh: npm: not found\n");
    expect(r).toMatchObject({ outdatedOk: false, auditOk: false, outdated: [], vulnerabilities: [] });
    expect(r.notes).toHaveLength(3);
  });

  it("the command prints the markers in the order the parser expects", () => {
    const at = (m: string): number => AUDIT_COMMAND.indexOf(m);
    expect(at(MARK_OUTDATED)).toBeGreaterThan(-1);
    expect(at(MARK_OUTDATED)).toBeLessThan(at(MARK_AUDIT));
    expect(at(MARK_AUDIT)).toBeLessThan(at(MARK_END));
    expect(AUDIT_COMMAND).toContain("--offline");
    expect(AUDIT_COMMAND).not.toMatch(/npm (install|ci|update|audit fix)/);
  });
});

describe("audit verdict", () => {
  it("fails on a high or critical vulnerability or when npm gave nothing; outdated packages alone pass", () => {
    expect(auditVerdict(clean)).toBe("pass");
    expect(auditVerdict({ ...clean, outdated: [{ name: "a" }] })).toBe("pass");
    expect(auditVerdict({ ...clean, vulnerabilities: [{ name: "a", severity: "moderate" }] })).toBe("pass");
    expect(auditVerdict({ ...clean, vulnerabilities: [{ name: "a", severity: "high" }] })).toBe("fail");
    expect(auditVerdict({ ...clean, vulnerabilities: [{ name: "a", severity: "critical" }] })).toBe("fail");
    expect(auditVerdict({ ...clean, outdatedOk: false, auditOk: false })).toBe("fail");
    expect(auditVerdict({ ...clean, auditOk: false })).toBe("pass");
  });

  it("writes one line for the terminal", () => {
    expect(auditLine({ ...clean, outdated: [{ name: "a" }], vulnerabilities: [{ name: "b", severity: "low" }] })).toBe("Audit: 1 outdated, 1 vulnerable");
    expect(auditLine({ ...clean, auditOk: false })).toBe("Audit: 0 outdated, vulnerabilities unknown");
    expect(auditLine({ ...clean, outdatedOk: false, auditOk: false })).toBe("Audit: npm gave no data");
  });
});

describe("audit report", () => {
  const audit = parseAuditOutput(container(OUTDATED, AUDIT));

  it("lists vulnerabilities by severity, outdated packages and the notes", () => {
    const { markdown, title } = buildReport({ goal: "Audit dependencies", verdict: "fail", kind: "audit-deps", audit, test: { passed: true, log: "" } });
    expect(title).toBeTruthy();
    expect(markdown).toContain("**Kind:** Dependency audit");
    expect(markdown).toContain("**Verdict:** FAIL");
    expect(markdown).toContain("**Vulnerable packages:** 3");
    expect(markdown).toContain("- **critical:** `crit` (range `<1.2.6`, fix: `crit@1.2.6`)");
    expect(markdown.indexOf("**critical:**")).toBeLessThan(markdown.indexOf("**low:**"));
    expect(markdown).toContain("- `zeta`: current `1.0.0`, wanted `1.0.1`, latest `2.0.0`");
    expect(markdown).toContain(OFFLINE_NOTE);
  });

  it("says when a list is missing instead of saying there is nothing", () => {
    const { markdown } = buildReport({ goal: "g", verdict: "fail", kind: "audit-deps", audit: parseAuditOutput("nothing"), test: { passed: true, log: "" } });
    expect(markdown).toContain("**Vulnerable packages:** unknown");
    expect(markdown.match(/No list was produced\./g)).toHaveLength(2);
    expect(markdown).not.toContain("None listed.");
  });

  it("puts package names in code spans only, so a hostile name cannot add Markdown", () => {
    const hostile = parseAuditOutput(container(JSON.stringify({ "x\n# Injected": { current: "1" } }), "{}"));
    const { markdown } = buildReport({ goal: "g", verdict: "pass", kind: "audit-deps", audit: hostile, test: { passed: true, log: "" } });
    expect(markdown).not.toMatch(/^# Injected/m);
    expect(markdown).toContain("`x # Injected`");
  });
});

describe("audit-deps pipeline", () => {
  const box = useSandbox();

  it("has no plan, no approval and no model: sandbox, then report", () => {
    expect(PIPELINES["audit-deps"]).toEqual(["created", "testing", "report_ready"]);
    expect(hasApproval("audit-deps")).toBe(false);
    expect(writesFiles("audit-deps")).toBe(false);
  });

  it("shared and engine agree on which kinds write files", () => {
    for (const kind of JOB_KINDS) expect(kindWritesFiles(kind), kind).toBe(writesFiles(kind));
  });

  it("runs the audit step, saves its result and reports with the verdict", async () => {
    const result: AuditResult = { ...clean, vulnerabilities: [{ name: "crit", severity: "critical" }] };
    const { steps, seen } = scripted({ auditDeps: async (c) => (seen.calls.push("auditDeps"), result) }, (input) => ({ title: "Audit", markdown: `# ${input.verdict}` }));
    const { store, runner } = runnerFor(box, steps);
    const id = runner.start("haunted-todo", "Audit dependencies", { kind: "audit-deps" });
    await runner.done(id);

    expect(seen.calls).toEqual(["auditDeps", "report"]);
    expect(states(store, id)).toEqual(["testing", "report_ready", "delivered"]);
    const job = store.getJob(id)!;
    expect(job).toMatchObject({ state: "delivered", verdict: "fail", kind: "audit-deps" });
    expect(job.approvals).toEqual([]);
    expect(job.artifacts.map((a) => a.kind)).toContain("audit");
  });

  it("passes when nothing serious is listed, and refuses to start on an engine that cannot audit", async () => {
    const { steps } = scripted({ auditDeps: async () => clean });
    const { store, runner } = runnerFor(box, steps);
    const id = runner.start("haunted-todo", "Audit dependencies", { kind: "audit-deps" });
    await runner.done(id);
    expect(store.getJob(id)!.verdict).toBe("pass");

    const bare = scripted().steps;
    const other = runnerFor(box, bare);
    expect(() => other.runner.start("haunted-todo", "g", { kind: "audit-deps" })).toThrow(/cannot audit/);
  });

  it("a failing step ends the job as failed with a report", async () => {
    const { steps } = scripted({
      auditDeps: async () => {
        throw new Error("docker is not running");
      },
    });
    const { store, runner } = runnerFor(box, steps);
    const id = runner.start("haunted-todo", "Audit dependencies", { kind: "audit-deps" });
    await runner.done(id);
    expect(states(store, id)).toEqual(["testing", "failed", "report_ready", "delivered"]);
  });
});

describe("auditDepsStep on a registered project", () => {
  let tmp: string;
  let hotel: string;
  let harness: JobHarness | undefined;

  beforeEach(() => {
    tmp = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), "al-audit-")));
    hotel = path.join(tmp, "hotel");
    mkdirSync(hotel, { recursive: true });
  });
  afterEach(() => {
    harness?.close();
    harness = undefined;
    rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  const ctx = (): StepContext => ({ taskId: "task-1", repoId: "demo", goal: "g", signal: new AbortController().signal, timeoutMs: 60_000, stepIndex: 0 });

  async function setup(files: Record<string, string>): Promise<void> {
    const dir = await makeRepo(path.join(hotel, "demo"), files);
    const reg = new ProjectRegistry({
      file: path.join(tmp, "data", "projects.json"),
      roots: [hotel],
      builtin: [],
      reposDir: path.join(tmp, "data", "repos"),
      agentlifeRoot: PROJECT_ROOT,
      secrets: [],
    });
    await reg.register({ path: dir, name: "demo" });
    harness = jobHarness(tmp, reg);
  }

  function docker(output: string, imagePresent = true) {
    const calls: (readonly string[])[] = [];
    const exec: DockerExec = async (args): Promise<DockerRunResult> => {
      calls.push(args);
      if (args[0] === "version") return { code: 0, output: "29.4.0" };
      if (args[0] === "image") return { code: imagePresent ? 0 : 1, output: "" };
      if (args[0] === "build") return { code: 0, output: "built" };
      // npm exits non-zero when it finds something; the step must not care.
      return { code: 1, output };
    };
    return { exec, calls };
  }

  it("runs the audit command in the sandbox without network and parses what it prints", async () => {
    await setup(NODE_FILES);
    const { exec, calls } = docker(container(OUTDATED, AUDIT));
    const result = await auditDepsStep(harness!.deps, ctx(), exec);
    expect(result.outdated).toHaveLength(2);
    expect(result.vulnerabilities[0]).toMatchObject({ name: "crit", severity: "critical" });

    const run = calls.find((c) => c[0] === "run")!;
    expect(run[run.indexOf("--network") + 1]).toBe("none");
    expect(run).toContain("--read-only");
    expect(run.find((a) => a.endsWith(":/src:ro"))).toBeDefined();
    expect(run[run.length - 1]).toContain(AUDIT_COMMAND);
  });

  it("does not use Docker for a project that npm cannot audit, and says why", async () => {
    await setup({ "README.md": "hi\n" });
    const { exec, calls } = docker("");
    const result = await auditDepsStep(harness!.deps, ctx(), exec);
    expect(calls).toHaveLength(0);
    expect(result).toMatchObject({ outdated: [], vulnerabilities: [], outdatedOk: false, auditOk: false });
    expect(result.notes[0]).toContain("nothing to audit");
    expect(auditVerdict(result)).toBe("fail");
  });

  it("fails when Docker is not available", async () => {
    await setup(NODE_FILES);
    const down: DockerExec = async () => ({ code: null, output: "", spawnError: new Error("spawn docker ENOENT") });
    await expect(auditDepsStep(harness!.deps, ctx(), down)).rejects.toThrow(/cannot start docker/);
  });
});
