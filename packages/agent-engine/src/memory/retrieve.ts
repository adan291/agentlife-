import { MEMORY_PROMPT_MAX_CHARS, type MemoryEntry } from "@agentlife/shared";
import { fence } from "../prompts.ts";
import { noopLogger, type Logger } from "../log.ts";
import type { MemoryStore } from "./store.ts";

/** Words that say nothing about what a job is about, in a goal or in a path. */
const STOP_WORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "into", "not", "are", "was", "were", "has", "have", "had", "but", "all", "any", "can", "its",
  "add", "fix", "make", "use", "new", "when", "then", "than", "they", "them", "their", "will", "should", "must", "also", "each", "does", "dont",
  "src", "lib", "test", "tests", "spec", "index", "main", "file", "files", "code", "js", "ts", "tsx", "jsx", "json", "md",
]);

/** Distinct keywords of a text: lower case, split on anything that is not a letter or digit and on camelCase, 3+ characters, no stop words, a trailing "s" dropped. */
export function keywords(text: string): Set<string> {
  const out = new Set<string>();
  const words = text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/);
  for (const w of words) {
    if (w.length < 3 || STOP_WORDS.has(w)) continue;
    const stem = w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w;
    if (stem.length >= 3 && !STOP_WORDS.has(stem)) out.add(stem);
  }
  return out;
}

export interface MemoryQuery {
  goal: string;
  /** Files the job is about (relative paths): the plan task's files, the files of the diff. */
  files?: readonly string[];
}

/** How many of the keywords of the job an entry shares. */
export function overlap(entry: MemoryEntry, query: ReadonlySet<string>): number {
  let n = 0;
  for (const k of keywords(entry.text)) if (query.has(k)) n += 1;
  return n;
}

/**
 * Orders entries for a job (requirement 3.2): the more keywords of the goal and the files an entry shares, the earlier it
 * comes; entries that share the same number keep their order, which is newest first when `entries` come from
 * `MemoryStore.list`. No embeddings: a few hundred short entries need nothing heavier.
 */
export function rankMemories(entries: readonly MemoryEntry[], query: MemoryQuery): MemoryEntry[] {
  const wanted = keywords([query.goal, ...(query.files ?? [])].join(" "));
  return entries
    .map((entry, i) => ({ entry, i, score: overlap(entry, wanted) }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((x) => x.entry);
}

/** One line per entry, as many as fit in `max` characters, in the given order. Never splits an entry. */
export function memoryLines(entries: readonly MemoryEntry[], max: number = MEMORY_PROMPT_MAX_CHARS): string {
  const lines: string[] = [];
  let used = 0;
  for (const e of entries) {
    const line = `- [${e.kind}] ${e.text}`;
    const cost = line.length + (lines.length ? 1 : 0);
    if (used + cost > max) break;
    lines.push(line);
    used += cost;
  }
  return lines.length ? lines.join("\n") : "(none)";
}

/** Paths named by the `diff --git` lines of a patch, without repeats. For ranking only; best effort. */
export function diffFiles(diff: string): string[] {
  const out = new Set<string>();
  for (const m of diff.matchAll(/^diff --git a\/.+ b\/(.+)$/gm)) out.add(m[1]!);
  return [...out].slice(0, 50);
}

/**
 * The value of `{{memory}}` in a role prompt (requirement 3.1): the project's memory, most relevant first, cut at
 * `MEMORY_PROMPT_MAX_CHARS`, inside a fence longer than any backtick run in it so it is data and cannot pose as the
 * instructions around it. A Library that cannot be read gives "(none)": a job never fails because of its memory.
 */
export function memoryBlock(store: MemoryStore | undefined, projectId: string, query: MemoryQuery, logger: Logger = noopLogger): string {
  if (!store) return fence("(none)");
  try {
    return fence(memoryLines(rankMemories(store.list(projectId), query)));
  } catch (e) {
    logger.warn("the memory could not be read", { projectId, error: e instanceof Error ? e.message : String(e) });
    return fence("(none)");
  }
}
