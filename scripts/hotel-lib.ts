// Pure helpers of `pnpm hotel` (scripts/hotel.ts), kept apart so they are unit tested.

/** Ports the hotel uses: engine, world-server, client. */
export const HOTEL_PORTS = { engine: 8788, world: 8787, client: 5173 } as const;

/** Variables `pnpm hotel` reads from `.env`. Anything else in the file is ignored, so nothing unexpected reaches a process. */
export const ENV_KEYS = ["KIRO_API_KEY", "LLM_BASE_URL", "LLM_MODEL", "ENGINE_TOKEN"] as const;
export type EnvKey = (typeof ENV_KEYS)[number];

/**
 * Reads `KEY=value` lines of a `.env` file: comments and blank lines are skipped, surrounding quotes are removed,
 * and only the keys of `ENV_KEYS` are kept.
 */
export function parseEnvFile(text: string): Partial<Record<EnvKey, string>> {
  const out: Partial<Record<EnvKey, string>> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, "");
    if (!(ENV_KEYS as readonly string[]).includes(key)) continue;
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (value !== "") out[key as EnvKey] = value;
  }
  return out;
}

export interface HotelOptions {
  /** Scripted agents: no Kiro credits, no Docker needed. */
  fake: boolean;
  /** Real agents even if something looks missing (the engine then reports the problem itself). */
  real: boolean;
  /** Open the browser when the client is up. */
  open: boolean;
  /** Stop whatever already listens on the hotel's ports before starting. */
  restart: boolean;
  help: boolean;
}

/** Command-line flags of `pnpm hotel`. Unknown flags are returned so the launcher can refuse them. */
export function parseArgs(argv: readonly string[]): { options: HotelOptions; unknown: string[] } {
  const options: HotelOptions = { fake: false, real: false, open: true, restart: false, help: false };
  const unknown: string[] = [];
  for (const a of argv) {
    if (a === "--fake") options.fake = true;
    else if (a === "--real") options.real = true;
    else if (a === "--no-open") options.open = false;
    else if (a === "--restart") options.restart = true;
    else if (a === "--help" || a === "-h") options.help = true;
    else if (a !== "--") unknown.push(a);
  }
  return { options, unknown };
}

export interface ModeInput {
  options: Pick<HotelOptions, "fake" | "real">;
  hasKiroKey: boolean;
  dockerUp: boolean;
}

export interface Mode {
  runtime: "real" | "fake";
  /** Lines to show the user, why this mode was chosen and what it means. */
  notes: string[];
}

/**
 * Real agents need a Kiro key and Docker. Without them the hotel still starts, with scripted agents, and says why.
 * `--fake` always wins; `--real` keeps real agents even when a check fails.
 */
export function decideMode(input: ModeInput): Mode {
  if (input.options.fake) return { runtime: "fake", notes: ["Scripted agents (--fake): no Kiro credits and no Docker needed."] };
  const missing: string[] = [];
  if (!input.hasKiroKey) missing.push("KIRO_API_KEY is not set (put it in .env, see .env.example)");
  if (!input.dockerUp) missing.push("Docker is not running (start Docker Desktop)");
  if (missing.length === 0) return { runtime: "real", notes: ["Real agents: kiro-cli for the team, tests in Docker."] };
  if (input.options.real) return { runtime: "real", notes: ["Real agents (--real), although:", ...missing.map((m) => `  - ${m}`)] };
  return {
    runtime: "fake",
    notes: ["Scripted agents, because:", ...missing.map((m) => `  - ${m}`), "Fix that and run `pnpm hotel` again, or `pnpm hotel --real` to force real agents."],
  };
}

export const HELP = `pnpm hotel: starts the whole AGENT LIFE hotel (engine, world-server, client) and opens it in the browser.

  pnpm hotel             real agents when KIRO_API_KEY and Docker are there, else scripted agents
  pnpm hotel --fake      scripted agents (no credits, no Docker)
  pnpm hotel --real      real agents even if a check fails
  pnpm hotel --restart   stop whatever already listens on ports 8787, 8788 and 5173 first
  pnpm hotel --no-open   do not open the browser

Ctrl+C stops everything. Logs of the three processes are shown here with a prefix.`;
