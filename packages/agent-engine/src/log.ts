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
}

/** JSON-lines logger: `{ts, level, msg, taskId?, step?, ...}`. */
export function createJsonLogger(opts: JsonLoggerOptions = {}): Logger {
  const write = opts.write ?? ((line: string) => process.stdout.write(line + "\n"));
  const clock = opts.clock ?? Date.now;
  const emit = (level: LogLevel, msg: string, fields?: LogFields): void => {
    write(JSON.stringify({ ts: clock(), level, msg, ...fields }));
  };
  return {
    debug: (m, f) => emit("debug", m, f),
    info: (m, f) => emit("info", m, f),
    warn: (m, f) => emit("warn", m, f),
    error: (m, f) => emit("error", m, f),
  };
}
