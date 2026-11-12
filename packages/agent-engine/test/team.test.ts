import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TEAM_ROLES, TeamMemberSchema, TeamResponseSchema, tierForRole, type TeamMember, type TeamRole } from "@agentlife/shared";
import { ConflictError, NotFoundError } from "../src/errors.ts";
import { BadRequestError } from "../src/http/server.ts";
import { KiroCliError, KiroCliRuntime } from "../src/runtimes/kiro-cli.ts";
import type { AgentRuntime, RuntimeEvent, RuntimeInput } from "../src/runtimes/types.ts";
import { dataPaths } from "../src/paths.ts";
import { runRole, type PipelineDeps } from "../src/steps/deps.ts";
import { Store } from "../src/store.ts";
import { Catalogue } from "../src/team/catalogue.ts";
import { ModelDirectory, loadTeamRules, parseModelList } from "../src/team/models.ts";
import { TeamService, type BusyRole, type ResolvedMember } from "../src/team/service.ts";
import { TeamStore } from "../src/team/store.ts";
import { loadTiers } from "../src/team/tiers.ts";
import type { ModelLister } from "../src/team/models.ts";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "al-team-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

const tiers = loadTiers();
const catalogue = new Catalogue();
const rules = loadTeamRules();

interface Harness {
  service: TeamService;
  store: TeamStore;
  file: string;
  kiroHome: string;
  lines: string[];
  validated: string[];
  busy: BusyRole[];
  refuse: { on: boolean };
  make(): TeamService;
}

function harness(over: { models?: ModelDirectory; agents?: boolean } = {}): Harness {
  const file = path.join(tmp, "teams.json");
  const kiroHome = path.join(tmp, "kiro-home");
  const lines: string[] = [];
  const validated: string[] = [];
  const busy: BusyRole[] = [];
  const refuse = { on: false };
  let n = 0;
  const store = new TeamStore({ file });
  const make = (): TeamService =>
    new TeamService({
      store,
      catalogue,
      models: over.models ?? new ModelDirectory({ rules }),
      tiers,
      hasProject: (id) => id === "alpha" || id === "beta",
      defaultModels: { architect: "claude-haiku-5.5", developer: "auto", qa: "claude-haiku-5.5" },
      ...(over.agents === false
        ? {}
        : {
            agents: {
              kiroHome,
              validate: async (f: string) => {
                validated.push(path.basename(f));
                if (refuse.on) throw new Error("not accepted");
              },
            },
          }),
      busy: () => busy,
      activity: (p, r, t) => lines.push(`${p}:${r}:${t}`),
      newId: () => String(++n).padStart(6, "0"),
    });
  return { service: make(), store, file, kiroHome, lines, validated, busy, refuse, make };
}

const agentFile = (h: Harness, name: string) => JSON.parse(readFileSync(path.join(h.kiroHome, "agents", `${name}.json`), "utf8")) as { permissions: unknown; tools: unknown; model: string; prompt: string };
const roleOf = (h: Harness, project: string, role: TeamRole): TeamMember | undefined => h.service.team(project).members.find((m) => m.role === role);

describe("default team", () => {
  it("has the Architect, Developer and QA, runs the built-in agents and writes nothing", () => {
    const h = harness();
    const view = h.service.view("alpha");
    expect(TeamResponseSchema.parse(view)).toMatchObject({ projectId: "alpha", customised: false });
    expect(view.members.map((m) => [m.id, m.displayName, m.model])).toEqual([
      ["architect", "Architect", "claude-haiku-5.5"],
      ["developer", "Developer", "auto"],
      ["qa", "QA", "claude-haiku-5.5"],
    ]);
    expect(h.service.resolve("alpha", "t1", "developer")).toEqual({ memberId: "developer", agent: "agentlife-developer", model: "auto", displayName: "Developer" });
    expect(existsSync(h.file)).toBe(false);
    expect(existsSync(h.kiroHome)).toBe(false);
  });

  it("is refused for a project that does not exist", () => {
    const h = harness();
    expect(() => h.service.team("nope")).toThrow(NotFoundError);
  });
});

describe("hire", () => {
  it("stores the team, writes a validated agent file for every member and logs a line", async () => {
    const h = harness();
    const m = await h.service.hire("alpha", { templateId: "qa-strict", displayName: "Vera" });
    expect(TeamMemberSchema.parse(m)).toMatchObject({ id: "qa-000001", displayName: "Vera", templateId: "qa-strict", role: "qa", model: "claude-sonnet-5.5" });
    expect(h.service.view("alpha")).toMatchObject({ customised: true });
    expect(h.service.team("alpha").members.map((x) => x.id)).toEqual(["architect", "developer", "qa", "qa-000001"]);
    expect(h.validated.sort()).toEqual(["alpha-architect.json", "alpha-developer.json", "alpha-qa-000001.json", "alpha-qa.json"]);
    const f = agentFile(h, "alpha-qa-000001");
    expect(f.model).toBe("claude-sonnet-5.5");
    expect(f.prompt).toMatch(/strict QA reviewer/);
    expect(h.lines).toEqual(["alpha:qa:Hired Vera (Strict QA)"]);
    // A new store over the same file sees the same team.
    expect(new TeamStore({ file: h.file }).get("alpha")).toHaveLength(4);
    expect(JSON.parse(readFileSync(h.file, "utf8"))).toHaveProperty("alpha");
  });

  it("gives every hired member the permissions of its tier, for every template of the catalogue", async () => {
    for (const t of catalogue.list()) {
      rmSync(tmp, { recursive: true, force: true });
      tmp = mkdtempSync(path.join(os.tmpdir(), "al-team-"));
      const h = harness();
      const m = await h.service.hire("alpha", { templateId: t.id, displayName: "Zed" });
      const tier = tiers[tierForRole(t.role)];
      const f = agentFile(h, `alpha-${m.id}`);
      expect(f.permissions, t.id).toEqual(tier.permissions);
      expect(f.tools, t.id).toEqual(tier.tools);
    }
  });

  it("refuses an unknown template, a taken name, a bad model and a full team", async () => {
    const h = harness();
    await expect(h.service.hire("alpha", { templateId: "nobody", displayName: "Zed" })).rejects.toThrow(NotFoundError);
    await expect(h.service.hire("nope", { templateId: "qa", displayName: "Zed" })).rejects.toThrow(NotFoundError);
    await expect(h.service.hire("alpha", { templateId: "qa", displayName: "qa" })).rejects.toMatchObject({ code: "name_taken" });
    await expect(h.service.hire("alpha", { templateId: "qa", displayName: "Zed", model: "not-a-model" })).rejects.toMatchObject({ code: "model_not_allowed" });
    await expect(h.service.hire("alpha", { templateId: "researcher", displayName: "Zed", model: "claude-opus-5.5" })).rejects.toBeInstanceOf(BadRequestError);
    expect(h.store.get("alpha")).toBeUndefined();
    for (const name of ["A1", "A2", "A3", "A4", "A5"]) await h.service.hire("alpha", { templateId: "reviewer", displayName: name });
    await expect(h.service.hire("alpha", { templateId: "reviewer", displayName: "A6" })).rejects.toMatchObject({ code: "team_full" });
  });

  it("limits models to the role's list and to the account's models", async () => {
    let calls = 0;
    const list: ModelLister = async () => {
      calls += 1;
      return ["auto", "claude-haiku-5.5", "gpt-5.6-luna", "grok-4.7"];
    };
    const h = harness({ models: new ModelDirectory({ rules, list }) });
    await expect(h.service.hire("alpha", { templateId: "qa-strict", displayName: "Vera" })).rejects.toMatchObject({ code: "model_not_allowed" }); // sonnet: not in the account
    await expect(h.service.hire("alpha", { templateId: "qa", displayName: "Vera", model: "grok-4.7" })).rejects.toMatchObject({ code: "model_not_allowed" }); // in the account, not allowed for the role
    const ok = await h.service.hire("alpha", { templateId: "qa", displayName: "Vera", model: "gpt-5.6-luna" });
    expect(ok.model).toBe("gpt-5.6-luna");
    expect(calls).toBe(1); // the list is reused
  });

  it("says so when the model list cannot be read, and changes nothing", async () => {
    const h = harness({ models: new ModelDirectory({ rules, list: async () => Promise.reject(new Error("offline")) }) });
    await expect(h.service.hire("alpha", { templateId: "qa", displayName: "Vera" })).rejects.toMatchObject({ code: "models_unavailable" });
    expect(h.store.get("alpha")).toBeUndefined();
  });

  it("under the fake runtime the only model is fake", async () => {
    const h = harness({ models: new ModelDirectory({ rules, fake: true }) });
    const m = await h.service.hire("alpha", { templateId: "qa-strict", displayName: "Vera" });
    expect(m.model).toBe("fake");
    await expect(h.service.hire("alpha", { templateId: "qa", displayName: "Max", model: "claude-haiku-5.5" })).rejects.toMatchObject({ code: "model_not_allowed" });
  });

  it("changes nothing when kiro-cli refuses an agent file", async () => {
    const h = harness();
    h.refuse.on = true;
    await expect(h.service.hire("alpha", { templateId: "qa", displayName: "Vera" })).rejects.toMatchObject({ code: "agent_file_refused" });
    expect(h.store.get("alpha")).toBeUndefined();
    expect(readdirSync(path.join(h.kiroHome, "agents"))).toEqual([]);
    expect(readdirSync(path.join(h.kiroHome, "agents-staging"))).toEqual([]);
  });

  it("keeps two hires at the same time apart", async () => {
    const h = harness();
    const hired = await Promise.all(["Ana", "Bo", "Cy"].map((n) => h.service.hire("alpha", { templateId: "reviewer", displayName: n })));
    expect(new Set(hired.map((m) => m.id)).size).toBe(3);
    expect(h.service.team("alpha").members).toHaveLength(6);
    expect(new TeamStore({ file: h.file }).get("alpha")).toHaveLength(6);
  });

  it("writes no agent file when the engine has no real runtime", async () => {
    const h = harness({ agents: false });
    await h.service.hire("alpha", { templateId: "qa", displayName: "Vera" });
    expect(existsSync(h.kiroHome)).toBe(false);
    expect(h.service.team("alpha").members).toHaveLength(4);
  });

  it("does not let a project take over the names of the built-in role agents", async () => {
    const file = path.join(tmp, "t.json");
    const service = new TeamService({ store: new TeamStore({ file }), catalogue, models: new ModelDirectory({ rules }), tiers, hasProject: () => true });
    await expect(service.hire("agentlife", { templateId: "qa", displayName: "Vera" })).rejects.toMatchObject({ code: "project_id_reserved" });
  });
});

describe("rename and change model", () => {
  it("renames without touching the agent file, and logs it", async () => {
    const h = harness();
    const m = await h.service.hire("alpha", { templateId: "qa", displayName: "Vera" });
    const before = readFileSync(path.join(h.kiroHome, "agents", `alpha-${m.id}.json`), "utf8");
    h.validated.length = 0;
    const next = await h.service.update("alpha", m.id, { displayName: "Vera II" });
    expect(next.displayName).toBe("Vera II");
    expect(readFileSync(path.join(h.kiroHome, "agents", `alpha-${m.id}.json`), "utf8")).toBe(before);
    expect(h.validated).toEqual([]);
    expect(h.lines.at(-1)).toBe("alpha:qa:Renamed Vera to Vera II");
    await expect(h.service.update("alpha", m.id, { displayName: "Architect" })).rejects.toMatchObject({ code: "name_taken" });
    await expect(h.service.update("alpha", m.id, { displayName: "Vera II" })).resolves.toMatchObject({ displayName: "Vera II" }); // own name is not a clash
  });

  it("changes the model, rewrites the agent file and logs it", async () => {
    const h = harness();
    const m = await h.service.hire("alpha", { templateId: "qa", displayName: "Vera" });
    await h.service.update("alpha", m.id, { model: "gpt-5.6-terra" });
    expect(agentFile(h, `alpha-${m.id}`).model).toBe("gpt-5.6-terra");
    expect(h.lines.at(-1)).toBe("alpha:qa:Vera now uses gpt-5.6-terra");
    await expect(h.service.update("alpha", m.id, { model: "grok-4.7" })).rejects.toMatchObject({ code: "model_not_allowed" });
    await expect(h.service.update("alpha", "ghost", { model: "auto" })).rejects.toThrow(NotFoundError);
  });

  it("on the default team the first change stores the whole team", async () => {
    const h = harness();
    await h.service.update("alpha", "developer", { displayName: "Dev Dana" });
    expect(h.service.view("alpha")).toMatchObject({ customised: true });
    expect(h.service.resolve("alpha", "t1", "developer")).toMatchObject({ agent: "alpha-developer", displayName: "Dev Dana", model: "auto" });
    expect(existsSync(path.join(h.kiroHome, "agents", "alpha-architect.json"))).toBe(true);
  });
});

describe("fire", () => {
  it("refuses to fire the only architect or the only developer, with an explanation", async () => {
    const h = harness();
    await expect(h.service.fire("alpha", "architect")).rejects.toMatchObject({ code: "last_of_role" });
    await expect(h.service.fire("alpha", "architect")).rejects.toThrow(/only architect on this team. Hire another architect first/);
    await expect(h.service.fire("alpha", "developer")).rejects.toBeInstanceOf(ConflictError);
    expect(h.store.get("alpha")).toBeUndefined();
    const second = await h.service.hire("alpha", { templateId: "architect-thorough", displayName: "Ada" });
    await h.service.fire("alpha", "architect");
    expect(h.service.team("alpha").members.map((m) => m.id)).toEqual(["developer", "qa", second.id]);
    await expect(h.service.fire("alpha", second.id)).rejects.toMatchObject({ code: "last_of_role" });
  });

  it("fires a member that is not required, and logs it", async () => {
    const h = harness();
    await h.service.fire("alpha", "qa");
    expect(roleOf(h, "alpha", "qa")).toBeUndefined();
    expect(h.lines.at(-1)).toBe("alpha:qa:QA left the team");
    expect(h.service.resolve("alpha", "t-new", "qa")).toBeUndefined(); // the steps fall back to the built-in agent
    await expect(h.service.fire("alpha", "qa")).rejects.toThrow(NotFoundError);
  });

  it("refuses to fire an agent that is working, but not one that is only on the bench", async () => {
    const h = harness();
    const bench = await h.service.hire("alpha", { templateId: "qa-fast", displayName: "Quin" });
    h.busy.push({ taskId: "job-1", role: "qa" });
    await expect(h.service.fire("alpha", "qa")).rejects.toMatchObject({ code: "agent_working" });
    await h.service.fire("alpha", bench.id); // job-1 runs with the first QA
    expect(roleOf(h, "alpha", "qa")?.id).toBe("qa");
    h.busy.length = 0;
    await h.service.fire("alpha", "qa");
    expect(roleOf(h, "alpha", "qa")).toBeUndefined();
  });

  it("removes the team of a project that is gone", async () => {
    const h = harness();
    await h.service.hire("alpha", { templateId: "qa", displayName: "Vera" });
    h.service.remove("alpha");
    expect(h.service.view("alpha").customised).toBe(false);
    expect(new TeamStore({ file: h.file }).get("alpha")).toBeUndefined();
  });
});

describe("a team change applies to the next job", () => {
  it("keeps the agents a job started with", async () => {
    const h = harness();
    const first = h.service.resolve("alpha", "job-1", "qa");
    expect(first).toMatchObject({ agent: "agentlife-qa", model: "claude-haiku-5.5" });
    await h.service.update("alpha", "qa", { model: "claude-sonnet-5.5", displayName: "Quality" });
    expect(h.service.resolve("alpha", "job-1", "qa")).toBe(first);
    expect(h.service.resolve("alpha", "job-1", "developer")).toMatchObject({ agent: "agentlife-developer" });
    expect(h.service.resolve("alpha", "job-2", "qa")).toMatchObject({ agent: "alpha-qa", model: "claude-sonnet-5.5", displayName: "Quality" });
  });

  it("uses the first member of a role", async () => {
    const h = harness();
    await h.service.hire("alpha", { templateId: "qa-fast", displayName: "Quin" });
    expect(h.service.resolve("alpha", "job-1", "qa")?.memberId).toBe("qa");
    await h.service.fire("alpha", "qa");
    expect(h.service.resolve("alpha", "job-2", "qa")?.displayName).toBe("Quin");
  });

  it("projects do not share teams", async () => {
    const h = harness();
    await h.service.hire("alpha", { templateId: "qa", displayName: "Vera" });
    expect(h.service.view("beta").customised).toBe(false);
    expect(h.service.resolve("beta", "job-9", "qa")?.agent).toBe("agentlife-qa");
  });
});

describe("syncAgents", () => {
  it("rewrites missing files and removes the files of members that are gone", async () => {
    const h = harness();
    const m = await h.service.hire("alpha", { templateId: "qa", displayName: "Vera" });
    await h.service.fire("alpha", m.id);
    const dir = path.join(h.kiroHome, "agents");
    writeFileSync(path.join(dir, "other.json"), "{}");
    writeFileSync(path.join(dir, "beta-qa-ffffff.json"), "{}"); // beta has no stored team: not ours to judge
    writeFileSync(path.join(dir, "alpha-notes.json"), "{}");
    rmSync(path.join(dir, "alpha-developer.json"));
    expect(existsSync(path.join(dir, `alpha-${m.id}.json`))).toBe(true); // a running job may still need it
    h.validated.length = 0;
    const out = await h.make().syncAgents();
    expect(out).toEqual({ written: 1, removed: 1 });
    expect(h.validated).toEqual([]);
    expect(readdirSync(dir).sort()).toEqual(["alpha-architect.json", "alpha-developer.json", "alpha-notes.json", "alpha-qa.json", "beta-qa-ffffff.json", "other.json"]);
  });
});

describe("team store", () => {
  it("moves an unreadable file aside and starts empty", () => {
    const file = path.join(tmp, "teams.json");
    writeFileSync(file, "{ nope");
    const store = new TeamStore({ file, now: () => 7 });
    expect(store.projectIds()).toEqual([]);
    expect(existsSync(`${file}.bad-7`)).toBe(true);
    expect(existsSync(file)).toBe(false);
  });

  it("moves a file with the wrong shape aside", () => {
    const file = path.join(tmp, "teams.json");
    writeFileSync(file, JSON.stringify({ alpha: [{ id: "x", displayName: "A", templateId: "qa", role: "qa", model: "--trust-all-tools" }] }));
    expect(new TeamStore({ file, now: () => 8 }).get("alpha")).toBeUndefined();
    expect(existsSync(`${file}.bad-8`)).toBe(true);
  });

  it("does not mistake object prototype names for projects", () => {
    const store = new TeamStore({ file: path.join(tmp, "teams.json") });
    for (const name of ["constructor", "toString", "hasOwnProperty"]) expect(store.get(name)).toBeUndefined();
  });
});

describe("model list", () => {
  it("reads the ids of `kiro-cli chat --list-models --format json`, after any text before the JSON", () => {
    const out = `warning: something\n${JSON.stringify({ models: [{ model_id: "auto" }, { model_id: "claude-haiku-5.5" }, { model_id: "--bad" }] })}`;
    expect(parseModelList(out)).toEqual(["auto", "claude-haiku-5.5"]);
    expect(() => parseModelList("no json here")).toThrow();
  });

  it("every role lists models in the rules file", () => {
    for (const role of TEAM_ROLES) expect(rules.allowedModels[role].length).toBeGreaterThan(0);
  });
});

describe("kiro-cli arguments for a team member", () => {
  const rt = new KiroCliRuntime({ kiroHome: path.join(os.tmpdir(), "kh"), models: { qa: "claude-haiku-5.5" } });

  it("uses the member's agent and model, else the role's", () => {
    expect(rt.buildArgs("qa")).toEqual(expect.arrayContaining(["--agent", "agentlife-qa", "--model", "claude-haiku-5.5"]));
    const args = rt.buildArgs("qa", { agent: "alpha-qa-000001", model: "gpt-5.6-terra" });
    expect(args.slice(args.indexOf("--agent"))).toEqual(["--agent", "alpha-qa-000001", "--model", "gpt-5.6-terra"]);
    expect(args.join(" ")).not.toMatch(/--trust/);
  });

  it("refuses values that could pass as flags or paths", () => {
    for (const agent of ["--trust-all-tools", "a b", "../x", "A", ""]) expect(() => rt.buildArgs("qa", { agent }), agent).toThrow(KiroCliError);
    for (const model of ["--trust-all-tools", "a b", "-x", "", "m;rm"]) expect(() => rt.buildArgs("qa", { model }), model).toThrow(KiroCliError);
  });
});

describe("runRole with a team", () => {
  it("passes the member's agent and model to the runtime and shows the model with the work", async () => {
    const store = new Store({ dbPath: ":memory:", runsDir: path.join(tmp, "runs") });
    try {
      const seen: RuntimeInput[] = [];
      const rt: AgentRuntime = {
        id: "spy",
        async *run(input): AsyncIterable<RuntimeEvent> {
          seen.push(input);
          yield { kind: "output", text: "ok" };
        },
      };
      const member: ResolvedMember = { memberId: "qa-1", agent: "alpha-qa-1", model: "gpt-5.6-terra", displayName: "Vera" };
      const asked: string[] = [];
      const deps: PipelineDeps = {
        runtimes: { architect: rt, developer: rt, qa: rt },
        store,
        paths: dataPaths(path.join(tmp, "data")),
        repos: [],
        limits: { timeoutsMs: { analyze: 1, develop: 1, test: 1, review: 1 }, maxDiffLines: 1, maxFilesChanged: 1 },
        models: { qa: "claude-haiku-5.5" },
        team: {
          resolve: (p, t, r) => {
            asked.push(`${p}/${t}/${r}`);
            return r === "qa" ? member : undefined;
          },
        },
      };
      store.appendEvent({ type: "task.created", taskId: "task-1", repoId: "alpha", goal: "g" });
      const ctx = { taskId: "task-1", repoId: "alpha", goal: "g", signal: new AbortController().signal, timeoutMs: 1000, stepIndex: 1 };
      await runRole(deps, "qa", "review", ctx, "prompt", tmp);
      await runRole(deps, "developer", "develop", ctx, "prompt", tmp);
      expect(asked).toEqual(["alpha/task-1/qa", "alpha/task-1/developer"]);
      expect(seen[0]).toMatchObject({ role: "qa", agent: "alpha-qa-1", model: "gpt-5.6-terra" });
      expect(seen[1]).not.toHaveProperty("agent");
      expect(seen[1]).not.toHaveProperty("model");
      const work = store.eventsFor("task-1").filter((e) => e.type === "agent.work");
      expect(work.map((e) => (e.type === "agent.work" ? e.model : undefined))).toContain("gpt-5.6-terra");
      expect(work.map((e) => (e.type === "agent.work" ? e.model : undefined))).not.toContain("claude-haiku-5.5");
    } finally {
      store.close();
    }
  });
});
