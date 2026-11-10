/**
 * Session label at the start of a Builder speech line ("S9 agent-pipeline (auto)" -> "S9"), or null.
 * The review run reports itself as "R".
 */
export function sessionLabel(text: string): string | null {
  const m = /^(S\d+[A-Za-z]?|R)(?=\s|$)/.exec(text);
  return m?.[1] ?? null;
}

/** Name tag text of the Builder: the plain name when idle, name plus session label while building. */
export function builderTagName(base: string, label: string | null): string {
  return label ? `${base} ${label}` : base;
}
