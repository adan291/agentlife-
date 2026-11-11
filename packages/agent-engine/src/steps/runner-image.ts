import { createHash } from "node:crypto";
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The Dockerfile shared by all test images: it installs the dependencies from a lockfile and nothing else. */
export const RUNNER_DOCKERFILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "docker", "runner.Dockerfile");

/** The part of `DockerExec` the image builder needs (the full type lives in test.ts, which imports this file). */
export type DockerBuildExec = (
  args: readonly string[],
  opts?: { signal?: AbortSignal },
) => Promise<{ code: number | null; output: string; spawnError?: Error }>;

/**
 * `agentlife-runner-<projectId>:<first 12 hex of sha256(package-lock.json)>`. A changed lockfile gives a new tag, so
 * the image is rebuilt exactly when the dependencies change and reused otherwise.
 */
export function runnerImageTag(projectId: string, lockfile: string | Uint8Array): string {
  const hash = createHash("sha256").update(lockfile).digest("hex").slice(0, 12);
  return `agentlife-runner-${projectId}:${hash}`;
}

export class RunnerImageBuildError extends Error {
  constructor(detail: string) {
    super(`runner_image_build_failed: ${detail}`);
    this.name = "RunnerImageBuildError";
  }
}

export interface BuildRunnerImageOptions {
  tag: string;
  /** Contents of the project's package.json and package-lock.json at the commit the job started from. */
  packageJson: string;
  lockfile: string;
  exec: DockerBuildExec;
  signal?: AbortSignal;
  dockerfile?: string;
}

/**
 * Builds the test image of a project from a temporary context that holds only the Dockerfile, package.json and
 * package-lock.json. `npm ci --ignore-scripts` runs inside the build (which has network access); the tests
 * later run from the finished image with no network at all.
 */
export async function buildRunnerImage(opts: BuildRunnerImageOptions): Promise<void> {
  const context = mkdtempSync(path.join(os.tmpdir(), "agentlife-runner-"));
  try {
    copyFileSync(opts.dockerfile ?? RUNNER_DOCKERFILE, path.join(context, "Dockerfile"));
    writeFileSync(path.join(context, "package.json"), opts.packageJson, "utf8");
    writeFileSync(path.join(context, "package-lock.json"), opts.lockfile, "utf8");
    const res = await opts.exec(["build", "--tag", opts.tag, context], opts.signal ? { signal: opts.signal } : {});
    opts.signal?.throwIfAborted();
    if (res.spawnError) throw new RunnerImageBuildError(`cannot start docker (${res.spawnError.message})`);
    if (res.code !== 0) {
      const tail = res.output.trim().split(/\r?\n/).slice(-6).join(" | ").slice(0, 400);
      throw new RunnerImageBuildError(tail || `docker build exited with ${String(res.code)}`);
    }
  } finally {
    rmSync(context, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}
