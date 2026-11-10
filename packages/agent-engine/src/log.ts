export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogFields {
  taskId?: string;
  step?: string;
  [key: string]: unknown;
}

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
}

export const noopLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };

export interface JsonLoggerOptions {
  /** Receives one JSON line (no trailing newline). Default: stdout. */
  write?: (line: string) => void;
  clock?: () => number;
  /** Applied to every line before it is written. */
  redact?: (text: string) => string;
}

export const REDACTED = "[redacted]";
const MIN_SECRET_CHARS = 6;
const SECRET_ENV_NAME = /(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL)/i;

/** Values of environment variables that look like secrets (KIRO_API_KEY, LLM_API_KEY, ENGINE_TOKEN, ...). */
export function collectSecrets(env: NodeJS.ProcessEnv = process.env, extra: readonly string[] = []): string[] {
  const out = new Set<string>(extra);
  for (const [name, value] of Object.entries(env)) {
    if (value && SECRET_ENV_NAME.test(name)) out.add(value);
  }
  return [...out].filter((s) => s.length >= MIN_SECRET_CHARS);
}

/**
 * Returns a function that replaces every occurrence of a secret (raw or JSON-escaped) with `[redacted]`.
 * Longer secrets are replaced first so a secret that contains another is fully removed.
 */
export function createRedactor(secrets: readonly string[]): (text: string) => string {
  const needles = new Set<string>();
  for (const s of secrets) {
    if (s.length < MIN_SECRET_CHARS) continue;
    needles.add(s);
    needles.add(JSON.stringify(s).slice(1, -1));
  }
  const sorted = [...needles].sort((a, b) => b.length - a.length);
  if (sorted.length === 0) return (t) => t;
  return (text) => {
    let out = text;
    for (const n of sorted) out = out.split(n).join(REDACTED);
    return out;
  };
}

/** JSON-lines logger: `{ts, level, msg, taskId?, step?, ...}`. */
export function createJsonLogger(opts: JsonLoggerOptions = {}): Logger {
  const write = opts.write ?? ((line: string) => process.stdout.write(line + "\n"));
  const clock = opts.clock ?? Date.now;
  const redact = opts.redact ?? ((t: string) => t);
  const emit = (level: LogLevel, msg: string, fields?: LogFields): void => {
    write(redact(JSON.stringify({ ts: clock(), level, msg, ...fields })));
  };
  return {
    debug: (m, f) => emit("debug", m, f),
    info: (m, f) => emit("info", m, f),
    warn: (m, f) => emit("warn", m, f),
    error: (m, f) => emit("error", m, f),
  };
}
