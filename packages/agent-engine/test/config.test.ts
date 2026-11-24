import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG_DIR, loadConfig, withProviderOverride } from "../src/config.ts";

const dirs: string[] = [];
function copyConfig(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "agentlife-cfg-"));
  dirs.push(dir);
  cpSync(DEFAULT_CONFIG_DIR, dir, { recursive: true });
  return dir;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("loadConfig", () => {
  it("loads the shipped config", () => {
    const cfg = loadConfig();
    expect(cfg.repos.map((r) => r.id)).toContain("haunted-todo");
    expect(cfg.limits.timeoutsMs.analyze).toBe(300000);
    expect(cfg.agents.ambient.runtime).toBe("llm");
    expect(cfg.agents.architect.runtime).toBe("kiro-cli");
  });

  it("reports an invalid runtime with file and path", () => {
    const dir = copyConfig();
    writeFileSync(
      path.join(dir, "agents.json"),
      JSON.stringify({ architect: { runtime: "gpt" }, developer: { runtime: "fake" }, qa: { runtime: "fake" }, ambient: { runtime: "none" } }),
    );
    expect(() => loadConfig(dir)).toThrow(/agents\.json is invalid: architect\.runtime/);
  });

  it("reports malformed JSON and missing files", () => {
    const dir = copyConfig();
    writeFileSync(path.join(dir, "limits.json"), "{ nope");
    expect(() => loadConfig(dir)).toThrow(/limits\.json is not valid JSON/);
    expect(() => loadConfig(path.join(dir, "missing"))).toThrow(/cannot read/);
  });

  it("rejects duplicate ids and sources outside the project", () => {
    const dir = copyConfig();
    const repo = { id: "a", name: "A", source: "x", testCommand: "t" };
    writeFileSync(path.join(dir, "repos.json"), JSON.stringify([repo, repo]));
    expect(() => loadConfig(dir)).toThrow(/duplicate repo id/);
    writeFileSync(path.join(dir, "repos.json"), JSON.stringify([{ ...repo, source: "../outside" }]));
    expect(() => loadConfig(dir)).toThrow(/escapes the project/);
    writeFileSync(path.join(dir, "repos.json"), JSON.stringify([{ ...repo, source: path.resolve("abs") }]));
    expect(() => loadConfig(dir)).toThrow(/relative/);
  });
});

describe("withProviderOverride (pnpm hotel --ai)", () => {
  const agents = loadConfig(DEFAULT_CONFIG_DIR, {}).agents;
  it("does nothing without AGENTLIFE_PROVIDER or with kiro", () => {
    expect(withProviderOverride(agents, {})).toEqual(agents);
    expect(withProviderOverride(agents, { AGENTLIFE_PROVIDER: "kiro", AGENTLIFE_MODEL: "x" })).toEqual(agents);
  });
  it("puts the three roles on the provider, with the model when given", () => {
    const cfg = withProviderOverride(agents, { AGENTLIFE_PROVIDER: "ollama", AGENTLIFE_MODEL: "qwen3.5:4b" });
    for (const role of ["architect", "developer", "qa"] as const) expect(cfg[role]).toEqual({ provider: "ollama", model: "qwen3.5:4b" });
    expect(cfg.ambient).toEqual(agents.ambient);
    expect(withProviderOverride(agents, { AGENTLIFE_PROVIDER: "xai" }).qa).toEqual({ provider: "xai" });
  });
  it("keeps a fake role and refuses a malformed id", () => {
    const fake = { ...agents, qa: { runtime: "fake" as const } };
    expect(withProviderOverride(fake, { AGENTLIFE_PROVIDER: "groq" }).qa).toEqual({ runtime: "fake" });
    expect(() => withProviderOverride(agents, { AGENTLIFE_PROVIDER: "../x" })).toThrow(/not a provider id/);
  });
  it("loadConfig applies it", () => {
    expect(loadConfig(DEFAULT_CONFIG_DIR, { AGENTLIFE_PROVIDER: "ollama" }).agents.developer.provider).toBe("ollama");
  });
});
