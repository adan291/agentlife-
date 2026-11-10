import { execFile } from "node:child_process";

/**
 * Kills a process and all of its descendants.
 * Windows: `taskkill /pid <pid> /T /F`. Elsewhere: signals the process group, so the child must have
 * been spawned with `detached: true` (it then leads its own group).
 * Resolves once the kill was attempted; never rejects (the process may already be gone).
 */
export function killTree(pid: number): Promise<void> {
  if (!Number.isInteger(pid) || pid <= 0) return Promise.resolve();
  if (process.platform === "win32") {
    return new Promise((resolve) => {
      execFile("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true }, () => resolve());
    });
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
  return Promise.resolve();
}
