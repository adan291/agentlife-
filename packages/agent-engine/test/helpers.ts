import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ENGINE_IDENTITY, git } from "../src/git.ts";

/** Fake secrets are built at runtime so that no key-shaped literal sits in the repository. */
export const fakeKiroKey = (): string => ["ksk", "_", "q1W2e3R4t5Y6u7I8o9P0"].join("");

export interface MakeRepoOptions {
  /** Default true. `false` leaves an empty repository. */
  commit?: boolean;
  branch?: string;
}

/** A real git repository with the given files, committed by a fixed identity. Returns its directory. */
export async function makeRepo(dir: string, files: Record<string, string>, opts: MakeRepoOptions = {}): Promise<string> {
  mkdirSync(dir, { recursive: true });
  await git(dir, ["init", "--quiet", `--initial-branch=${opts.branch ?? "main"}`, "--template="], { identity: ENGINE_IDENTITY });
  await git(dir, ["config", "core.autocrlf", "false"]);
  await git(dir, ["config", "commit.gpgsign", "false"]);
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  if (opts.commit !== false) await commitAll(dir, "first commit");
  return dir;
}

export async function commitAll(dir: string, message: string): Promise<string> {
  await git(dir, ["add", "-A"]);
  await git(dir, ["commit", "--quiet", "--allow-empty", "-m", message], { identity: ENGINE_IDENTITY, date: "2026-02-02T00:00:00Z" });
  return (await git(dir, ["rev-parse", "HEAD"])).trim();
}

/** A small Node project with a lockfile, so it is detected as `node-npm`. */
export const NODE_FILES: Record<string, string> = {
  "package.json": JSON.stringify({ name: "demo", version: "1.0.0", scripts: { test: "node test.js" } }, null, 2),
  "package-lock.json": JSON.stringify({ name: "demo", lockfileVersion: 3, packages: {} }, null, 2),
  "index.js": "module.exports = 1;\n",
  "test.js": "process.exit(0);\n",
};
