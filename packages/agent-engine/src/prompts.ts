import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { JobKind } from "@agentlife/shared";
import type { Role } from "./runtimes/types.ts";

export const PROMPTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "prompts");

/** Templates of the job kinds other than `change`, next to the three role templates. */
export const KIND_PROMPT_NAMES = [
  "architect-tests",
  "architect-docs",
  "developer-tests",
  "developer-docs",
  "qa-tests",
  "qa-docs",
  "qa-branch",
] as const;
export type PromptName = (typeof KIND_PROMPT_NAMES)[number];

/** Templates of the hotel's own agents (not a pipeline role): the import review and the HR agent. */
export const SERVICE_PROMPT_NAMES = ["import-review", "hr-suggest"] as const;
export type ServicePromptName = (typeof SERVICE_PROMPT_NAMES)[number];

/** The template a role uses in a job of this kind. `change` (and an unknown kind) uses the role's own template. */
export function templateFor(role: Role, kind: JobKind = "change"): Role | PromptName {
  if (kind === "write-tests") return `${role}-tests` as PromptName;
  if (kind === "document") return `${role}-docs` as PromptName;
  return role;
}

export function loadPromptTemplate(role: Role | PromptName | ServicePromptName, dir: string = PROMPTS_DIR): string {
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
