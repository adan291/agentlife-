import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TeamMemberSchema, TeamModelsResponseSchema, TeamResponseSchema } from "@agentlife/shared";
import { startEngine, type Engine } from "../src/engine.ts";
import { ModelDirectory, loadTeamRules } from "../src/team/models.ts";

let tmp: string;
let engine: Engine | undefined;
beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "al-team-http-"));
});
afterEach(async () => {
  await engine?.close();
  engine = undefined;
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

async function boot(): Promise<string> {
  engine = await startEngine({
    storeOptions: { dbPath: ":memory:", runsDir: path.join(tmp, "runs") },
    dataDir: tmp,
    port: 0,
    team: {
      file: path.join(tmp, "teams.json"),
      models: new ModelDirectory({ rules: loadTeamRules(), list: async () => ["auto", "claude-haiku-5.5", "claude-sonnet-5.5"] }),
      agents: { kiroHome: path.join(tmp, "kiro-home") },
    },
  });
  return `http://127.0.0.1:${engine.port}`;
}

const send = (url: string, method: string, body?: unknown) =>
  fetch(url, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

describe("team routes", () => {
  it("shows the default team, hires, renames, changes the model and fires", async () => {
    const url = await boot();
    const team = `${url}/projects/haunted-todo/team`;
    const first = TeamResponseSchema.parse(await (await fetch(team)).json());
    expect(first).toMatchObject({ projectId: "haunted-todo", customised: false });
    expect(first.members.map((m) => m.role)).toEqual(["architect", "developer", "qa"]);

    const hired = await send(team, "POST", { templateId: "qa-strict", displayName: "Vera" });
    expect(hired.status).toBe(201);
    const vera = TeamMemberSchema.parse(await hired.json());
    expect(vera).toMatchObject({ displayName: "Vera", role: "qa", model: "claude-sonnet-5.5" });
    expect(TeamResponseSchema.parse(await (await fetch(team)).json())).toMatchObject({ customised: true });
    expect(readdirSync(path.join(tmp, "kiro-home", "agents"))).toContain(`haunted-todo-${vera.id}.json`);

    const renamed = await send(`${team}/${vera.id}`, "PATCH", { displayName: "Vera Two", model: "auto" });
    expect(renamed.status).toBe(200);
    expect(TeamMemberSchema.parse(await renamed.json())).toMatchObject({ displayName: "Vera Two", model: "auto" });

    expect((await send(`${team}/${vera.id}`, "DELETE")).status).toBe(200);
    expect((await send(`${team}/${vera.id}`, "DELETE")).status).toBe(404);

    // The activity terminal got a line for each change, on the project's floor.
    const lines = engine!.store.eventsFor("team:haunted-todo").flatMap((e) => (e.type === "agent.activity" ? [[e.agentId, e.text]] : []));
    expect(lines).toEqual([
      ["haunted-todo:qa", "Hired Vera (Strict QA)"],
      ["haunted-todo:qa", "Renamed Vera to Vera Two"],
      ["haunted-todo:qa", "Vera Two now uses auto"],
      ["haunted-todo:qa", "Vera Two left the team"],
    ]);
  });

  it("answers the rule violations with 409 and a code, and bad input with 400 or 404", async () => {
    const url = await boot();
    const team = `${url}/projects/haunted-todo/team`;
    const last = await send(`${team}/architect`, "DELETE");
    expect(last.status).toBe(409);
    expect(await last.json()).toMatchObject({ error: "last_of_role" });
    expect(await (await send(team, "POST", { templateId: "qa", displayName: "QA" })).json()).toMatchObject({ error: "name_taken" });

    const badModel = await send(team, "POST", { templateId: "qa", displayName: "Vera", model: "claude-opus-5.5" });
    expect(badModel.status).toBe(400);
    expect(await badModel.json()).toMatchObject({ error: "model_not_allowed" });

    for (const body of [
      { templateId: "qa", displayName: "Vera", tools: ["shell"] }, // a template cannot bring permissions along
      { templateId: "qa", displayName: "Vera", permissions: { rules: [] } },
      { templateId: "qa", displayName: "<script>" },
      { templateId: "qa", displayName: "x".repeat(31) },
      { templateId: "../qa", displayName: "Vera" },
      { templateId: "qa", displayName: "Vera", model: "--trust-all-tools" },
      { displayName: "Vera" },
    ]) {
      expect((await send(team, "POST", body)).status, JSON.stringify(body)).toBe(400);
    }
    expect((await send(`${team}/architect`, "PATCH", {})).status).toBe(400);
    expect((await send(`${team}/architect`, "PATCH", { tier: "write-in-worktree" })).status).toBe(400);
    expect((await send(`${team}/ghost`, "PATCH", { displayName: "Ghost" })).status).toBe(404);
    expect((await send(`${team}/architect`, "PUT", {})).status).toBe(405);
    expect((await fetch(`${url}/projects/nope/team`)).status).toBe(404);
    expect((await send(`${url}/projects/nope/team`, "POST", { templateId: "qa", displayName: "Vera" })).status).toBe(404);
    expect((await send(team, "POST", { templateId: "nobody", displayName: "Vera" })).status).toBe(404);
    // Nothing above changed the team.
    expect(TeamResponseSchema.parse(await (await fetch(team)).json()).customised).toBe(false);
    expect(existsSync(path.join(tmp, "teams.json"))).toBe(false);
  });

  it("lists the models each role may use", async () => {
    const url = await boot();
    const { models } = TeamModelsResponseSchema.parse(await (await fetch(`${url}/team/models`)).json());
    expect(models["qa"]).toEqual(["auto", "claude-haiku-5.5", "claude-sonnet-5.5"]);
    expect(models["researcher"]).toEqual(["auto", "claude-haiku-5.5", "claude-sonnet-5.5"]);
  });

  it("a job started after a model change runs with the new model", async () => {
    const url = await boot();
    const changed = await send(`${url}/projects/haunted-todo/team/architect`, "PATCH", { model: "claude-sonnet-5.5", displayName: "Archie" });
    expect(changed.status).toBe(200);
    const started = await send(`${url}/tasks`, "POST", { repoId: "haunted-todo", goal: "Check the team model" });
    expect(started.status).toBe(201);
    const { taskId } = (await started.json()) as { taskId: string };
    const deadline = Date.now() + 10_000;
    let model: string | undefined;
    while (Date.now() < deadline && !model) {
      for (const e of engine!.store.eventsFor(taskId)) if (e.type === "agent.work" && e.agentId.endsWith(":architect")) model = e.model;
      if (!model) await new Promise((r) => setTimeout(r, 20));
    }
    expect(model).toBe("claude-sonnet-5.5");
    await send(`${url}/tasks/${taskId}/cancel`, "POST");
  });
});
