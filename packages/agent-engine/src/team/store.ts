import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { TeamsFileSchema, type TeamMember, type TeamsFile } from "@agentlife/shared";
import { noopLogger, type Logger } from "../log.ts";

export interface TeamStoreOptions {
  /** `data/teams.json`. */
  file: string;
  now?: () => number;
  logger?: Logger;
}

/**
 * The teams of the projects in `data/teams.json` (`{ [projectId]: Member[] }`). A project without an entry has the
 * default team. The file is rewritten after every change (temporary file, then rename); a file that cannot be read is
 * moved aside as `teams.json.bad-<time>` and the teams start empty, so the user's data is never overwritten silently.
 */
export class TeamStore {
  private readonly file: string;
  private readonly now: () => number;
  private readonly log: Logger;
  private teams: TeamsFile = {};

  constructor(opts: TeamStoreOptions) {
    this.file = opts.file;
    this.now = opts.now ?? Date.now;
    this.log = opts.logger ?? noopLogger;
    this.load();
  }

  private load(): void {
    if (!existsSync(this.file)) return;
    try {
      this.teams = TeamsFileSchema.parse(JSON.parse(readFileSync(this.file, "utf8")));
    } catch (e) {
      const aside = `${this.file}.bad-${this.now()}`;
      this.log.error("teams file unreadable, moved aside", { file: aside, error: e instanceof Error ? e.message : String(e) });
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
    writeFileSync(tmp, `${JSON.stringify(this.teams, null, 2)}\n`, "utf8");
    renameSync(tmp, this.file);
  }

  /** The stored members of a project, or undefined while the project has the default team. */
  get(projectId: string): readonly TeamMember[] | undefined {
    return Object.hasOwn(this.teams, projectId) ? this.teams[projectId] : undefined;
  }

  set(projectId: string, members: readonly TeamMember[]): void {
    this.teams = { ...this.teams, [projectId]: members.map((m) => ({ ...m })) };
    this.save();
  }

  delete(projectId: string): void {
    if (!Object.hasOwn(this.teams, projectId)) return;
    const { [projectId]: _gone, ...rest } = this.teams;
    this.teams = rest;
    this.save();
  }

  projectIds(): string[] {
    return Object.keys(this.teams);
  }
}
