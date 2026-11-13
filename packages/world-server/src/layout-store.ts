import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LayoutsFileSchema } from "@agentlife/shared";
import type { Layout, LayoutsFile } from "@agentlife/shared";

const here = dirname(fileURLToPath(import.meta.url));

/** `data/layouts.json` at the repository root, or `AGENTLIFE_LAYOUTS_FILE`. */
export function defaultLayoutsFile(env: NodeJS.ProcessEnv = process.env): string {
  return env["AGENTLIFE_LAYOUTS_FILE"] ?? join(here, "..", "..", "..", "data", "layouts.json");
}

export interface LayoutStoreOptions {
  file: string;
  now?: () => number;
  onLog?: (message: string) => void;
}

/**
 * How the user arranged each project floor (`{ [projectId]: { [itemId]: { x, y, dir } } }`), only the pieces that are not
 * where the template has them. Rewritten after every change through a temporary file and a rename. A file that cannot
 * be read is moved aside as `layouts.json.bad-<time>` and the store starts empty, so a user's arrangement is never
 * overwritten by accident (the same rule as the engine's team store).
 */
export class LayoutStore {
  private readonly file: string;
  private readonly now: () => number;
  private readonly log: (message: string) => void;
  private layouts: LayoutsFile = {};

  constructor(opts: LayoutStoreOptions) {
    this.file = opts.file;
    this.now = opts.now ?? Date.now;
    this.log = opts.onLog ?? (() => undefined);
    this.load();
  }

  private load(): void {
    if (!existsSync(this.file)) return;
    try {
      this.layouts = LayoutsFileSchema.parse(JSON.parse(readFileSync(this.file, "utf8")));
    } catch (e) {
      const aside = `${this.file}.bad-${this.now()}`;
      this.log(`layouts file unreadable, moved aside to ${aside}: ${e instanceof Error ? e.message : String(e)}`);
      try {
        renameSync(this.file, aside);
      } catch {
        // Nothing better can be done here; the next save would replace it.
      }
    }
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(this.layouts, null, 2)}\n`, "utf8");
    renameSync(tmp, this.file);
  }

  /** The saved layout of a project, or undefined while its floor is as the template made it. */
  get(projectId: string): Layout | undefined {
    return Object.hasOwn(this.layouts, projectId) ? this.layouts[projectId] : undefined;
  }

  /** Saves the layout of a project. An empty layout removes the entry. Throws when the file cannot be written (the old state stays). */
  set(projectId: string, layout: Layout): void {
    const before = this.layouts;
    if (Object.keys(layout).length === 0) {
      if (!Object.hasOwn(this.layouts, projectId)) return;
      const { [projectId]: _gone, ...rest } = this.layouts;
      this.layouts = rest;
    } else {
      this.layouts = { ...this.layouts, [projectId]: { ...layout } };
    }
    try {
      this.save();
    } catch (e) {
      this.layouts = before;
      throw e;
    }
  }
}
