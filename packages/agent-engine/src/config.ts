import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const AgentRuntimeCfg = z.object({
  runtime: z.enum(["fake", "kiro-cli"]),
  agent: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
});

export const AgentsConfigSchema = z.object({
  architect: AgentRuntimeCfg,
  developer: AgentRuntimeCfg,
  qa: AgentRuntimeCfg,
  ambient: z.object({ runtime: z.enum(["llm", "none"]) }),
});
export type AgentsConfig = z.infer<typeof AgentsConfigSchema>;

export const RepoConfigSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string().min(1),
  /** Path relative to the project root; must stay inside it. */
  source: z.string().min(1),
  testCommand: z.string().min(1),
});
export const ReposConfigSchema = z
  .array(RepoConfigSchema)
  .refine((rs) => new Set(rs.map((r) => r.id)).size === rs.length, "duplicate repo id");
export type RepoConfig = z.infer<typeof RepoConfigSchema>;

const posMs = z.number().int().positive();
/** Jobs that run at the same time in the whole hotel when `limits.json` does not say. */
export const DEFAULT_MAX_CONCURRENT_JOBS = 2;
export const LimitsConfigSchema = z.object({
  timeoutsMs: z.object({ analyze: posMs, develop: posMs, test: posMs, review: posMs }),
  maxDiffLines: z.number().int().positive(),
  maxFilesChanged: z.number().int().positive(),
  /** At most this many jobs run at once, across all projects; the others wait in a queue. Default 2. */
  maxConcurrentJobs: z.number().int().min(1).max(8).optional(),
});
export type LimitsConfig = z.infer<typeof LimitsConfigSchema>;

export interface EngineConfig {
  agents: AgentsConfig;
  repos: RepoConfig[];
  limits: LimitsConfig;
}

export const DEFAULT_CONFIG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "config");

function loadFile<T>(dir: string, file: string, schema: z.ZodType<T>): T {
  const full = path.join(dir, file);
  let raw: string;
  try {
    raw = readFileSync(full, "utf8");
  } catch (e) {
    throw new Error(`config: cannot read ${full}: ${(e as Error).message}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    throw new Error(`config: ${file} is not valid JSON: ${(e as Error).message}`);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    throw new Error(`config: ${file} is invalid: ${issues}`);
  }
  return parsed.data;
}

function assertInsideProject(repo: RepoConfig): void {
  if (path.isAbsolute(repo.source)) {
    throw new Error(`config: repos.json: source of "${repo.id}" must be relative to the project`);
  }
  const norm = path.normalize(repo.source);
  if (norm === ".." || norm.startsWith(".." + path.sep)) {
    throw new Error(`config: repos.json: source of "${repo.id}" escapes the project`);
  }
}

export function loadConfig(dir: string = DEFAULT_CONFIG_DIR): EngineConfig {
  const agents = loadFile(dir, "agents.json", AgentsConfigSchema);
  const repos = loadFile(dir, "repos.json", ReposConfigSchema);
  const limits = loadFile(dir, "limits.json", LimitsConfigSchema);
  repos.forEach(assertInsideProject);
  return { agents, repos, limits };
}
