import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const fixture = path.join(root, "fixtures", "repos", "haunted-todo");
const read = (rel: string): string => readFileSync(path.join(fixture, rel), "utf8");

describe("fixture haunted-todo", () => {
  it("is the source of the configured repo", () => {
    const repo = loadConfig().repos.find((r) => r.id === "haunted-todo");
    expect(repo).toBeDefined();
    expect(path.resolve(root, repo!.source)).toBe(fixture);
    expect(repo!.testCommand).toBe("npm test");
  });

  it("has module, tests, README and lockfile, and no .kiro directory", () => {
    for (const f of ["package.json", "package-lock.json", "README.md", "src/todo.ts", "test/todo.test.ts"]) {
      expect(existsSync(path.join(fixture, f)), f).toBe(true);
    }
    expect(existsSync(path.join(fixture, ".kiro"))).toBe(false);
  });

  it("exports 3 to 4 functions", () => {
    const fns = [...read("src/todo.ts").matchAll(/^export function (\w+)/gm)].map((m) => m[1]);
    expect(fns.length).toBeGreaterThanOrEqual(3);
    expect(fns.length).toBeLessThanOrEqual(4);
  });

  it("seeds the three issues", () => {
    expect(read("test/todo.test.ts")).toMatch(/it\.skip\(/); // issue 1: bug with a skipped test
    expect(read("test/todo.test.ts")).not.toMatch(/summarize/); // issue 2: untested function
    expect(read("src/todo.ts")).toMatch(/export function summarize/);
    expect(read("src/todo.ts")).not.toMatch(/\.trim\(\)/); // issue 3: no title validation
    expect(read("README.md")).toMatch(/Known issues/);
  });

  it("is excluded from the pnpm workspace", () => {
    const ws = readFileSync(path.join(root, "pnpm-workspace.yaml"), "utf8");
    expect(ws).toMatch(/packages\/\*/);
    expect(ws).not.toMatch(/fixtures/);
    expect(JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).scripts.test).toBe("pnpm -r test");
  });
});
