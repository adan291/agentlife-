import { randomBytes } from "node:crypto";
import { readdirSync, rmSync } from "node:fs";
import path from "node:path";
import {
  TEAM_MAX_MEMBERS,
  tierForRole,
  type HireBody,
  type TeamMember,
  type TeamResponse,
  type TeamRole,
  type TierId,
  type UpdateMemberBody,
} from "@agentlife/shared";
import { agentName } from "../agents.ts";
import { ConflictError, NotFoundError } from "../errors.ts";
import { BadRequestError } from "../http/server.ts";
import { noopLogger, type Logger } from "../log.ts";
import type { Catalogue } from "./catalogue.ts";
import { AGENT_NAME_RE, agentFileFor, writeAgentFile, type AgentValidator } from "./generate.ts";
import type { ModelDirectory } from "./models.ts";
import type { TeamStore } from "./store.ts";
import type { Tier } from "./tiers.ts";

/** Roles every team keeps while it can run jobs. */
export const REQUIRED_ROLES: readonly TeamRole[] = ["architect", "developer"];

/** The member a step runs with: which kiro-cli agent, which model, and the name shown to the user. */
export interface ResolvedMember {
  memberId: string;
  /** Name of the kiro-cli agent (`--agent`). */
  agent: string;
  /** Model for `--model`; absent when the configuration leaves it to the agent file. */
  model?: string;
  displayName: string;
}

/** What the pipeline steps ask for. A role the team does not have gives undefined and the step uses the built-in agent. */
export interface TeamResolver {
  resolve(projectId: string, taskId: string, role: TeamRole): ResolvedMember | undefined;
}

/** One role of one open job that is being worked on right now. */
export interface BusyRole {
  taskId: string;
  role: TeamRole;
}

export interface TeamServiceOptions {
  store: TeamStore;
  catalogue: Catalogue;
  models: ModelDirectory;
  tiers: Record<TierId, Tier>;
  hasProject: (projectId: string) => boolean;
  /** Model of each pipeline role in the default team (config/agents.json). */
  defaultModels?: Partial<Record<TeamRole, string>>;
  /** Where the agent files of customised teams go. Without it no file is written (the fake runtime needs none). */
  agents?: { kiroHome: string; validate?: AgentValidator };
  /** Roles of open jobs on the project that are being worked on now; firing their member is refused. */
  busy?: (projectId: string) => readonly BusyRole[];
  /** One line for the activity terminal. */
  activity?: (projectId: string, role: TeamRole, text: string) => void;
  newId?: () => string;
  logger?: Logger;
}

/** Teams kept per job so a running job keeps its agents when the team changes (changes apply to the next job). */
const MAX_SNAPSHOTS = 200;

export interface TeamView {
  customised: boolean;
  members: TeamMember[];
}

/**
 * Hire, rename, change model and fire (hr-desk, requirement 2). A project without stored members has the default team
 * (one built-in member per pipeline role, running the `agentlife-<role>` agents). The first change stores the team, and
 * from then on every member runs on an agent file generated from its template and its tier.
 */
export class TeamService implements TeamResolver {
  private readonly o: TeamServiceOptions;
  private readonly log: Logger;
  private readonly newId: () => string;
  private readonly snapshots = new Map<string, Map<TeamRole, ResolvedMember>>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(opts: TeamServiceOptions) {
    this.o = opts;
    this.log = opts.logger ?? noopLogger;
    this.newId = opts.newId ?? (() => randomBytes(3).toString("hex"));
  }

  /** Changes of one team never overlap: they read, wait for files and models, then write. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private defaultTeam(): TeamMember[] {
    return (["architect", "developer", "qa"] as const).map((role) => {
      const t = this.o.catalogue.defaultFor(role);
      return { id: role, displayName: t.name, templateId: t.id, role, model: this.o.defaultModels?.[role] ?? this.o.models.preferred(t.defaultModel) };
    });
  }

  private requireProject(projectId: string): void {
    if (!this.o.hasProject(projectId)) throw new NotFoundError("unknown project");
  }

  team(projectId: string): TeamView {
    this.requireProject(projectId);
    const stored = this.o.store.get(projectId);
    return stored ? { customised: true, members: stored.map((m) => ({ ...m })) } : { customised: false, members: this.defaultTeam() };
  }

  view(projectId: string): TeamResponse {
    const t = this.team(projectId);
    return { projectId, customised: t.customised, members: t.members };
  }

  /** Name of the kiro-cli agent of a member. The default team uses the built-in role agents. */
  private agentOf(projectId: string, member: TeamMember, customised: boolean): string {
    return customised ? `${projectId}-${member.id}` : agentName(member.role as "architect" | "developer" | "qa");
  }

  /** The member that does the work of `role` in `projectId`: the first one of that role. */
  private currentTeam(projectId: string): Map<TeamRole, ResolvedMember> {
    const stored = this.o.store.get(projectId);
    const members = stored ?? this.defaultTeam();
    const out = new Map<TeamRole, ResolvedMember>();
    for (const m of members) {
      if (out.has(m.role)) continue;
      out.set(m.role, {
        memberId: m.id,
        agent: this.agentOf(projectId, m, stored !== undefined),
        ...(m.model ? { model: m.model } : {}),
        displayName: m.displayName,
      });
    }
    return out;
  }

  /**
   * The agent for a step. The whole team is read when a job asks for the first time and the answer is kept for that
   * job, so a rename, a new model or a firing applies from the next job on.
   */
  resolve(projectId: string, taskId: string, role: TeamRole): ResolvedMember | undefined {
    let snap = this.snapshots.get(taskId);
    if (!snap) {
      snap = this.currentTeam(projectId);
      this.snapshots.set(taskId, snap);
      if (this.snapshots.size > MAX_SNAPSHOTS) {
        const oldest = this.snapshots.keys().next().value;
        if (oldest !== undefined) this.snapshots.delete(oldest);
      }
    }
    return snap.get(role);
  }

  private workingMemberIds(projectId: string): Set<string> {
    const ids = new Set<string>();
    for (const b of this.o.busy?.(projectId) ?? []) {
      const m = this.resolve(projectId, b.taskId, b.role);
      if (m) ids.add(m.memberId);
    }
    return ids;
  }

  private async fileFor(projectId: string, member: TeamMember): Promise<void> {
    const agents = this.o.agents;
    if (!agents) return;
    const template = this.o.catalogue.get(member.templateId);
    if (!template) throw new NotFoundError("unknown template");
    const spec = { agentName: `${projectId}-${member.id}`, model: member.model };
    const file = agentFileFor(spec, template, this.o.tiers[tierForRole(member.role)]);
    await writeAgentFile(file, { kiroHome: agents.kiroHome, ...(agents.validate ? { validate: agents.validate } : {}) });
  }

  /** Writes the agent files of the whole team, then stores it. A file that is refused stops the change. */
  private async commit(projectId: string, members: TeamMember[]): Promise<void> {
    for (const m of members) {
      const name = `${projectId}-${m.id}`;
      if (!AGENT_NAME_RE.test(name) || name.startsWith("agentlife-")) {
        throw new ConflictError("project_id_reserved", "This project's id cannot be used for a custom team.");
      }
    }
    for (const m of members) {
      try {
        await this.fileFor(projectId, m);
      } catch (e) {
        if (e instanceof NotFoundError || e instanceof ConflictError) throw e;
        this.log.warn("agent file refused", { projectId, member: m.id, error: e instanceof Error ? e.message : String(e) });
        throw new ConflictError("agent_file_refused", `The agent file for ${m.displayName} was refused: ${e instanceof Error ? e.message : "unknown error"}`);
      }
    }
    this.o.store.set(projectId, members);
  }

  private async checkModel(role: TeamRole, model: string): Promise<void> {
    const allowed = await this.o.models.allowedFor(role);
    if (!allowed.includes(model)) {
      throw new BadRequestError("model_not_allowed", `${model} is not available for this role. Choose one of: ${allowed.join(", ") || "(none)"}.`, [
        { path: "model", message: "not allowed for this role" },
      ]);
    }
  }

  private checkName(members: readonly TeamMember[], displayName: string, exceptId?: string): void {
    const lower = displayName.toLowerCase();
    if (members.some((m) => m.id !== exceptId && m.displayName.toLowerCase() === lower)) {
      throw new ConflictError("name_taken", `Someone on this team is already called ${displayName}.`);
    }
  }

  hire(projectId: string, body: HireBody): Promise<TeamMember> {
    return this.serial(async () => {
      const { members } = this.team(projectId);
      const template = this.o.catalogue.get(body.templateId);
      if (!template) throw new NotFoundError("unknown template");
      if (members.length >= TEAM_MAX_MEMBERS) {
        throw new ConflictError("team_full", `A team holds at most ${TEAM_MAX_MEMBERS} members. Fire someone first.`);
      }
      this.checkName(members, body.displayName);
      const model = body.model ?? this.o.models.preferred(template.defaultModel);
      await this.checkModel(template.role, model);
      let id = `${template.role}-${this.newId()}`;
      while (members.some((m) => m.id === id)) id = `${template.role}-${this.newId()}`;
      const member: TeamMember = { id, displayName: body.displayName, templateId: template.id, role: template.role, model };
      await this.commit(projectId, [...members, member]);
      this.say(projectId, member.role, `Hired ${member.displayName} (${template.name})`);
      return member;
    });
  }

  update(projectId: string, memberId: string, body: UpdateMemberBody): Promise<TeamMember> {
    return this.serial(async () => {
      const { members } = this.team(projectId);
      const old = members.find((m) => m.id === memberId);
      if (!old) throw new NotFoundError("unknown team member");
      if (body.displayName !== undefined) this.checkName(members, body.displayName, memberId);
      if (body.model !== undefined) await this.checkModel(old.role, body.model);
      const next: TeamMember = { ...old, ...(body.displayName !== undefined ? { displayName: body.displayName } : {}), ...(body.model !== undefined ? { model: body.model } : {}) };
      await this.commit(projectId, members.map((m) => (m.id === memberId ? next : m)));
      if (next.displayName !== old.displayName) this.say(projectId, next.role, `Renamed ${old.displayName} to ${next.displayName}`);
      if (next.model !== old.model) this.say(projectId, next.role, `${next.displayName} now uses ${next.model}`);
      return next;
    });
  }

  fire(projectId: string, memberId: string): Promise<void> {
    return this.serial(async () => {
      const { members } = this.team(projectId);
      const member = members.find((m) => m.id === memberId);
      if (!member) throw new NotFoundError("unknown team member");
      if (REQUIRED_ROLES.includes(member.role) && !members.some((m) => m.id !== memberId && m.role === member.role)) {
        throw new ConflictError("last_of_role", `${member.displayName} is the only ${member.role} on this team. Hire another ${member.role} first.`);
      }
      if (this.workingMemberIds(projectId).has(memberId)) {
        throw new ConflictError("agent_working", `${member.displayName} is working on a job right now. Fire them when the step is over.`);
      }
      await this.commit(projectId, members.filter((m) => m.id !== memberId));
      this.say(projectId, member.role, `${member.displayName} left the team`);
    });
  }

  /** The project is gone: its team goes with it (agent files are swept at the next start). */
  remove(projectId: string): void {
    this.o.store.delete(projectId);
  }

  private say(projectId: string, role: TeamRole, text: string): void {
    try {
      this.o.activity?.(projectId, role, text);
    } catch (e) {
      this.log.warn("team activity line failed", { projectId, error: e instanceof Error ? e.message : String(e) });
    }
  }

  /**
   * Writes the agent files of every stored team (a file that is already right is left alone; nothing is validated again,
   * the files were checked when they were made) and removes the files of members that no longer exist.
   */
  async syncAgents(): Promise<{ written: number; removed: number }> {
    const agents = this.o.agents;
    if (!agents) return { written: 0, removed: 0 };
    let written = 0;
    const expected = new Set<string>();
    for (const projectId of this.o.store.projectIds()) {
      for (const m of this.o.store.get(projectId) ?? []) {
        const template = this.o.catalogue.get(m.templateId);
        if (!template) {
          this.log.warn("team member uses an unknown template", { projectId, member: m.id, template: m.templateId });
          continue;
        }
        const name = `${projectId}-${m.id}`;
        expected.add(name);
        try {
          const file = agentFileFor({ agentName: name, model: m.model }, template, this.o.tiers[tierForRole(m.role)]);
          if ((await writeAgentFile(file, { kiroHome: agents.kiroHome })).changed) written += 1;
        } catch (e) {
          this.log.warn("agent file could not be written", { projectId, member: m.id, error: e instanceof Error ? e.message : String(e) });
        }
      }
    }
    let removed = 0;
    const dir = path.join(agents.kiroHome, "agents");
    let names: string[] = [];
    try {
      names = readdirSync(dir);
    } catch {
      // No agents directory yet: nothing to sweep.
    }
    const projects = this.o.store.projectIds();
    for (const f of names) {
      if (!f.endsWith(".json")) continue;
      const base = f.slice(0, -".json".length);
      if (expected.has(base)) continue;
      const stale = projects.some((p) => new RegExp(`^${p}-(architect|developer|qa|reviewer|researcher)(-[0-9a-f]+)?$`).test(base));
      if (stale) {
        rmSync(path.join(dir, f), { force: true });
        removed += 1;
      }
    }
    return { written, removed };
  }
}
