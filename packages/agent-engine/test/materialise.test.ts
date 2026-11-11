import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { git } from "../src/git.ts";
import { PROJECT_ROOT } from "../src/paths.ts";
import { isReservedAgentPath, materialise, MaterialiseError, MATERIALISE_MESSAGE } from "../src/steps/materialise.ts";

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "al-mat-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function writeSource(files: Record<string, string>, dir = "src-repo"): void {
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, dir, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
}

const repo = { id: "demo", source: "src-repo" };

describe("materialise", () => {
  it("copies the source into data/repos/<id> as a git repository with one commit by a fixed author", async () => {
    writeSource({ "package.json": "{}\n", "src/a.ts": "export const a = 1;\n", "node_modules/x/index.js": "x", ".git/HEAD": "ref" });
    const out = await materialise({ repo, projectRoot: root });
    expect(out.dir).toBe(path.join(root, "data", "repos", "demo"));
    expect(readFileSync(path.join(out.dir, "src", "a.ts"), "utf8")).toBe("export const a = 1;\n");
    expect(existsSync(path.join(out.dir, "node_modules"))).toBe(false);

    expect((await git(out.dir, ["rev-list", "--count", "HEAD"])).trim()).toBe("1");
    expect((await git(out.dir, ["log", "-1", "--format=%an <%ae>|%cn <%ce>|%s"])).trim()).toBe(
      `AGENT LIFE Engine <agents@agentlife.local>|AGENT LIFE Engine <agents@agentlife.local>|${MATERIALISE_MESSAGE}`,
    );
    expect((await git(out.dir, ["rev-parse", "--abbrev-ref", "HEAD"])).trim()).toBe("main");
    expect((await git(out.dir, ["status", "--porcelain"])).trim()).toBe("");
    expect((await git(out.dir, ["ls-files"])).trim().split("\n").sort()).toEqual(["package.json", "src/a.ts"]);
    expect(out.commit).toBe((await git(out.dir, ["rev-parse", "HEAD"])).trim());
  });

  it("starts every job from the same state: leftovers are removed and the commit id is stable", async () => {
    writeSource({ "a.txt": "a\n" });
    const first = await materialise({ repo, projectRoot: root });
    writeFileSync(path.join(first.dir, "junk.txt"), "junk");
    await git(first.dir, ["add", "-A"]);
    await git(first.dir, ["-c", "user.name=x", "-c", "user.email=x@x", "commit", "-q", "-m", "more"]);

    const second = await materialise({ repo, projectRoot: root });
    expect(existsSync(path.join(second.dir, "junk.txt"))).toBe(false);
    expect((await git(second.dir, ["rev-list", "--count", "HEAD"])).trim()).toBe("1");
    expect(second.commit).toBe(first.commit);
  });

  it("honours dataDir", async () => {
    writeSource({ "a.txt": "a\n" });
    const dataDir = path.join(root, "elsewhere");
    const out = await materialise({ repo, projectRoot: root, dataDir });
    expect(out.dir).toBe(path.join(dataDir, "repos", "demo"));
  });

  it("refuses a source that contains .kiro/agents/agentlife-* and leaves the previous repo alone", async () => {
    writeSource({ "a.txt": "a\n" });
    const ok = await materialise({ repo, projectRoot: root });
    writeSource({ ".kiro/agents/agentlife-developer.json": "{}" });
    await expect(materialise({ repo, projectRoot: root })).rejects.toThrow(MaterialiseError);
    await expect(materialise({ repo, projectRoot: root })).rejects.toThrow(/reserved agent/);
    expect(existsSync(path.join(ok.dir, "a.txt"))).toBe(true);
  });

  it("allows other files under .kiro", async () => {
    writeSource({ ".kiro/agents/my-agent.json": "{}", ".kiro/steering/x.md": "x" });
    const out = await materialise({ repo, projectRoot: root });
    expect((await git(out.dir, ["ls-files"])).trim().split("\n").sort()).toEqual([".kiro/agents/my-agent.json", ".kiro/steering/x.md"]);
  });

  it("refuses sources that escape the project, are absolute, missing or not directories", async () => {
    mkdirSync(path.join(root, "outside"));
    await expect(materialise({ repo: { id: "demo", source: "../outside" }, projectRoot: path.join(root, "outside") })).rejects.toThrow(/escapes/);
    await expect(materialise({ repo: { id: "demo", source: "." }, projectRoot: root })).rejects.toThrow(/escapes/);
    await expect(materialise({ repo: { id: "demo", source: path.join(root, "outside") }, projectRoot: root })).rejects.toThrow(/relative/);
    await expect(materialise({ repo: { id: "demo", source: "nope" }, projectRoot: root })).rejects.toThrow(/does not exist/);
    writeFileSync(path.join(root, "file.txt"), "x");
    await expect(materialise({ repo: { id: "demo", source: "file.txt" }, projectRoot: root })).rejects.toThrow(/not a directory/);
  });

  it("refuses unsafe repo ids", async () => {
    writeSource({ "a.txt": "a\n" });
    for (const id of ["", "..", "../x", "a/b", "A", "-x"]) {
      await expect(materialise({ repo: { id, source: "src-repo" }, projectRoot: root })).rejects.toThrow(/invalid repo id/);
    }
  });

  it("refuses symbolic links in the source", async () => {
    writeSource({ "a.txt": "a\n" });
    try {
      symlinkSync(path.join(root, "src-repo", "a.txt"), path.join(root, "src-repo", "link.txt"));
    } catch {
      return; // symlinks need privileges on some Windows setups
    }
    await expect(materialise({ repo, projectRoot: root })).rejects.toThrow(/symbolic link/);
  });

  it("materialises the real haunted-todo fixture", async () => {
    const out = await materialise({ repo: { id: "haunted-todo", source: "fixtures/repos/haunted-todo" }, projectRoot: PROJECT_ROOT, dataDir: path.join(root, "data") });
    const files = (await git(out.dir, ["ls-files"])).trim().split("\n");
    expect(files).toEqual(expect.arrayContaining(["package.json", "package-lock.json", "src/todo.ts", "test/todo.test.ts", "README.md"]));
    expect(files.some((f) => f.startsWith("node_modules"))).toBe(false);
  });
});

describe("isReservedAgentPath", () => {
  it("matches agentlife-* under .kiro/agents at any depth, ignoring case", () => {
    expect(isReservedAgentPath(".kiro/agents/agentlife-qa.json")).toBe(true);
    expect(isReservedAgentPath("sub/.KIRO/Agents/AgentLife-x.md")).toBe(true);
    expect(isReservedAgentPath(".kiro/agents/nested/agentlife-x.json")).toBe(true);
    expect(isReservedAgentPath(".kiro/agents/other.json")).toBe(false);
    expect(isReservedAgentPath("agents/agentlife-qa.json")).toBe(false);
    expect(isReservedAgentPath(".kiro/steering/agentlife-qa.md")).toBe(false);
  });
});

describe("cloneProject failure (review blocker)", () => {
  it("never names the user's path when git cannot clone", async () => {
    const { cloneProject } = await import("../src/steps/materialise.ts");
    const os = await import("node:os");
    const fsm = await import("node:fs");
    const p = await import("node:path");
    const dataDir = fsm.mkdtempSync(p.join(os.tmpdir(), "al-clonefail-"));
    const missing = p.join(dataDir, "Users", "someone", "secret-project");
    const err = await cloneProject({ id: "gone", sourcePath: missing, dataDir }).then(() => null, (e: unknown) => e as Error);
    expect(err).toBeInstanceOf(Error);
    expect(String(err?.message)).not.toContain(missing);
    expect(String(err?.message)).not.toContain("someone");
  });
});
