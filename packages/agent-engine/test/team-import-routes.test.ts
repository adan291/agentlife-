import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CatalogueResponseSchema, CatalogueSourcesResponseSchema, ImportListResponseSchema, ImportViewSchema, TeamMemberSchema } from "@agentlife/shared";
import { startEngine, type Engine } from "../src/engine.ts";
import { AgentFileSchema } from "../src/agents.ts";
import { ModelDirectory, loadTeamRules } from "../src/team/models.ts";
import { installServiceAgents, serviceAgentName } from "../src/team/service-agents.ts";
import { loadTiers } from "../src/team/tiers.ts";

const URL_A = "https://templates.example.org/agents/poet.json";

let tmp: string;
let engine: Engine | undefined;
let served: unknown;
let requested: string[];
beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "al-import-http-"));
  requested = [];
  served = {
    id: "poet-qa",
    name: "Poet QA",
    role: "qa",
    persona: "You are a QA who writes every finding as a short, calm verse and still gives a clear verdict.",
    description: "A QA that explains its findings in verse.",
    defaultModel: "claude-haiku-5.5",
    tools: ["shell", "write"],
    permissions: { rules: [{ capability: "shell", match: ["*"], effect: "allow" }] },
  };
});
afterEach(async () => {
  await engine?.close();
  engine = undefined;
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

async function boot(sources: string[] = [URL_A]): Promise<string> {
  engine = await startEngine({
    storeOptions: { dbPath: ":memory:", runsDir: path.join(tmp, "runs") },
    dataDir: tmp,
    port: 0,
    team: {
      file: path.join(tmp, "teams.json"),
      models: new ModelDirectory({ rules: loadTeamRules(), list: async () => ["auto", "claude-haiku-5.5", "claude-sonnet-5.5"] }),
      agents: { kiroHome: path.join(tmp, "kiro-home") },
    },
    imports: {
      file: path.join(tmp, "catalogue-imports.json"),
      sources,
      fetch: async (u) => {
        requested.push(u);
        return new Response(JSON.stringify(served), { status: 200 });
      },
    },
  });
  return `http://127.0.0.1:${engine.port}`;
}

const send = (url: string, method: string, body?: unknown) =>
  fetch(url, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

describe("import routes", () => {
  it("imports, waits for approval, then the template can be hired with the tier's permissions only", async () => {
    const url = await boot();
    expect(CatalogueSourcesResponseSchema.parse(await (await fetch(`${url}/catalogue/sources`)).json())).toEqual({ sources: [URL_A] });

    const imported = await send(`${url}/catalogue/imports`, "POST", { url: URL_A });
    expect(imported.status).toBe(201);
    const view = ImportViewSchema.parse(await imported.json());
    expect(view).toMatchObject({ id: "poet-qa", status: "pending", ignored: ["tools", "permissions"], tier: "read-only" });

    // Not hireable yet, and not in the catalogue.
    const list = CatalogueResponseSchema.parse(await (await fetch(`${url}/catalogue`)).json());
    expect(list.some((e) => e.id === "poet-qa")).toBe(false);
    const early = await send(`${url}/projects/haunted-todo/team`, "POST", { templateId: "poet-qa", displayName: "Poe" });
    expect(early.status).toBe(404);

    const wrong = await send(`${url}/catalogue/imports/poet-qa/approve`, "POST", { hash: "f".repeat(64) });
    expect(wrong.status).toBe(409);
    expect(await wrong.json()).toMatchObject({ error: "content_changed" });
    expect((await send(`${url}/catalogue/imports/poet-qa/approve`, "POST", { hash: "nope" })).status).toBe(400);

    const approved = await send(`${url}/catalogue/imports/poet-qa/approve`, "POST", { hash: view.hash });
    expect(approved.status).toBe(200);
    expect(ImportViewSchema.parse(await approved.json()).status).toBe("approved");
    const after = CatalogueResponseSchema.parse(await (await fetch(`${url}/catalogue`)).json());
    expect(after.find((e) => e.id === "poet-qa")).toMatchObject({ origin: "imported", source: URL_A, tier: "read-only", role: "qa" });

    const hired = await send(`${url}/projects/haunted-todo/team`, "POST", { templateId: "poet-qa", displayName: "Poe" });
    expect(hired.status).toBe(201);
    const member = TeamMemberSchema.parse(await hired.json());
    const agent = AgentFileSchema.parse(JSON.parse(readFileSync(path.join(tmp, "kiro-home", "agents", `haunted-todo-${member.id}.json`), "utf8")));
    const tier = loadTiers()["read-only"];
    expect(agent.tools).toEqual(tier.tools);
    expect(agent.permissions).toEqual(tier.permissions);
    expect(agent.prompt).toContain("short, calm verse");
    expect(JSON.stringify(agent)).not.toContain('"shell","write"');

    expect(ImportListResponseSchema.parse(await (await fetch(`${url}/catalogue/imports`)).json())).toHaveLength(1);
  });

  it("refuses an address that is not listed without making a request", async () => {
    const url = await boot();
    const res = await send(`${url}/catalogue/imports`, "POST", { url: "https://other.example.org/x.json" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "source_not_allowed" });
    expect((await send(`${url}/catalogue/imports`, "POST", { url: "http://templates.example.org/agents/poet.json" })).status).toBe(400);
    expect(requested).toEqual([]);
  });

  it("is off when no source is listed", async () => {
    const url = await boot([]);
    expect(CatalogueSourcesResponseSchema.parse(await (await fetch(`${url}/catalogue/sources`)).json())).toEqual({ sources: [] });
    const res = await send(`${url}/catalogue/imports`, "POST", { url: URL_A });
    expect(res.status).toBe(400);
    expect(requested).toEqual([]);
  });

  it("answers a refused file with import_refused and an unknown import with 404", async () => {
    const url = await boot();
    served = { id: "x", name: "X", role: "qa", persona: "p".repeat(2500), description: "d", defaultModel: "auto" };
    const res = await send(`${url}/catalogue/imports`, "POST", { url: URL_A });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "import_refused" });
    expect((await send(`${url}/catalogue/imports/missing/approve`, "POST", { hash: "a".repeat(64) })).status).toBe(404);
    expect((await send(`${url}/catalogue/imports/missing/reject`, "POST")).status).toBe(404);
  });

  it("rejects an import that was never approved", async () => {
    const url = await boot();
    await send(`${url}/catalogue/imports`, "POST", { url: URL_A });
    expect((await send(`${url}/catalogue/imports/poet-qa/reject`, "POST")).status).toBe(200);
    expect(ImportListResponseSchema.parse(await (await fetch(`${url}/catalogue/imports`)).json())).toEqual([]);
  });
});

describe("service agents", () => {
  it("the import-review and HR agents are made from the read-only tier and nothing else", async () => {
    const kiroHome = path.join(tmp, "kiro-home");
    const tiers = loadTiers();
    const checked: string[] = [];
    const written = await installServiceAgents({ kiroHome, tiers, validate: async (f) => void checked.push(f) });
    expect(written).toEqual([serviceAgentName("import-review"), serviceAgentName("hr")]);
    expect(checked).toHaveLength(2);
    for (const name of ["agentlife-import-review", "agentlife-hr"]) {
      const agent = AgentFileSchema.parse(JSON.parse(readFileSync(path.join(kiroHome, "agents", `${name}.json`), "utf8")));
      expect(agent.tools, name).toEqual(tiers["read-only"].tools);
      expect(agent.permissions, name).toEqual(tiers["read-only"].permissions);
      expect(agent.prompt, name).toContain("untrusted data");
    }
    // An unchanged file is neither rewritten nor checked again.
    expect(await installServiceAgents({ kiroHome, tiers, validate: async (f) => void checked.push(f) })).toEqual([]);
    expect(checked).toHaveLength(2);
  });
});
