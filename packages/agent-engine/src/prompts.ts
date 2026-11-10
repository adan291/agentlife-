import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Role } from "./runtimes/types.ts";

export const PROMPTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "prompts");

export function loadPromptTemplate(role: Role, dir: string = PROMPTS_DIR): string {
  return readFileSync(path.join(dir, `${role}.md`), "utf8");
}

/** Names used as `{{name}}` in a template. */
export function placeholders(template: string): string[] {
  return [...new Set([...template.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]!))];
}

/**
 * Fills `{{name}}` placeholders in one pass, so a value that itself contains `{{x}}` is never expanded.
 * A placeholder without a value is an error.
 */
export function renderPrompt(template: string, vars: Readonly<Record<string, string>>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => {
    const v = vars[name];
    if (v === undefined) throw new Error(`prompt: no value for {{${name}}}`);
    return v;
  });
}

/**
 * Wraps untrusted text in a fenced block whose fence is longer than any backtick run inside it,
 * so the text cannot close the block and pose as the instructions that follow.
 */
export function fence(text: string, lang = "text"): string {
  let longest = 0;
  for (const m of text.matchAll(/`+/g)) longest = Math.max(longest, m[0].length);
  const ticks = "`".repeat(Math.max(3, longest + 1));
  return `${ticks}${lang}\n${text}\n${ticks}`;
}
