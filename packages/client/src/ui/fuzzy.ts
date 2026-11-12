/**
 * Fuzzy matching for the command palette. Pure. A match is ranked by how well it fits, best first:
 * the whole text, a prefix of it, every query word at the start of a word, the query inside the text,
 * and last the query letters in order. Ties keep the order of the commands.
 */

const EXACT = 1000;
const PREFIX = 900;
const WORD_STARTS = 600;
const SUBSTRING = 400;
const SUBSEQUENCE = 100;

const words = (text: string): string[] => text.split(/[^a-z0-9]+/).filter((w) => w.length > 0);

/** Score of `text` for `query` (case-insensitive), or null when it does not match. Higher is better. */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.trim().toLowerCase().replace(/\s+/g, " ");
  const t = text.toLowerCase();
  if (q === "") return 0;
  if (t === q) return EXACT;
  if (t.startsWith(q)) return PREFIX - (t.length - q.length) * 0.5;

  const ws = words(t);
  const used = new Set<number>();
  let firstWord = Infinity;
  const tokens = q.split(" ");
  const atWordStarts = tokens.every((token) => {
    const at = ws.findIndex((w, i) => !used.has(i) && w.startsWith(token));
    if (at < 0) return false;
    used.add(at);
    firstWord = Math.min(firstWord, at);
    return true;
  });
  if (atWordStarts) return WORD_STARTS - firstWord * 10;

  const inside = t.indexOf(q);
  if (inside >= 0) return SUBSTRING - inside;

  // The letters of the query in order, ignoring the spaces of the query.
  const letters = q.replace(/ /g, "");
  let from = 0;
  let gaps = 0;
  for (const ch of letters) {
    const at = t.indexOf(ch, from);
    if (at < 0) return null;
    gaps += at - from;
    from = at + 1;
  }
  return SUBSEQUENCE - Math.min(gaps, SUBSEQUENCE - 1);
}

/** The items that match `query`, best first; with an empty query, all of them in their order. */
export function rankMatches<T>(items: readonly T[], query: string, textOf: (item: T) => string): T[] {
  const scored: { item: T; score: number; index: number }[] = [];
  items.forEach((item, index) => {
    const score = fuzzyScore(query, textOf(item));
    if (score !== null) scored.push({ item, score, index });
  });
  return scored.sort((a, b) => b.score - a.score || a.index - b.index).map((s) => s.item);
}

/** Moves the highlighted row by `delta`, wrapping at both ends. With no rows it stays at 0. */
export function moveSelection(selected: number, delta: number, count: number): number {
  if (count <= 0) return 0;
  return (((selected + delta) % count) + count) % count;
}
