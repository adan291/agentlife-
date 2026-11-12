import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PipelinesFileSchema, type PipelineStep, type PipelinesFile } from "@agentlife/shared";
import { noopLogger, type Logger } from "../log.ts";

export interface PipelineStoreOptions {
  /** `data/pipelines.json`. */
  file: string;
  now?: () => number;
  logger?: Logger;
}

/**
 * The pipelines of the projects in `data/pipelines.json` (`{ [projectId]: Step[] }`). A project without an entry runs the
 * default pipeline. Written like the teams file: temporary file, then rename; a file that cannot be read is moved aside
 * and the store starts empty.
 */
export class PipelineStore {
  private readonly file: string;
  private readonly now: () => number;
  private readonly log: Logger;
  private pipelines: PipelinesFile = {};

  constructor(opts: PipelineStoreOptions) {
    this.file = opts.file;
    this.now = opts.now ?? Date.now;
    this.log = opts.logger ?? noopLogger;
    this.load();
  }

  private load(): void {
    if (!existsSync(this.file)) return;
    try {
      this.pipelines = PipelinesFileSchema.parse(JSON.parse(readFileSync(this.file, "utf8")));
    } catch (e) {
      const aside = `${this.file}.bad-${this.now()}`;
      this.log.error("pipelines file unreadable, moved aside", { file: aside, error: e instanceof Error ? e.message : String(e) });
      try {
        renameSync(this.file, aside);
      } catch {
        // If even that fails the next save overwrites it; nothing better can be done here.
      }
    }
  }

  private save(): void {
    mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(this.pipelines, null, 2)}\n`, "utf8");
    renameSync(tmp, this.file);
  }

  /** The saved steps of a project, or undefined while it runs the default pipeline. */
  get(projectId: string): readonly PipelineStep[] | undefined {
    return Object.hasOwn(this.pipelines, projectId) ? this.pipelines[projectId] : undefined;
  }

  set(projectId: string, steps: readonly PipelineStep[]): void {
    this.pipelines = { ...this.pipelines, [projectId]: steps.map((s) => ({ ...s })) };
    this.save();
  }

  delete(projectId: string): void {
    if (!Object.hasOwn(this.pipelines, projectId)) return;
    const { [projectId]: _gone, ...rest } = this.pipelines;
    this.pipelines = rest;
    this.save();
  }
}
