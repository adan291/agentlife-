import { MEMORY_TEXT_MAX, sanitize, type MemoryRejection } from "@agentlife/shared";
import { createLeakScanner, envSecretValues } from "@agentlife/shared/leaks";

/** A text the Library refuses. `message` is safe to show to the user and never repeats the text. */
export class MemoryRejectedError extends Error {
  readonly code: MemoryRejection;
  constructor(code: MemoryRejection, message: string) {
    super(message);
    this.name = "MemoryRejectedError";
    this.code = code;
  }
}

const MESSAGES: Record<MemoryRejection, string> = {
  empty: "The text is empty.",
  too_long: `The text is longer than ${MEMORY_TEXT_MAX} characters.`,
  path_or_secret: "The text holds a file path, a token or a NAME=value setting. Write it without them.",
  secret: "The text holds something that looks like a secret, an email address or a home folder.",
  duplicate: "The Library already holds this.",
  full: "The Library of this project is full. Delete entries you no longer need.",
};

export function rejection(code: MemoryRejection): MemoryRejectedError {
  return new MemoryRejectedError(code, MESSAGES[code]);
}

/** One line: control characters and runs of whitespace become one space. */
export function oneLineText(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f\u2028\u2029\s]+/g, " ").trim();
}

/**
 * The text an entry would be stored with, or a thrown `MemoryRejectedError`. The text is rejected, never cleaned: a
 * model that put a path or a token into a note should not have the rest of the note kept as if it were fine.
 *
 * - the same rules as every text that leaves the engine for the room (`sanitize`: no absolute paths, no token formats,
 *   no `NAME=value`), applied as a check: if sanitising would change the text, it is refused;
 * - the leak scanner of the repository scan: key formats, emails, home folders and the secrets of this machine's
 *   environment (`secrets` can add more, for tests).
 */
export function checkMemoryText(text: string, secrets: readonly string[] = envSecretValues()): string {
  const t = oneLineText(text);
  if (t === "") throw rejection("empty");
  if (t.length > MEMORY_TEXT_MAX) throw rejection("too_long");
  if (sanitize(t, t.length) !== t) throw rejection("path_or_secret");
  const scanner = createLeakScanner({ secrets });
  scanner.scanText(t, "memory");
  if (scanner.findings.length > 0) throw rejection("secret");
  return t;
}
