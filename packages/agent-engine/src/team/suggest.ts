import { mkdirSync } from "node:fs";
import { z } from "zod";
import {
  SEATED_ROLES,
  SUGGESTION_PICKS_MAX,
  TEMPLATE_NAME_MAX,
  sanitize,
  type CatalogueEntry,
  type ProjectStack,
  type TeamMember,
  type TeamSuggestion,
  type TeamSuggestionPick,
} from "@agentlife/shared";
import { NotFoundError } from "../errors.ts";
import { git } from "../git.ts";
import { noopLogger, type Logger } from "../log.ts";
import { fence, loadPromptTemplate, renderPrompt } from "../prompts.ts";
import type { ProjectRegistry } from "../projects/registry.ts";
import type { AgentRuntime } from "../runtimes/types.ts";
import { runStructured } from "../steps/extract-json.ts";
import type { Catalogue } from "./catalogue.ts";
import type { ModelDirectory } from "./models.ts";
import type { TeamService } from "./service.ts";

/** What the HR agent knows about a project: its stack and its size. Never a path, never file contents. */
export interface ProjectFacts {
  name: string;
  stack: ProjectStack;
  /** Tracked files; undefined when they could not be counted (the built-in fixture, an unreadable folder). */
  files: number | undefined;
  /** The most common file extensions with their counts, e.g. `ts 41`. */
  extensions: string[];
  builtin: boolean;
}
export type FactsReader = (projectId: string) => Promise<ProjectFacts>;

/** Above this many tracked files a project counts as large; below the other, as small. */
export const LARGE_PROJECT_FILES = 300;
export const SMALL_PROJECT_FILES = 60;

export function topExtensions(files: readonly string[], n = 5): string[] {
  const counts = new Map<string, number>();
  for (const f of files) {
    const base = f.slice(f.lastIndexOf("/") + 1);
    const dot = base.lastIndexOf(".");
    const ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
    if (!/^[a-z0-9]{1,8}$/.test(ext)) continue;
    counts.set(ext, (counts.get(ext) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([ext, c]) => `${ext} ${c}`);
}

/** Reads the facts from the registry and from `git ls-files` of the project's folder. A folder that cannot be read gives no count. */
export function projectFactsReader(registry: ProjectRegistry): FactsReader {
  return async (projectId) => {
    const p = registry.get(projectId);
    if (!p) throw new NotFoundError("unknown project");
    let files: string[] | undefined;
    if (!p.builtin) {
      try {
        const out = await git(registry.revalidate(p), ["ls-files", "-z"]);
        files = out.split("\0").filter((f) => f !== "");
      } catch {
        files = undefined;
      }
    }
    return { name: p.name, stack: p.stack, files: files?.length, extensions: files ? topExtensions(files) : [], builtin: p.builtin };
  };
}

export interface Candidate {
  templateId: string;
  why: string;
}

/** The engine's own proposal, used when the HR agent is not available. */
export function rulesCandidates(facts: ProjectFacts): { summary: string; candidates: Candidate[] } {
  const small = facts.builtin || (facts.files !== undefined && facts.files < SMALL_PROJECT_FILES);
  const large = facts.files !== undefined && facts.files >= LARGE_PROJECT_FILES;
  const size = facts.builtin ? "a small sample project" : facts.files === undefined ? "a project of unknown size" : `${facts.files} tracked files`;
  const tests = facts.stack === "unsupported-tests" ? "no test setup the hotel can run" : "tests the hotel can run";
  const head = `${facts.name} is ${size}, with ${tests}.`;
  if (facts.stack === "unsupported-tests") {
    return {
      summary: `${head} QA cannot lean on test results here, so a stricter QA reads the change more carefully.`,
      candidates: [{ templateId: "qa-strict", why: "The tests cannot be run, so QA has to read the change closely." }],
    };
  }
  if (large) {
    return {
      summary: `${head} A big project has more places where a plan or a change can go wrong, so the thorough Architect and the strict QA are worth their cost.`,
      candidates: [
        { templateId: "architect-thorough", why: "A large project: read more before planning." },
        { templateId: "qa-strict", why: "A large project: review more closely." },
      ],
    };
  }
  if (small) {
    return {
      summary: `${head} A quick QA keeps jobs short and cheap.`,
      candidates: [{ templateId: "qa-fast", why: "A small project: a quick review is enough." }],
    };
  }
  return { summary: `${head} The standard team fits.`, candidates: [] };
}

const NAME_POOL = ["Wren", "Moss", "Ash", "Vesper", "Juniper", "Flint", "Marlow", "Sable", "Thistle", "Wick", "Briar", "Cinder"];

/** A name from the pool that nobody on the team has; numbered when the pool is used up. */
export function freeName(taken: ReadonlySet<string>): string {
  for (const n of NAME_POOL) if (!taken.has(n.toLowerCase())) return n;
  for (let i = 2; ; i++) {
    const n = `Agent ${i}`;
    if (!taken.has(n.toLowerCase())) return n;
  }
}

/** The HR agent's choice: templates and a reason each. The engine turns them into picks and checks every one. */
export interface AgentChoice {
  summary: string;
  candidates: Candidate[];
}
export type HrAgent = (input: { facts: ProjectFacts; team: readonly TeamMember[]; catalogue: readonly CatalogueEntry[] }) => Promise<AgentChoice>;

const ReplySchema = z.object({
  summary: z.string().max(800),
  picks: z.array(z.object({ templateId: z.string().max(60), why: z.string().max(400) })).max(8),
});

export interface AgentHrOptions {
  runtime: AgentRuntime;
  agent: string;
  model?: string;
  /** An empty directory the agent runs in. */
  cwd: string;
  timeoutMs?: number;
  rawLogPath?: string;
}

const oneLine = (s: string, max: number): string => s.replace(/\s+/g, " ").trim().slice(0, max);

/** The HR agent over a runtime: a read-only agent in an empty directory, given the facts in fences. */
export function agentHr(opts: AgentHrOptions): HrAgent {
  const timeoutMs = opts.timeoutMs ?? 90_000;
  return async ({ facts, team, catalogue }) => {
    mkdirSync(opts.cwd, { recursive: true });
    const factLines = [
      `stack: ${facts.stack}`,
      `tracked files: ${facts.files ?? (facts.builtin ? "a handful (sample project)" : "unknown")}`,
      ...(facts.extensions.length > 0 ? [`most common file types: ${facts.extensions.join(", ")}`] : []),
    ];
    const prompt = renderPrompt(loadPromptTemplate("hr-suggest"), {
      project: fence(oneLine(facts.name, 80)),
      facts: fence(factLines.join("\n")),
      team: fence(team.map((m) => `${m.role}: ${oneLine(m.displayName, 40)} (${m.templateId})`).join("\n")),
      catalogue: fence(catalogue.map((c) => `${c.id}: ${c.role}, ${oneLine(c.description, 120)}`).join("\n")),
      max: String(SUGGESTION_PICKS_MAX),
    });
    const ask = async (note?: string): Promise<string> => {
      const out: string[] = [];
      for await (const ev of opts.runtime.run({
        role: "qa",
        prompt: note ? `${prompt}\n\n${note}` : prompt,
        cwd: opts.cwd,
        timeoutMs,
        signal: AbortSignal.timeout(timeoutMs),
        agent: opts.agent,
        ...(opts.model ? { model: opts.model } : {}),
        ...(opts.rawLogPath ? { rawLogPath: opts.rawLogPath } : {}),
      })) {
        if (ev.kind === "output") out.push(ev.text);
      }
      return out.join("\n");
    };
    const reply = await runStructured({ what: "team suggestion", schema: ReplySchema, ask });
    return {
      summary: sanitize(reply.summary, 600),
      candidates: reply.picks.map((p) => ({ templateId: p.templateId, why: sanitize(p.why, 200) })),
    };
  };
}

export interface TeamSuggesterOptions {
  team: TeamService;
  catalogue: Catalogue;
  models: ModelDirectory;
  facts: FactsReader;
  /** Without it, or when it fails, the fixed rules choose. */
  agent?: HrAgent;
  logger?: Logger;
}

/**
 * "Suggest a team for this project" (hr-desk requirement 4.2). The HR agent (or, failing that, fixed rules) names the
 * templates; the engine decides what is a valid pick: a template of the catalogue for a role that has a desk, not the
 * one that holds the desk already, one pick per role, a model the role may use, a name nobody on the team has. The
 * result is only a proposal; nothing is hired here.
 */
export class TeamSuggester {
  private readonly o: TeamSuggesterOptions;
  private readonly log: Logger;

  constructor(opts: TeamSuggesterOptions) {
    this.o = opts;
    this.log = opts.logger ?? noopLogger;
  }

  async suggest(projectId: string): Promise<TeamSuggestion> {
    const { members } = this.o.team.team(projectId); // unknown project: NotFoundError
    const facts = await this.o.facts(projectId);
    let choice: AgentChoice | undefined;
    if (this.o.agent) {
      try {
        choice = await this.o.agent({ facts, team: members, catalogue: this.o.catalogue.entries() });
      } catch (e) {
        this.log.warn("the HR agent could not answer, the fixed rules choose", { projectId, error: e instanceof Error ? e.message : String(e) });
      }
    }
    const by = choice ? "agent" : "rules";
    const chosen = choice ?? rulesCandidates(facts);
    const picks = await this.picks(chosen.candidates, members);
    const summary = sanitize(chosen.summary, 600) || `${facts.name}: the standard team fits.`;
    return { projectId, summary, by, picks };
  }

  private async picks(candidates: readonly Candidate[], members: readonly TeamMember[]): Promise<TeamSuggestionPick[]> {
    const taken = new Set(members.map((m) => m.displayName.toLowerCase()));
    const seen = new Set<string>();
    const out: TeamSuggestionPick[] = [];
    for (const c of candidates) {
      if (out.length >= SUGGESTION_PICKS_MAX) break;
      const t = this.o.catalogue.get(c.templateId);
      if (!t || !(SEATED_ROLES as readonly string[]).includes(t.role) || seen.has(t.role)) continue;
      const role = t.role as (typeof SEATED_ROLES)[number];
      const holder = members.find((m) => m.role === role);
      if (holder?.templateId === t.id) continue;
      const allowed = await this.o.models.allowedFor(role);
      const wanted = this.o.models.preferred(t.defaultModel);
      const model = allowed.includes(wanted) ? wanted : allowed[0];
      if (!model) continue;
      const displayName = freeName(taken);
      taken.add(displayName.toLowerCase());
      seen.add(role);
      out.push({
        templateId: t.id,
        templateName: t.name.slice(0, TEMPLATE_NAME_MAX),
        role,
        displayName,
        model,
        why: sanitize(c.why, 200) || "Suits this project.",
        ...(holder ? { replacesId: holder.id, replacesName: holder.displayName } : {}),
      });
    }
    return out;
  }
}
