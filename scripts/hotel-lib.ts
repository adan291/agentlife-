// Pure helpers of `pnpm hotel` (scripts/hotel.ts), kept apart so they are unit tested.

/** Ports the hotel uses: engine, world-server, client. */
export const HOTEL_PORTS = { engine: 8788, world: 8787, client: 5173 } as const;

/** Keys of the AI providers other than Kiro (multi-runtime). Only the engine gets them; they are never printed. */
export const PROVIDER_KEYS = ["GROQ_API_KEY", "XAI_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY"] as const;

/** Variables `pnpm hotel` reads from `.env`. Anything else in the file is ignored, so nothing unexpected reaches a process. */
export const ENV_KEYS = ["KIRO_API_KEY", "LLM_BASE_URL", "LLM_MODEL", "ENGINE_TOKEN", ...PROVIDER_KEYS] as const;
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
  /** Scripted agents: no credits, no Docker needed. */
  fake: boolean;
  /** Real agents even if something looks missing (the engine then reports the problem itself). */
  real: boolean;
  /** The AI the three roles run on for this run (`ollama`, `xai`, `groq`...), multi-runtime. */
  ai?: string;
  /** The model for `ai`. */
  model?: string;
  /** Open the browser when the client is up. */
  open: boolean;
  /** Stop whatever already listens on the hotel's ports before starting. */
  restart: boolean;
  help: boolean;
}

const PROVIDER_ID = /^[a-z][a-z0-9-]{0,29}$/;
const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,119}$/;

/** Command-line flags of `pnpm hotel`. Unknown or malformed flags are returned so the launcher can refuse them. */
export function parseArgs(argv: readonly string[]): { options: HotelOptions; unknown: string[] } {
  const options: HotelOptions = { fake: false, real: false, open: true, restart: false, help: false };
  const unknown: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const valued = (name: string): string | undefined => {
      if (a === name) return argv[++i];
      if (a.startsWith(`${name}=`)) return a.slice(name.length + 1);
      return undefined;
    };
    const ai = valued("--ai");
    const model = ai === undefined ? valued("--model") : undefined;
    if (ai !== undefined) {
      if (PROVIDER_ID.test(ai)) options.ai = ai;
      else unknown.push(`--ai ${ai}`);
    } else if (model !== undefined) {
      if (MODEL_NAME.test(model)) options.model = model;
      else unknown.push(`--model ${model}`);
    } else if (a === "--fake") options.fake = true;
    else if (a === "--real") options.real = true;
    else if (a === "--no-open") options.open = false;
    else if (a === "--restart") options.restart = true;
    else if (a === "--help" || a === "-h") options.help = true;
    else if (a !== "--") unknown.push(a);
  }
  return { options, unknown };
}

export interface ModeInput {
  options: Pick<HotelOptions, "fake" | "real" | "ai">;
  hasKiroKey: boolean;
  dockerUp: boolean;
  /** Ollama answers on this computer. */
  ollamaUp?: boolean;
  /** Providers whose key is set (`providerOfKey`), used when there is neither a Kiro key nor Ollama. */
  cloudReady?: readonly string[];
}

/** The provider id of a key of `PROVIDER_KEYS`: `XAI_API_KEY` → `xai`. */
export function providerOfKey(key: (typeof PROVIDER_KEYS)[number]): string {
  return key.replace(/_API_KEY$/, "").toLowerCase();
}

export interface Mode {
  runtime: "real" | "fake";
  /** The AI the roles run on when it is not Kiro (passed to the engine as AGENTLIFE_PROVIDER). */
  ai?: string;
  /** Lines to show the user, why this mode was chosen and what it means. */
  notes: string[];
}

/**
 * Real agents need an AI and Docker (the tests of a job run there). The AI is Kiro when its key is set, the one asked
 * with `--ai`, or Ollama when there is no Kiro key and Ollama runs here. Without them the hotel still starts, with
 * scripted agents, and says why. `--fake` always wins; `--real` keeps real agents even when a check fails.
 */
export function decideMode(input: ModeInput): Mode {
  if (input.options.fake) return { runtime: "fake", notes: ["Scripted agents (--fake): no credits and no Docker needed."] };
  const fallback = input.hasKiroKey ? undefined : input.ollamaUp ? "ollama" : input.cloudReady?.[0];
  const ai = input.options.ai ?? fallback;
  const onKiro = ai === undefined || ai === "kiro";
  const missing: string[] = [];
  if (onKiro && !input.hasKiroKey) missing.push("KIRO_API_KEY is not set (put it in .env, see .env.example), no Ollama is running and no other AI key is set");
  if (!input.dockerUp) missing.push("Docker is not running (start Docker Desktop)");
  const why = ai === "ollama" ? "no Kiro key, Ollama found" : `no Kiro key, ${ai} key found`;
  const what = onKiro ? "kiro-cli for the team" : `${ai} for the team${input.options.ai ? "" : ` (${why})`}`;
  const withAi = (m: Mode): Mode => (onKiro ? m : { ...m, ai: ai! });
  if (missing.length === 0) return withAi({ runtime: "real", notes: [`Real agents: ${what}, tests in Docker.`] });
  if (input.options.real) return withAi({ runtime: "real", notes: [`Real agents (--real): ${what}, although:`, ...missing.map((m) => `  - ${m}`)] });
  return {
    runtime: "fake",
    notes: ["Scripted agents, because:", ...missing.map((m) => `  - ${m}`), "Fix that and run `pnpm hotel` again, or `pnpm hotel --real` to force real agents."],
  };
}

export const HELP = `pnpm hotel: starts the whole AGENT LIFE hotel (engine, world-server, client) and opens it in the browser.

  pnpm hotel                    real agents when an AI and Docker are there, else scripted agents
  pnpm hotel --ai ollama        the team runs on Ollama (or lmstudio, groq, xai, openai, openrouter)
  pnpm hotel --ai xai --model grok-4   ... with that model
  pnpm hotel --fake             scripted agents (no credits, no Docker)
  pnpm hotel --real             real agents even if a check fails
  pnpm hotel --restart          stop whatever already listens on ports 8787, 8788 and 5173 first
  pnpm hotel --no-open          do not open the browser

Without KIRO_API_KEY the team runs on Ollama when it is running here. Keys of other AIs (GROQ_API_KEY, XAI_API_KEY,
OPENAI_API_KEY, OPENROUTER_API_KEY) go in .env; only the engine gets them. Members hired at the HR desk keep their own AI.
Ctrl+C stops everything. Logs of the three processes are shown here with a prefix.`;
