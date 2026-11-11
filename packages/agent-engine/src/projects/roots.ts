import { existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { DEFAULT_CONFIG_DIR } from "../config.ts";
import { isInside } from "../paths.ts";

const HotelConfigSchema = z.object({ projectRoots: z.array(z.string().min(1)).max(10) });

export interface AllowedRootsOptions {
  /** Directory with `hotel.json`. Default: the engine's config directory. */
  configDir?: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * The directories where projects may live: `AGENTLIFE_PROJECT_ROOTS` (`;`-separated) when set, otherwise
 * `config/hotel.json`. Only absolute paths count, so a Windows root such as `D:\AgentHotel` is ignored on Linux
 * instead of being read as a relative folder.
 */
export function allowedRoots(opts: AllowedRootsOptions = {}): string[] {
  const env = opts.env ?? process.env;
  const fromEnv = env["AGENTLIFE_PROJECT_ROOTS"]?.trim();
  let roots: string[];
  if (fromEnv) {
    roots = fromEnv.split(";").map((s) => s.trim()).filter(Boolean);
  } else {
    const file = path.join(opts.configDir ?? DEFAULT_CONFIG_DIR, "hotel.json");
    if (!existsSync(file)) return [];
    let json: unknown;
    try {
      json = JSON.parse(readFileSync(file, "utf8"));
    } catch (e) {
      throw new Error(`config: hotel.json is not valid JSON: ${(e as Error).message}`);
    }
    const parsed = HotelConfigSchema.safeParse(json);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
      throw new Error(`config: hotel.json is invalid: ${issues}`);
    }
    roots = parsed.data.projectRoots;
  }
  return roots.filter((r) => path.isAbsolute(r)).map((r) => path.resolve(r));
}

/** Creates the allowed root folders that do not exist yet (empty folders only). A failure is not an error. */
export function ensureRoots(roots: readonly string[]): void {
  for (const r of roots) {
    try {
      mkdirSync(r, { recursive: true });
    } catch {
      // The drive may not exist on this machine; registration then fails with "outside the allowed folders".
    }
  }
}

/** Real paths of the roots that exist. A root that does not exist holds no project. */
export function realRoots(roots: readonly string[]): string[] {
  const out: string[] = [];
  for (const r of roots) {
    try {
      out.push(realpathSync.native(r));
    } catch {
      // not there
    }
  }
  return out;
}

/** True when two real paths are the same place (case-insensitive on Windows). */
export function samePath(a: string, b: string): boolean {
  return isInside(a, b) && isInside(b, a);
}

/**
 * True when `realPath` lies strictly inside one of the roots. Both sides must already be real paths (symlinks and
 * `..` resolved, see `realpathSync.native`); a root itself is not a project.
 */
export function isInsideRoot(realPath: string, roots: readonly string[]): boolean {
  return roots.some((root) => !samePath(root, realPath) && isInside(root, realPath));
}
