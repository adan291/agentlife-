import { mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  FINDINGS_SHOWN_MAX,
  PROJECT_NAME_MAX,
  PROJECT_TEST_COMMAND_MAX,
  ProjectStackSchema,
  type Project,
  type ProjectStack,
  type RegisterProjectBody,
  type RegisterProjectResult,
  type Repo,
} from "@agentlife/shared";
import { createLeakScanner, envSecretValues, groupFindings, isBlockingLeak } from "@agentlife/shared/leaks";
import type { RepoConfig } from "../config.ts";
import { ConflictError, NotFoundError } from "../errors.ts";
import { isInside } from "../paths.ts";
import { ProjectCheckError, inspectProject, scanProject } from "./inspect.ts";
import { isInsideRoot, realRoots, samePath } from "./roots.ts";

export const DEFAULT_NODE_TEST_COMMAND = "npm test";

const StoredProjectSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/).max(60),
  name: z.string().min(1).max(PROJECT_NAME_MAX),
  /** Absolute path. Lives only in this file and in engine logs; never in a response, event or report. */
  path: z.string().min(1),
  stack: ProjectStackSchema,
  testCommand: z.string().max(PROJECT_TEST_COMMAND_MAX),
  registeredAt: z.number().int().nonnegative(),
  /** Ids of the scanner findings the user accepted (hashes; the values themselves are not stored). */
  acceptedFindings: z.array(z.string().max(32)).max(1000),
});
export type StoredProject = z.infer<typeof StoredProjectSchema>;

const StoreFileSchema = z.object({ version: z.literal(1), projects: z.array(StoredProjectSchema) });

/** What the pipeline needs to know about a project. `path` is set for registered projects, `source` for the built-in one. */
export interface ResolvedProject {
  id: string;
  name: string;
  stack: ProjectStack;
  testCommand: string;
  builtin: boolean;
  registeredAt: number;
  path?: string;
  source?: string;
}

export interface ProjectRegistryOptions {
  /** `data/projects.json`. */
  file: string;
  /** Allowed project roots (absolute paths; they need not exist). */
  roots: readonly string[];
  /** The fixture projects of config/repos.json. */
  builtin: readonly RepoConfig[];
  /** Directory of the job clones (`data/repos`); `remove` deletes `<reposDir>/<id>`. */
  reposDir: string;
  /** The AGENT LIFE repository, which cannot be registered. */
  agentlifeRoot: string;
  /** Extra exact secret values for the leak scanner. Default: the well-known variables of the environment. */
  secrets?: readonly string[];
  /** Registration limits (tests use small ones). Default: `MAX_PROJECT_FILES` and `MAX_PROJECT_BYTES`. */
  limits?: { files: number; bytes: number };
  now?: () => number;
}

/** The registered project is no longer where it was or no longer inside an allowed root. */
export class ProjectUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectUnavailableError";
  }
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

function fail(code: Extract<RegisterProjectResult, { status: "error" }>["code"], message: string): RegisterProjectResult {
  return { status: "error", code, message };
}

/** The `GET /repos` view: the built-in project as before, registered ones with a one-line note on their tests. */
export function repoView(p: Project): Repo {
  if (p.builtin) return { id: p.id, name: p.name };
  return {
    id: p.id,
    name: p.name,
    description: p.stack === "node-npm" ? `Node project, tests run in Docker (${p.testCommand})` : "No supported test setup: tests are skipped",
  };
}

/** Registered projects (`data/projects.json`) plus the built-in fixture. Paths stay in here. */
export class ProjectRegistry {
  private readonly file: string;
  private readonly roots: readonly string[];
  private readonly builtin: readonly RepoConfig[];
  private readonly reposDir: string;
  private readonly agentlifeRoot: string;
  private readonly secrets: readonly string[];
  private readonly limits: { files: number; bytes: number } | undefined;
  private readonly now: () => number;
  private records: StoredProject[];

  constructor(opts: ProjectRegistryOptions) {
    this.file = opts.file;
    this.roots = opts.roots;
    this.builtin = opts.builtin;
    this.reposDir = opts.reposDir;
    this.agentlifeRoot = opts.agentlifeRoot;
    this.secrets = opts.secrets ?? envSecretValues();
    this.limits = opts.limits;
    this.now = opts.now ?? Date.now;
    this.records = this.load();
  }

  /** Allowed roots, for messages ("Projects must live inside ..."). They are configuration, not project paths. */
  allowedRoots(): readonly string[] {
    return this.roots;
  }

  private load(): StoredProject[] {
    let text: string;
    try {
      text = readFileSync(this.file, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw e;
    }
    let json: unknown;
    try {
      json = JSON.parse(text.replace(/^\uFEFF/, ""));
    } catch (e) {
      throw new Error(`projects: ${path.basename(this.file)} is not valid JSON (${(e as Error).message}); fix or remove it`);
    }
    const parsed = StoreFileSchema.safeParse(json);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
      throw new Error(`projects: ${path.basename(this.file)} is invalid: ${issues}`);
    }
    return parsed.data.projects;
  }

  /** Atomic: write a temporary file next to the target, then rename it over the target. */
  private save(): void {
    mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify({ version: 1, projects: this.records }, null, 2)}\n`, "utf8");
    renameSync(tmp, this.file);
  }

  // ---- queries ----

  private resolvedBuiltin(): ResolvedProject[] {
    return this.builtin.map((r) => ({
      id: r.id,
      name: r.name,
      stack: "node-npm",
      testCommand: r.testCommand,
      builtin: true,
      registeredAt: 0,
      source: r.source,
    }));
  }

  private resolvedRegistered(): ResolvedProject[] {
    return this.records.map((r) => ({
      id: r.id,
      name: r.name,
      stack: r.stack,
      testCommand: r.testCommand,
      builtin: false,
      registeredAt: r.registeredAt,
      path: r.path,
    }));
  }

  /** Built-in projects first, then the registered ones in registration order. */
  all(): ResolvedProject[] {
    return [...this.resolvedBuiltin(), ...this.resolvedRegistered()];
  }

  get(id: string): ResolvedProject | undefined {
    return this.all().find((p) => p.id === id);
  }

  has(id: string): boolean {
    return this.get(id) !== undefined;
  }

  /** The public view: id and name, never the path. */
  list(): Project[] {
    return this.all().map((p) => ({
      id: p.id,
      name: p.name,
      stack: p.stack,
      testCommand: p.testCommand,
      builtin: p.builtin,
      registeredAt: p.registeredAt,
    }));
  }

  /**
   * The real path of a registered project, checked again at job time: it must still exist, be a directory and lie
   * inside an allowed root (a folder swapped for a link to somewhere else is refused).
   */
  revalidate(project: ResolvedProject): string {
    if (!project.path) throw new ProjectUnavailableError(`'${project.id}' is not a registered project`);
    let real: string;
    try {
      real = realpathSync.native(project.path);
      if (!statSync(real).isDirectory()) throw new Error("not a directory");
    } catch {
      throw new ProjectUnavailableError(`project '${project.id}' is no longer on disk`);
    }
    if (!isInsideRoot(real, realRoots(this.roots))) {
      throw new ProjectUnavailableError(`project '${project.id}' is no longer inside an allowed project folder`);
    }
    return real;
  }

  // ---- changes ----

  private uniqueId(name: string): string | undefined {
    const base = slugify(name);
    if (!base) return undefined;
    const taken = new Set(this.all().map((p) => p.id));
    if (!taken.has(base)) return base;
    for (let n = 2; n < 1000; n++) {
      const id = `${base}-${n}`;
      if (!taken.has(id)) return id;
    }
    return undefined;
  }

  async register(body: RegisterProjectBody): Promise<RegisterProjectResult> {
    if (!path.isAbsolute(body.path)) return fail("invalid_path", "Enter the full path of the folder, for example D:\\AgentHotel\\my-project.");

    let real: string;
    try {
      real = realpathSync.native(body.path);
    } catch {
      return fail("path_not_found", "That folder does not exist.");
    }
    try {
      if (!statSync(real).isDirectory()) return fail("not_a_directory", "That path is not a folder.");
    } catch {
      return fail("path_not_found", "That folder does not exist.");
    }

    if (!isInsideRoot(real, realRoots(this.roots))) {
      const where = this.roots.length ? ` inside ${this.roots.join(" or ")}` : "; no project folder is configured";
      return fail("outside_allowed_roots", `Projects must live in a subfolder of an allowed project folder${where}.`);
    }
    if (this.records.some((r) => samePath(this.realOrSelf(r.path), real))) {
      return fail("already_registered", "That folder is already registered.");
    }

    let inspection: Awaited<ReturnType<typeof inspectProject>>;
    try {
      inspection = await inspectProject(real, { agentlifeRoot: this.agentlifeRoot, ...(this.limits ? { limits: this.limits } : {}) });
    } catch (e) {
      if (e instanceof ProjectCheckError) return fail(e.code, e.message);
      throw e;
    }

    const id = this.uniqueId(body.name);
    if (!id) return fail("invalid_name", "The name needs at least one letter or digit.");

    const scanner = createLeakScanner({ secrets: this.secrets });
    await scanProject(real, inspection.entries, scanner);
    const groups = groupFindings(scanner.findings).filter((g) => isBlockingLeak(g.finding));
    if (groups.length > 0 && !body.acceptFindings) {
      return {
        status: "needs_acceptance",
        findings: groups.slice(0, FINDINGS_SHOWN_MAX).map((g) => ({
          severity: g.finding.severity,
          kind: g.finding.kind,
          masked: g.finding.masked,
          where: g.where[0] ?? "",
          count: g.where.length,
        })),
        total: groups.length,
      };
    }

    const testCommand = inspection.stack === "node-npm" ? body.testCommand || DEFAULT_NODE_TEST_COMMAND : "";
    const record: StoredProject = {
      id,
      name: body.name,
      path: real,
      stack: inspection.stack,
      testCommand,
      registeredAt: this.now(),
      acceptedFindings: groups.map((g) => g.finding.id),
    };
    this.records = [...this.records, record];
    try {
      this.save();
    } catch (e) {
      this.records = this.records.filter((r) => r.id !== id);
      throw e;
    }
    return {
      status: "ok",
      project: { id, name: record.name, stack: record.stack, testCommand, builtin: false, registeredAt: record.registeredAt },
    };
  }

  /**
   * Unregisters a project and deletes the engine's job clone. The user's repository is never touched.
   * The caller makes sure no job is running on it.
   */
  remove(id: string): void {
    const project = this.get(id);
    if (!project) throw new NotFoundError(`unknown project '${id}'`);
    if (project.builtin) throw new ConflictError("builtin", "The built-in project cannot be removed.");
    const before = this.records;
    this.records = this.records.filter((r) => r.id !== id);
    try {
      this.save();
    } catch (e) {
      this.records = before;
      throw e;
    }
    const clone = path.join(this.reposDir, id);
    if (isInside(this.reposDir, clone) && !samePath(this.reposDir, clone)) {
      rmSync(clone, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }

  private realOrSelf(p: string): string {
    try {
      return realpathSync.native(p);
    } catch {
      return p;
    }
  }
}
