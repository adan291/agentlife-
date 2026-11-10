import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { StepTimeoutError } from "../errors.ts";
import type { StepContext, TestResult } from "../jobs/steps.ts";
import { findRepo, worktreeDir, type PipelineDeps } from "./deps.ts";

export const RUNNER_IMAGE = "agentlife-runner:1";
export const RUNNER_BUILD_HINT = "pnpm --filter @agentlife/agent-engine runner:build";
/** The test log is cut to this size (the tail is kept, because the failure is at the end). */
export const MAX_TEST_LOG_BYTES = 200 * 1024;
const SECRET_NAME = /(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL)/i;

/** Docker is missing or its daemon does not answer. The step fails with this reason (requirement 6.5). */
export class DockerUnavailableError extends Error {
  constructor(detail: string) {
    super(`docker_unavailable: ${detail}`);
    this.name = "DockerUnavailableError";
  }
}

export interface DockerRunResult {
  /** Exit code of the docker client (for `docker run`, the container's exit code). */
  code: number | null;
  /** stdout and stderr in arrival order, tail-capped. */
  output: string;
  /** The client could not be started (docker not installed). */
  spawnError?: Error;
}

export interface DockerExecOptions {
  signal?: AbortSignal;
  maxOutputBytes?: number;
}
export type DockerExec = (args: readonly string[], opts?: DockerExecOptions) => Promise<DockerRunResult>;

function dockerEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !SECRET_NAME.test(k)) env[k] = v;
  return env;
}

/** Runs `docker <args>` without a shell. Aborting stops the client only; the caller kills the container. */
export const defaultDockerExec: DockerExec = (args, opts = {}) =>
  new Promise((resolve) => {
    const cap = opts.maxOutputBytes ?? 4 * MAX_TEST_LOG_BYTES;
    let out = "";
    let settled = false;
    const done = (r: DockerRunResult): void => {
      if (settled) return;
      settled = true;
      resolve(r);
    };
    const child = spawn("docker", [...args], { env: dockerEnv(), stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const onData = (chunk: Buffer): void => {
      out += chunk.toString("utf8");
      if (out.length > cap) out = out.slice(-cap);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("error", (error) => done({ code: null, output: out, spawnError: error }));
    child.once("close", (code) => done({ code, output: out }));
    const onAbort = (): void => {
      child.kill();
    };
    if (opts.signal) {
      if (opts.signal.aborted) onAbort();
      else opts.signal.addEventListener("abort", onAbort, { once: true });
    }
  });

export function containerName(taskId: string): string {
  return `al-${taskId}`;
}

export interface DockerRunSpec {
  taskId: string;
  /** Absolute host path of the worktree. Mounted read-only. */
  worktree: string;
  /** From config/repos.json. Never from a model or a user. */
  testCommand: string;
}

/**
 * Arguments of the sandboxed test run (requirement 6.1): no network, CPU, memory and process limits,
 * a read-only mount of the worktree copied into a size-limited tmpfs, no capabilities, a non-root user.
 */
export function buildRunArgs(spec: DockerRunSpec): string[] {
  const script = `cp -r /src/. /work/ && cd /work && ln -s /deps/node_modules node_modules && ${spec.testCommand}`;
  return [
    "run",
    "--rm",
    "--name",
    containerName(spec.taskId),
    "--network",
    "none",
    "--cpus",
    "1",
    "--memory",
    "512m",
    "--pids-limit",
    "256",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--read-only",
    "--tmpfs",
    "/tmp:rw,size=64m",
    "--tmpfs",
    "/work:rw,exec,size=256m,uid=1000,gid=1000",
    "-e",
    "HOME=/tmp",
    "-e",
    "CI=1",
    "-e",
    "FORCE_COLOR=0",
    "-e",
    "NO_COLOR=1",
    "-v",
    `${spec.worktree}:/src:ro`,
    RUNNER_IMAGE,
    "sh",
    "-c",
    script,
  ];
}

/** Keeps the last `maxBytes` of `log`, noting the cut at the top. */
export function truncateLog(log: string, maxBytes: number = MAX_TEST_LOG_BYTES): string {
  const buf = Buffer.from(log, "utf8");
  if (buf.length <= maxBytes) return log;
  const tail = buf.subarray(buf.length - maxBytes).toString("utf8").replace(/^\uFFFD+/, "");
  return `[log truncated: showing the last ${maxBytes} of ${buf.length} bytes]\n${tail}`;
}

function firstLine(text: string): string {
  return text.trim().split(/\r?\n/)[0]?.slice(0, 200) ?? "";
}

/**
 * Test step: runs the repo's `testCommand` on the Developer's worktree in a throwaway container.
 * Failing tests are a result (`passed: false`); a missing Docker, a missing image, a timeout and
 * cancellation are errors.
 */
export async function testStep(deps: PipelineDeps, ctx: StepContext, exec: DockerExec = defaultDockerExec): Promise<TestResult> {
  const repo = findRepo(deps, ctx.repoId);
  const worktree = worktreeDir(deps, ctx.taskId);
  if (!existsSync(worktree)) throw new Error(`worktree is missing: ${worktree}`);
  ctx.signal.throwIfAborted();

  const info = await exec(["version", "--format", "{{.Server.Version}}"], { signal: ctx.signal });
  ctx.signal.throwIfAborted();
  if (info.spawnError) throw new DockerUnavailableError(`cannot start docker (${info.spawnError.message})`);
  if (info.code !== 0) throw new DockerUnavailableError(firstLine(info.output) || `docker version exited with ${String(info.code)}`);
  const image = await exec(["image", "inspect", "--format", "{{.Id}}", RUNNER_IMAGE], { signal: ctx.signal });
  ctx.signal.throwIfAborted();
  if (image.code !== 0) throw new Error(`runner_image_missing: image ${RUNNER_IMAGE} not found; build it with: ${RUNNER_BUILD_HINT}`);

  const name = containerName(ctx.taskId);
  const killContainer = async (): Promise<void> => {
    await exec(["kill", name]).catch(() => undefined);
  };
  const ac = new AbortController();
  const onAbort = (): void => ac.abort(ctx.signal.reason);
  ctx.signal.addEventListener("abort", onAbort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ac.abort(new StepTimeoutError("test"));
  }, ctx.timeoutMs);
  // The container is killed as soon as anything aborts, without waiting for the docker client to notice.
  const onStop = (): void => void killContainer();
  ac.signal.addEventListener("abort", onStop, { once: true });
  try {
    const res = await exec(buildRunArgs({ taskId: ctx.taskId, worktree, testCommand: repo.testCommand }), { signal: ac.signal });
    if (ac.signal.aborted) {
      await killContainer();
      throw timedOut ? new StepTimeoutError("test") : ac.signal.reason;
    }
    if (res.spawnError) throw new DockerUnavailableError(`cannot start docker (${res.spawnError.message})`);
    return { passed: res.code === 0, log: truncateLog(res.output), ...(res.code === null ? {} : { exitCode: res.code }) };
  } finally {
    clearTimeout(timer);
    ctx.signal.removeEventListener("abort", onAbort);
    ac.signal.removeEventListener("abort", onStop);
  }
}
