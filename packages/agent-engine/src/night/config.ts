import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { DEFAULT_NIGHT_CONFIG, NightConfigSchema, type NightConfig } from "@agentlife/shared";
import { DEFAULT_CONFIG_DIR } from "../config.ts";

/**
 * The night window and limits from `config/night.json`. A missing file gives the defaults (01:00 to 07:00, 4 jobs, 20
 * minutes); a file that exists but is wrong is an error, so a typo never silently moves the window.
 */
export function loadNightConfig(dir: string = DEFAULT_CONFIG_DIR): NightConfig {
  const file = path.join(dir, "night.json");
  if (!existsSync(file)) return { ...DEFAULT_NIGHT_CONFIG };
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`config: night.json is not valid JSON: ${(e as Error).message}`);
  }
  const parsed = NightConfigSchema.safeParse({ ...DEFAULT_NIGHT_CONFIG, ...(typeof json === "object" && json !== null ? json : {}) });
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    throw new Error(`config: night.json is invalid: ${issues}`);
  }
  return parsed.data;
}
