import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { MODEL_ID_RE, TEAM_ROLES, TEMPLATE_MODEL_MAX, type TeamRole } from "@agentlife/shared";
import { DEFAULT_CONFIG_DIR } from "../config.ts";
import { ConflictError } from "../errors.ts";
import { buildMinimalEnv } from "../runtimes/kiro-cli.ts";

const ModelListSchema = z.array(z.string().regex(MODEL_ID_RE).max(TEMPLATE_MODEL_MAX)).min(1);
const roleModels = ModelListSchema;

export const TeamRulesSchema = z
  .object({
    $comment: z.string().optional(),
    allowedModels: z.object({
      architect: roleModels,
      developer: roleModels,
      qa: roleModels,
      reviewer: roleModels,
      researcher: roleModels,
    }),
  })
  .strict();
export type TeamRules = z.infer<typeof TeamRulesSchema>;

export function loadTeamRules(dir: string = DEFAULT_CONFIG_DIR): TeamRules {
  const file = path.join(dir, "team-rules.json");
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`config: cannot read ${file}: ${(e as Error).message}`);
  }
  const parsed = TeamRulesSchema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    throw new Error(`config: team-rules.json is invalid: ${issues}`);
  }
  return parsed.data;
}

/** Ids from `kiro-cli chat --list-models --format json` (`{ models: [{ model_id }] }`, possibly after some text). */
export function parseModelList(output: string): string[] {
  const start = output.indexOf("{");
  if (start < 0) throw new Error("no JSON in the model list");
  const data = z.object({ models: z.array(z.object({ model_id: z.string() })) }).parse(JSON.parse(output.slice(start)));
  return data.models.map((m) => m.model_id).filter((id) => MODEL_ID_RE.test(id));
}

export type ModelLister = () => Promise<string[]>;

/** Asks kiro-cli, with the environment the role agents run in, which models the account has. */
export function kiroCliModelLister(kiroHome: string, bin = "kiro-cli"): ModelLister {
  return () =>
    new Promise((resolve, reject) => {
      execFile(
        bin,
        ["chat", "--list-models", "--format", "json"],
        { env: buildMinimalEnv(kiroHome), windowsHide: true, timeout: 30_000, encoding: "utf8", maxBuffer: 1024 * 1024 },
        (error, stdout) => {
          if (error) return reject(new Error("kiro-cli could not list the models"));
          try {
            resolve(parseModelList(stdout));
          } catch {
            reject(new Error("the model list of kiro-cli could not be read"));
          }
        },
      );
    });
}

export interface ModelDirectoryOptions {
  rules: TeamRules;
  /** How the account's models are read. Default: none, so every model of the role's list counts as available. */
  list?: ModelLister;
  /** Under RUNTIME=fake the only model is "fake". */
  fake?: boolean;
  /** How long a model list is reused. Default 5 minutes. */
  ttlMs?: number;
  now?: () => number;
}

/** The models a member of each role may use: the role's allowed list narrowed by the account's models. */
export class ModelDirectory {
  private readonly rules: TeamRules;
  private readonly lister: ModelLister | undefined;
  private readonly isFake: boolean;
  private readonly ttl: number;
  private readonly now: () => number;
  private cache: { at: number; ids: string[] } | undefined;

  constructor(opts: ModelDirectoryOptions) {
    this.rules = opts.rules;
    this.lister = opts.list;
    this.isFake = opts.fake === true;
    this.ttl = opts.ttlMs ?? 5 * 60_000;
    this.now = opts.now ?? Date.now;
  }

  get fake(): boolean {
    return this.isFake;
  }

  /** Models of the account, or undefined when no lister is set. Throws `models_unavailable` when kiro-cli cannot say. */
  private async account(): Promise<string[] | undefined> {
    if (!this.lister) return undefined;
    if (this.cache && this.now() - this.cache.at < this.ttl) return this.cache.ids;
    try {
      const ids = await this.lister();
      this.cache = { at: this.now(), ids };
      return ids;
    } catch (e) {
      throw new ConflictError("models_unavailable", `The list of models is not available: ${e instanceof Error ? e.message : "unknown error"}`);
    }
  }

  async allowedFor(role: TeamRole): Promise<string[]> {
    if (this.isFake) return ["fake"];
    const account = await this.account();
    const allowed = this.rules.allowedModels[role];
    return account ? allowed.filter((m) => account.includes(m)) : [...allowed];
  }

  async all(): Promise<Partial<Record<TeamRole, string[]>>> {
    const out: Partial<Record<TeamRole, string[]>> = {};
    for (const role of TEAM_ROLES) out[role] = await this.allowedFor(role);
    return out;
  }

  /** The model a hire gets when none is chosen: the template's own, or "fake". */
  preferred(templateModel: string): string {
    return this.isFake ? "fake" : templateModel;
  }
}
