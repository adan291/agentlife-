import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { TIER_IDS, TierIdSchema, type TierId } from "@agentlife/shared";
import { RuleSchema } from "../agents.ts";

/** `packages/agent-engine/agents/tiers`: reviewed files in this repository, the only source of tools and permissions. */
export const TIERS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "agents", "tiers");

const TierFileSchema = z
  .object({
    id: TierIdSchema,
    description: z.string().min(1),
    tools: z.array(z.string().min(1)),
    permissions: z.object({ rules: z.array(RuleSchema) }),
  })
  .strict();
export type Tier = z.infer<typeof TierFileSchema>;

/** Reads and checks one tier file. Throws when it is missing, malformed or names another tier. */
export function loadTier(id: TierId, dir: string = TIERS_DIR): Tier {
  const file = path.join(dir, `${id}.json`);
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`tiers: cannot read ${file}: ${(e as Error).message}`);
  }
  const parsed = TierFileSchema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    throw new Error(`tiers: ${id}.json is invalid: ${issues}`);
  }
  if (parsed.data.id !== id) throw new Error(`tiers: ${id}.json has id "${parsed.data.id}"`);
  return parsed.data;
}

export function loadTiers(dir: string = TIERS_DIR): Record<TierId, Tier> {
  const out = {} as Record<TierId, Tier>;
  for (const id of TIER_IDS) out[id] = loadTier(id, dir);
  return out;
}
