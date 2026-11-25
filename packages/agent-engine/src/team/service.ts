import { randomBytes } from "node:crypto";
import { readdirSync, rmSync } from "node:fs";
import path from "node:path";
import {
  KIRO_PROVIDER,
  TEAM_MAX_MEMBERS,
  tierForRole,
  type HireBody,
  type TeamMember,
  type TeamResponse,
  type TeamRole,
  type TierId,
  type UpdateMemberBody,
} from "@agentlife/shared";
import { agentName, type AgentFile } from "../agents.ts";
import { BadRequestError, ConflictError, NotFoundError } from "../errors.ts";
import { noopLogger, type Logger } from "../log.ts";
import type { Catalogue } from "./catalogue.ts";
import { AGENT_NAME_RE, AgentFileRefusedError, agentFileFor, ROLE_INSTRUCTIONS, writeAgentFile, writeAgentFiles, type AgentValidator } from "./generate.ts";
import { INTERN_FALLBACK_MODEL } from "./intern.ts";
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
  /** Model for `--model`; absent when the configuration leaves it to the agent file. For a local member: the Ollama tag. */
  model?: string;
  displayName: string;
  /**
   * `ollama` for the Night intern: the work goes to the local model, with `system` as its persona, and `agent` is only
   * the read-only agent the fallback model runs as. Absent for everyone else.
   */
  runtime?: "ollama";
  system?: string;
  /** The AI provider of the member (multi-runtime): `kiro` or another provider's id. */
  provider?: string;
}

/** What the pipeline steps ask for. A role the team does not have gives undefined and the step uses the built-in agent. */
export interface TeamResolver {
  resolve(projectId: string, taskId: string, role: TeamRole): ResolvedMember | undefined;
  /**
   * A named member of the job's team (a pipeline step may name its member). Undefined when that member is not on the team
   * any more. Optional so that a resolver written for roles only keeps working.
   */
  resolveMember?(projectId: string, taskId: string, memberId: string): ResolvedMember | undefined;
}

/**
 * The agent for a step: the member the pipeline names, else the first member of the role. A named member that has left
 * the team stops the step with a clear message instead of running someone else.
 */
export function memberForStep(
  team: TeamResolver | undefined,
  ctx: { repoId: string; taskId: string; memberId?: string | undefined },
  role: TeamRole,
): ResolvedMember | undefined {
  if (!ctx.memberId || !team?.resolveMember) return team?.resolve(ctx.repoId, ctx.taskId, role);
  const member = team.resolveMember(ctx.repoId, ctx.taskId, ctx.memberId);
  if (!member) throw new Error(`The team member '${ctx.memberId}' is not on this team any more.`);
  return member;
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
  /** Provider of each pipeline role in the default team when it is not Kiro (config/agents.json). */
  defaultProviders?: Partial<Record<TeamRole, string>>;
  /** The AI providers, to check a member's provider (multi-runtime). */
  providers?: { get(id: string): unknown };
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

/** The team as one job sees it: the first member of each role, and every member by id. */
interface Snapshot {
  byRole: Map<TeamRole, ResolvedMember>;
  byId: Map<string, ResolvedMember>;
}

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
  private readonly snapshots = new Map<string, Snapshot>();
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
      const provider = this.o.defaultProviders?.[role];
      return {
        id: role,
        displayName: t.name,
        templateId: t.id,
        role,
        model: this.o.defaultModels?.[role] ?? this.o.models.preferred(t.defaultModel),
        ...(provider ? { provider } : {}),
      };
    });
  }
  /** A member's provider must exist; a model on another provider than Kiro is only checked for its shape. */
  private checkProvider(provider: string | undefined): void {
    if (provider === undefined || provider === KIRO_PROVIDER) return;
    if (!this.o.providers?.get(provider)) {
      throw new BadRequestError("unknown_provider", `There is no provider '${provider}' in config/providers.json.`, [{ path: "provider", message: "unknown provider" }]);
    }
  }
  private onKiro(provider: string | undefined): boolean {
    return provider === undefined || provider === KIRO_PROVIDER;
  }
  private providerLabel(id: string): string {
    const p = this.o.providers?.get(id) as { label?: string } | undefined;
    return p?.label ?? id;
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
  private currentTeam(projectId: string): Snapshot {
    const stored = this.o.store.get(projectId);
    const members = stored ?? this.defaultTeam();
    const byRole = new Map<TeamRole, ResolvedMember>();
    const byId = new Map<string, ResolvedMember>();
    for (const m of members) {
      const template = this.o.catalogue.get(m.templateId);
      const local = template?.runtime === "ollama";
      const resolved: ResolvedMember = {
        memberId: m.id,
        agent: this.agentOf(projectId, m, stored !== undefined),
        ...(m.model ? { model: m.model } : {}),
        displayName: m.displayName,
        // Every member names its provider, so a member on Kiro stays on Kiro when the role's default is another AI.
        provider: m.provider ?? KIRO_PROVIDER,
        ...(local && template ? { runtime: "ollama" as const, system: `${template.persona} ${ROLE_INSTRUCTIONS[template.role]}` } : {}),
        // A member on another provider gets the persona as its system text (kiro-cli reads it from the agent file).
        ...(!local && template && !this.onKiro(m.provider) ? { system: template.persona } : {}),
      };
      byId.set(m.id, resolved);
      if (!byRole.has(m.role)) byRole.set(m.role, resolved);
    }
    return { byRole, byId };
  }

  private snapshotOf(projectId: string, taskId: string): Snapshot {
    let snap = this.snapshots.get(taskId);
    if (!snap) {
      snap = this.currentTeam(projectId);
      this.snapshots.set(taskId, snap);
      if (this.snapshots.size > MAX_SNAPSHOTS) {
        const oldest = this.snapshots.keys().next().value;
        if (oldest !== undefined) this.snapshots.delete(oldest);
      }
    }
    return snap;
  }

  /**
   * The agent for a step. The whole team is read when a job asks for the first time and the answer is kept for that
   * job, so a rename, a new model or a firing applies from the next job on.
   */
  resolve(projectId: string, taskId: string, role: TeamRole): ResolvedMember | undefined {
    return this.snapshotOf(projectId, taskId).byRole.get(role);
  }

  /** A named member of the job's team (the same snapshot as `resolve`). */
  resolveMember(projectId: string, taskId: string, memberId: string): ResolvedMember | undefined {
    return this.snapshotOf(projectId, taskId).byId.get(memberId);
  }

  private workingMemberIds(projectId: string): Set<string> {
    const ids = new Set<string>();
    for (const b of this.o.busy?.(projectId) ?? []) {
      const m = this.resolve(projectId, b.taskId, b.role);
      if (m) ids.add(m.memberId);
    }
    return ids;
  }

  /** The model written into the agent file. A local member's file is only for the fallback, so it names the fallback model. */
  private fileModel(template: { runtime?: string | undefined; defaultModel: string }, member: TeamMember): string {
    if (template.runtime === "ollama") return INTERN_FALLBACK_MODEL;
    // A member on another provider does not run as kiro-cli; its agent file (kept for a switch back) names a Kiro model.
    if (!this.onKiro(member.provider)) return this.o.models.preferred(template.defaultModel);
    return member.model;
  }

  private fileFor(projectId: string, member: TeamMember): AgentFile {
    const template = this.o.catalogue.get(member.templateId);
    if (!template) throw new NotFoundError("unknown template");
    const spec = { agentName: `${projectId}-${member.id}`, model: this.fileModel(template, member) };
    return agentFileFor(spec, template, this.o.tiers[tierForRole(member.role)]);
  }

  /** Writes the agent files of the whole team, then stores it. A file that is refused stops the change. */
  private async commit(projectId: string, members: TeamMember[]): Promise<void> {
    for (const m of members) {
      const name = `${projectId}-${m.id}`;
      if (!AGENT_NAME_RE.test(name) || name.startsWith("agentlife-")) {
        throw new ConflictError("project_id_reserved", "This project's id cannot be used for a custom team.");
      }
    }
    const agents = this.o.agents;
    if (agents) {
      // Every file is checked before any is moved, so a refused file leaves the whole team's agents as they were.
      const files = members.map((m) => this.fileFor(projectId, m));
      try {
        await writeAgentFiles(files, { kiroHome: agents.kiroHome, ...(agents.validate ? { validate: agents.validate } : {}) });
      } catch (e) {
        const who = e instanceof AgentFileRefusedError ? members.find((m) => `${projectId}-${m.id}` === e.agentName) : undefined;
        const error = e instanceof Error ? e.message : String(e);
        this.log.warn("agent file refused", { projectId, member: who?.id, error });
        throw new ConflictError("agent_file_refused", `The agent file for ${who?.displayName ?? "a team member"} was refused: ${error || "unknown error"}`);
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
      if (template.runtime === "ollama" && !this.onKiro(body.provider)) {
        throw new BadRequestError("provider_fixed", "The Night intern always runs on this computer; it has no provider to choose.", [{ path: "provider", message: "not for this template" }]);
      }
      this.checkProvider(body.provider);
      const onKiro = this.onKiro(body.provider);
      if (!onKiro && body.model === undefined) {
        throw new BadRequestError("model_required", "Choose a model for a member on another provider than Kiro.", [{ path: "model", message: "required" }]);
      }
      const model = body.model ?? (template.runtime === "ollama" ? template.defaultModel : this.o.models.preferred(template.defaultModel));
      // A local model or a model of another provider is not one of the account's Kiro models, so that list does not apply.
      if (template.runtime !== "ollama" && onKiro) await this.checkModel(template.role, model);
      let id = `${template.role}-${this.newId()}`;
      while (members.some((m) => m.id === id)) id = `${template.role}-${this.newId()}`;
      const member: TeamMember = {
        id,
        displayName: body.displayName,
        templateId: template.id,
        role: template.role,
        model,
        ...(onKiro ? {} : { provider: body.provider }),
      };
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
      const local = this.o.catalogue.get(old.templateId)?.runtime === "ollama";
      if (local && body.provider !== undefined && !this.onKiro(body.provider)) {
        throw new BadRequestError("provider_fixed", "The Night intern always runs on this computer; it has no provider to choose.", [{ path: "provider", message: "not for this template" }]);
      }
      this.checkProvider(body.provider);
      const provider = body.provider ?? old.provider;
      const providerChanged = body.provider !== undefined && (body.provider === KIRO_PROVIDER ? undefined : body.provider) !== old.provider;
      if (providerChanged && body.model === undefined && !this.onKiro(provider)) {
        throw new BadRequestError("model_required", "Choose a model when you move a member to another provider.", [{ path: "model", message: "required" }]);
      }
      // Back on Kiro without a new model: the template's Kiro model, since the old one belonged to the other provider.
      const template = this.o.catalogue.get(old.templateId);
      const model = body.model ?? (providerChanged && this.onKiro(provider) && template ? this.o.models.preferred(template.defaultModel) : old.model);
      if (!local && this.onKiro(provider) && (body.model !== undefined || providerChanged)) await this.checkModel(old.role, model);
      const { provider: _drop, ...rest } = old;
      const next: TeamMember = {
        ...rest,
        ...(body.displayName !== undefined ? { displayName: body.displayName } : {}),
        model,
        ...(this.onKiro(provider) ? {} : { provider }),
      };
      await this.commit(projectId, members.map((m) => (m.id === memberId ? next : m)));
      if (next.displayName !== old.displayName) this.say(projectId, next.role, `Renamed ${old.displayName} to ${next.displayName}`);
      if (next.model !== old.model || next.provider !== old.provider) {
        const on = next.provider ? ` on ${this.providerLabel(next.provider)}` : "";
        this.say(projectId, next.role, `${next.displayName} now uses ${next.model}${on}`);
      }
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
          const file = agentFileFor({ agentName: name, model: this.fileModel(template, m) }, template, this.o.tiers[tierForRole(m.role)]);
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
      const stale = projects.some((p) => new RegExp(`^${escapeRegExp(p)}-(architect|developer|qa|reviewer|researcher)(-[0-9a-f]+)?$`).test(base));
      if (stale) {
        rmSync(path.join(dir, f), { force: true });
        removed += 1;
      }
    }
    return { written, removed };
  }
}

/** A project id as literal text inside a regular expression (ids are checked elsewhere; this keeps the match literal anyway). */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
