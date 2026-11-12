import { spawn } from "node:child_process";
import type { MorningSummary, NightJob, NightRecord } from "@agentlife/shared";
import { noopLogger, type Logger } from "../log.ts";
import { buildSummary, discordFacts } from "./summary.ts";
import type { SummaryStore } from "./summary-store.ts";

/** Sends the facts of a night to the user's Discord. It rejects when the message could not be sent. */
export type NightNotifier = (facts: string) => Promise<void>;

export interface MorningReporterOptions {
  summaries: SummaryStore;
  /** The user turned the Discord message on (`discord` in `config/night.json`). Without it nothing is sent. */
  discord: boolean;
  notify?: NightNotifier | undefined;
  now?: () => number;
  logger?: Logger;
}

/**
 * What happens when the night window ends (requirement 4): the summary is written for the lobby mailbox, and, only
 * if the user enabled it, the facts go to Discord. A failing Discord call is logged and never undoes the summary.
 */
export function createMorningReporter(opts: MorningReporterOptions): (night: NightRecord, jobs: readonly NightJob[]) => Promise<MorningSummary> {
  const now = opts.now ?? Date.now;
  const log = opts.logger ?? noopLogger;
  return async (night, jobs) => {
    const summary = buildSummary(night, jobs, now());
    opts.summaries.put(summary);
    log.info("morning summary written", { night: night.key, jobs: summary.counts.total });
    if (opts.discord && opts.notify) {
      try {
        await opts.notify(discordFacts(summary));
      } catch (e) {
        log.warn("morning summary not sent to Discord", { error: e instanceof Error ? e.message : String(e) });
      }
    }
    return summary;
  };
}

/** Environment the notify script gets: where to find Discord and Ollama, nothing else (no model keys, no engine token). */
const NOTIFY_ENV = [
  "PATH",
  "Path",
  "SystemRoot",
  "SYSTEMROOT",
  "HOME",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "TEMP",
  "TMP",
  "DISCORD_BOT_TOKEN",
  "DISCORD_CHANNEL_ID",
  "DISCORD_USER_ID",
  "OLLAMA_URL",
  "OLLAMA_MODEL",
] as const;

export function notifyEnv(source: NodeJS.ProcessEnv, root: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const name of NOTIFY_ENV) {
    const v = source[name];
    if (v !== undefined) env[name] = v;
  }
  env["AGENTLIFE_ROOT"] = root;
  return env;
}

/** How long the notify script may run (Ollama waits up to 90 s, Discord 15 s). */
const NOTIFY_TIMEOUT_MS = 150_000;

/**
 * The notifier of the real engine: `scripts/notify.ts --overview` with the facts on its standard input (no shell, so
 * the text is never parsed as a command). The script asks the local Ollama for a three-sentence overview, if it is
 * running, and posts the facts and the overview to Discord. It spends no Kiro credits.
 */
export function createDiscordNotifier(opts: { root: string; scriptPath: string; timeoutMs?: number; env?: NodeJS.ProcessEnv }): NightNotifier {
  return (facts) =>
    new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", opts.scriptPath, "--overview"], {
        cwd: opts.root,
        env: notifyEnv(opts.env ?? process.env, opts.root),
        stdio: ["pipe", "ignore", "pipe"],
        windowsHide: true,
      });
      let stderr = "";
      child.stderr.on("data", (d: Buffer) => {
        stderr = (stderr + d.toString("utf8")).slice(-300);
      });
      const timer = setTimeout(() => child.kill(), opts.timeoutMs ?? NOTIFY_TIMEOUT_MS);
      child.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`notify exited with ${code}: ${stderr.trim()}`.slice(0, 400)));
      });
      child.stdin.on("error", () => undefined);
      child.stdin.end(facts, "utf8");
    });
}
