import { execFile } from "node:child_process";

export interface GitIdentity {
  name: string;
  email: string;
}

/** Author of the initial commit of a materialised repository. */
export const ENGINE_IDENTITY: GitIdentity = { name: "AGENT LIFE Engine", email: "agents@agentlife.local" };
/** Author of the commit that holds the Developer's change. */
export const DEVELOPER_IDENTITY: GitIdentity = { name: "AGENT LIFE Developer", email: "agents@agentlife.local" };

const MAX_BUFFER = 32 * 1024 * 1024;

export class GitError extends Error {
  readonly args: readonly string[];
  readonly exitCode: number | undefined;
  constructor(message: string, args: readonly string[], exitCode: number | undefined) {
    super(message);
    this.name = "GitError";
    this.args = args;
    this.exitCode = exitCode;
  }
}

/** Environment for git: no user or system config, no prompts, optional fixed identity and dates. */
export function gitEnv(identity?: GitIdentity, date?: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
  };
  for (const name of ["PATH", "SystemRoot", "windir", "TEMP", "TMP", "TMPDIR"]) {
    const v = process.env[name];
    if (v !== undefined) env[name] = v;
  }
  if (identity) {
    env["GIT_AUTHOR_NAME"] = identity.name;
    env["GIT_AUTHOR_EMAIL"] = identity.email;
    env["GIT_COMMITTER_NAME"] = identity.name;
    env["GIT_COMMITTER_EMAIL"] = identity.email;
  }
  if (date) {
    env["GIT_AUTHOR_DATE"] = date;
    env["GIT_COMMITTER_DATE"] = date;
  }
  return env;
}

export interface GitOptions {
  identity?: GitIdentity;
  /** Fixed author and committer date (ISO 8601), for reproducible commits. */
  date?: string;
  signal?: AbortSignal;
  /** Bytes to write to stdin. */
  input?: string;
}

/** Runs `git <args>` in `cwd` without a shell and returns stdout. Rejects with GitError on a non-zero exit. */
export function git(cwd: string, args: readonly string[], opts: GitOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "git",
      [...args],
      {
        cwd,
        env: gitEnv(opts.identity, opts.date),
        encoding: "utf8",
        maxBuffer: MAX_BUFFER,
        windowsHide: true,
        ...(opts.signal ? { signal: opts.signal } : {}),
      },
      (err, stdout, stderr) => {
        if (!err) return resolve(stdout);
        const code = typeof (err as { code?: unknown }).code === "number" ? (err as { code: number }).code : undefined;
        const tail = String(stderr || err.message).trim().split(/\r?\n/).slice(-5).join("\n");
        reject(new GitError(`git ${args[0] ?? ""} failed${code === undefined ? "" : ` (exit ${code})`}: ${tail}`, args, code));
      },
    );
    if (opts.input !== undefined) child.stdin?.end(opts.input);
  });
}

const RAW_MAX_BUFFER = 256 * 1024 * 1024;

/** Like `git()` but returns stdout as bytes, for `cat-file --batch`. `input` is written to stdin. */
export function gitRaw(cwd: string, args: readonly string[], input?: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "git",
      [...args],
      { cwd, env: gitEnv(), encoding: "buffer", maxBuffer: RAW_MAX_BUFFER, windowsHide: true },
      (err, stdout, stderr) => {
        if (!err) return resolve(stdout);
        const code = typeof (err as { code?: unknown }).code === "number" ? (err as { code: number }).code : undefined;
        const tail = String(stderr.length ? stderr.toString("utf8") : err.message).trim().split(/\r?\n/).slice(-5).join("\n");
        reject(new GitError(`git ${args[0] ?? ""} failed${code === undefined ? "" : ` (exit ${code})`}: ${tail}`, args, code));
      },
    );
    if (input !== undefined) child.stdin?.end(input);
  });
}
