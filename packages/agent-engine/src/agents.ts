import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { Role } from "./runtimes/types.ts";

export const AGENTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "agents");
export const ROLES: readonly Role[] = ["architect", "developer", "qa"];
export const AGENT_PREFIX = "agentlife-";

export function agentName(role: Role): string {
  return `${AGENT_PREFIX}${role}`;
}

export const RuleSchema = z.object({
  capability: z.string().min(1),
  match: z.array(z.string().min(1)).min(1),
  exclude: z.array(z.string().min(1)).optional(),
  effect: z.enum(["allow", "deny"]),
});

export const AgentFileSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  prompt: z.string().min(1),
  model: z.string().min(1).optional(),
  tools: z.array(z.string().min(1)),
  permissions: z.object({ rules: z.array(RuleSchema) }),
});
export type AgentFile = z.infer<typeof AgentFileSchema>;

/** Reads and checks `agentlife-<role>.json` from `dir`. */
export function loadAgentFile(role: Role, dir: string = AGENTS_DIR): AgentFile {
  const file = path.join(dir, `${agentName(role)}.json`);
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`agents: cannot read ${file}: ${(e as Error).message}`);
  }
  const parsed = AgentFileSchema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    throw new Error(`agents: ${agentName(role)}.json is invalid: ${issues}`);
  }
  if (parsed.data.name !== agentName(role)) {
    throw new Error(`agents: ${agentName(role)}.json has name "${parsed.data.name}"`);
  }
  return parsed.data;
}

export interface InstallAgentsOptions {
  /** KIRO_HOME of the product agents. Agents go to `<kiroHome>/agents`. */
  kiroHome: string;
  srcDir?: string;
}

export interface InstallAgentsResult {
  dir: string;
  installed: string[];
}

/**
 * Copies the three role agents into `<kiroHome>/agents`, replacing older copies and removing stale
 * `agentlife-*.json` files. Other files in that directory are left alone.
 */
export function installAgents(opts: InstallAgentsOptions): InstallAgentsResult {
  const srcDir = opts.srcDir ?? AGENTS_DIR;
  const files = ROLES.map((role) => {
    loadAgentFile(role, srcDir); // throws when a role agent is missing or malformed
    return `${agentName(role)}.json`;
  });
  const dir = path.join(opts.kiroHome, "agents");
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(dir)) {
    if (f.startsWith(AGENT_PREFIX) && f.endsWith(".json") && !files.includes(f)) rmSync(path.join(dir, f), { force: true });
  }
  for (const f of files) copyFileSync(path.join(srcDir, f), path.join(dir, f));
  return { dir, installed: files };
}
