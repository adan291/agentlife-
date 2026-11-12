import path from "node:path";
import { fileURLToPath } from "node:url";

/** Repository root (this file is packages/agent-engine/src/paths.ts). */
export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const DEFAULT_DATA_DIR = path.join(PROJECT_ROOT, "data");

export interface DataPaths {
  root: string;
  /** KIRO_HOME for product agents; role agents are installed into `<kiroHome>/agents`. */
  kiroHome: string;
  /** Materialised repositories, one per repo id. */
  repos: string;
  /** Git worktrees, one per task id. */
  worktrees: string;
  /** Run logs and artifacts, one directory per task id. */
  runs: string;
  /** The Library: `<projectId>.jsonl` per project (project-memory). */
  memory: string;
}

export function dataPaths(dataDir: string = DEFAULT_DATA_DIR): DataPaths {
  return {
    root: dataDir,
    kiroHome: path.join(dataDir, "kiro-home"),
    repos: path.join(dataDir, "repos"),
    worktrees: path.join(dataDir, "worktrees"),
    runs: path.join(dataDir, "runs"),
    memory: path.join(dataDir, "memory"),
  };
}

/** True when `child` is `parent` or lies inside it. Case-insensitive on Windows. Both paths are resolved first. */
export function isInside(parent: string, child: string): boolean {
  let p = path.resolve(parent);
  let c = path.resolve(child);
  if (process.platform === "win32") {
    p = p.toLowerCase();
    c = c.toLowerCase();
  }
  const rel = path.relative(p, c);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}
