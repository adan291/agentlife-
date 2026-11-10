// Text that leaves the engine or the build runner for the room (speech bubbles, activity lines)
// never contains absolute paths, secrets or environment values.

export const MAX_TEXT = 80;

/** Removes absolute paths and secret-looking tokens, collapses whitespace and caps the length. */
export function sanitize(text: string, max = MAX_TEXT): string {
  let out = text;
  for (let i = 0; i < 5; i++) {
    const before = out;
    out = out
      .replace(/[A-Za-z]:[\\/]\S*/g, "") // drive-letter paths
      .replace(/(^|\s)[\\/]{1,2}[^\s]*/g, "$1") // rooted or UNC paths
      .replace(/ksk_\w*/gi, "")
      .replace(/\$env:\S*/gi, "") // PowerShell env access, value included
      .replace(/\b[A-Za-z_][A-Za-z0-9_]*=\S*/g, ""); // NAME=value assignments
    if (out === before) break;
  }
  return out.replace(/\s+/g, " ").trim().slice(0, max).trim();
}
