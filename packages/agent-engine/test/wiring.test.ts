import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.ts";
import { buildRuntimes, startEngine, type Engine } from "../src/engine.ts";
import { dataPaths } from "../src/paths.ts";
import { Store } from "../src/store.ts";
import { createPipelineSteps } from "../src/steps/index.ts";

const engines: Engine[] = [];
const dirs: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  while (engines.length) await engines.pop()?.close();
  while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

function tmp(): string {
  const d = mkdtempSync(path.join(os.tmpdir(), "agentlife-wiring-"));
  dirs.push(d);
  return d;
}

describe("runtime selection", () => {
  it("ships kiro-cli for the three roles", () => {
    const { agents } = loadConfig();
    expect([agents.architect.runtime, agents.developer.runtime, agents.qa.runtime]).toEqual(["kiro-cli", "kiro-cli", "kiro-cli"]);
  });

  it("RUNTIME=fake forces FakeRuntime for every role", () => {
    vi.stubEnv("RUNTIME", "fake");
    const rt = buildRuntimes(loadConfig(), 0, tmp());
    expect([rt.architect.id, rt.developer.id, rt.qa.id]).toEqual(["fake", "fake", "fake"]);
  });

  it("uses KiroCliRuntime when RUNTIME is not fake", () => {
    vi.stubEnv("RUNTIME", "");
    const rt = buildRuntimes(loadConfig(), 0, tmp());
    expect([rt.architect.id, rt.developer.id, rt.qa.id]).toEqual(["kiro-cli", "kiro-cli", "kiro-cli"]);
  });
});

describe("startEngine with kiro-cli roles", () => {
  it("installs the role agents and starts without spawning kiro-cli", async () => {
    vi.stubEnv("RUNTIME", "");
    const dataDir = tmp();
    const engine = await startEngine({ dataDir, storeOptions: { dbPath: ":memory:" }, port: 0 });
    engines.push(engine);
    expect(existsSync(path.join(dataPaths(dataDir).kiroHome, "agents", "agentlife-architect.json"))).toBe(true);
    const res = await fetch(`http://127.0.0.1:${engine.port}/health`);
    expect(res.status).toBe(200);
  });

  it("does not install agents under RUNTIME=fake", async () => {
    const dataDir = tmp();
    const engine = await startEngine({ dataDir, storeOptions: { dbPath: ":memory:" }, port: 0 });
    engines.push(engine);
    expect(existsSync(dataPaths(dataDir).kiroHome)).toBe(false);
  });
});

describe("createPipelineSteps", () => {
  it("exposes the five steps, the branch review and the dependency audit", () => {
    const config = loadConfig();
    const store = new Store({ dbPath: ":memory:", runsDir: tmp() });
    const steps = createPipelineSteps({
      runtimes: buildRuntimes(config, 0, tmp()),
      store,
      paths: dataPaths(tmp()),
      repos: config.repos,
      limits: config.limits,
    });
    expect(Object.keys(steps).sort()).toEqual(["analyze", "auditDeps", "develop", "report", "review", "reviewBranch", "test"]);
    store.close();
  });
});
