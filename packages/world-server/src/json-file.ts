import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** What the readers need of a schema (zod's `parse`), so this file does not depend on zod itself. */
export interface Parser<T> {
  parse(input: unknown): T;
}

export interface ReadOptions {
  now?: () => number;
  onLog?: (message: string) => void;
}

/**
 * Reads a JSON file the user's data lives in. A missing file gives `undefined`. A file that cannot be read, is not
 * JSON or fails the schema is renamed `<file>.bad-<time>` and gives `undefined`, so the caller starts empty and the
 * old content is never overwritten by accident.
 */
export function readJsonFile<T>(file: string, schema: Parser<T>, opts: ReadOptions = {}): T | undefined {
  if (!existsSync(file)) return undefined;
  try {
    return schema.parse(JSON.parse(readFileSync(file, "utf8")));
  } catch (e) {
    const aside = `${file}.bad-${(opts.now ?? Date.now)()}`;
    opts.onLog?.(`${file} is unreadable, moved aside to ${aside}: ${e instanceof Error ? e.message : String(e)}`);
    try {
      renameSync(file, aside);
    } catch {
      // Nothing better can be done here; the next save would replace it.
    }
    return undefined;
  }
}

/** Writes a temporary file in the same folder, then renames it over the target: a reader sees the old file or the new one. Throws when it cannot. */
export function writeJsonFile(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(tmp, file);
}
