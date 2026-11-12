import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  BUILT_IN_SOURCE,
  ImportReviewSchema,
  ImportUrlSchema,
  TemplateIdSchema,
  TemplateSchema,
  type ImportReview,
  type ImportView,
  type Template,
} from "@agentlife/shared";
import { ConflictError, NotFoundError } from "../errors.ts";
import { BadRequestError } from "../http/server.ts";
import { noopLogger, type Logger } from "../log.ts";
import type { Catalogue } from "./catalogue.ts";
import {
  checkTemplateText,
  fetchImportText,
  isAllowedSource,
  normaliseSourceUrl,
  parseImport,
  templateHash,
  type FetchFn,
} from "./import.ts";

/** What the security agent says about a template: a verdict and what it found. Flags are text to show the user. */
export interface AgentReview {
  verdict: "pass" | "concerns";
  flags: string[];
}
export type ImportReviewer = (template: Template) => Promise<AgentReview>;

const IgnoredSchema = z.array(z.string().max(60)).max(30);
const SnapshotSchema = z.object({ template: TemplateSchema, hash: z.string().regex(/^[0-9a-f]{64}$/), ignored: IgnoredSchema, review: ImportReviewSchema });
const RecordSchema = z.object({
  id: TemplateIdSchema,
  url: ImportUrlSchema,
  importedAt: z.number().int().nonnegative(),
  /** What was fetched last and is waiting for the user (or equals the approved version). */
  current: SnapshotSchema,
  /** The version the user approved, with the hash they approved. Hireable. */
  approved: SnapshotSchema.extend({ approvedAt: z.number().int().nonnegative() }).optional(),
});
type ImportRecord = z.infer<typeof RecordSchema>;
const FileSchema = z.record(TemplateIdSchema, RecordSchema);

export interface ImportServiceOptions {
  /** `data/catalogue-imports.json`. */
  file: string;
  /** Addresses imports may come from. */
  sources: readonly string[];
  catalogue: Catalogue;
  /** The security agent's review. Absent: only the fixed checks run and the user is told so. */
  reviewer?: ImportReviewer;
  fetch?: FetchFn;
  timeoutMs?: number;
  now?: () => number;
  logger?: Logger;
}

/**
 * Imported templates (hr-desk requirement 3): fetch from a listed source, keep only the safe fields, check, review, and
 * wait for the user. A template becomes hireable (it enters the catalogue) only with the user's approval of its exact
 * content hash. A new version of the same file is a new hash: the version the user approved stays on offer, the new one
 * waits. The approval is checked again whenever the file is read, so a record edited on disk loses it.
 */
export class ImportService {
  private readonly o: ImportServiceOptions;
  private readonly log: Logger;
  private readonly now: () => number;
  private records = new Map<string, ImportRecord>();

  constructor(opts: ImportServiceOptions) {
    this.o = opts;
    this.log = opts.logger ?? noopLogger;
    this.now = opts.now ?? Date.now;
    this.load();
    this.syncCatalogue();
  }

  private load(): void {
    const file = this.o.file;
    if (!existsSync(file)) return;
    try {
      const parsed = FileSchema.parse(JSON.parse(readFileSync(file, "utf8")));
      for (const [id, r] of Object.entries(parsed)) {
        if (r.id !== id) throw new Error(`record ${id} has id ${r.id}`);
        const checked: ImportRecord = { ...r, current: { ...r.current, hash: templateHash(r.current.template) } };
        if (r.approved) {
          if (templateHash(r.approved.template) === r.approved.hash && r.approved.template.id === id) {
            checked.approved = r.approved;
          } else {
            this.log.warn("an approved import no longer matches its approval and was set back to pending", { id });
            delete checked.approved;
          }
        }
        this.records.set(id, checked);
      }
    } catch (e) {
      const aside = `${file}.bad-${this.now()}`;
      this.log.error("imports file unreadable, moved aside", { file: aside, error: e instanceof Error ? e.message : String(e) });
      this.records = new Map();
      try {
        renameSync(file, aside);
      } catch {
        // If even that fails the next save overwrites it.
      }
    }
  }

  private save(): void {
    mkdirSync(path.dirname(this.o.file), { recursive: true });
    const tmp = `${this.o.file}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(Object.fromEntries(this.records), null, 2)}\n`, "utf8");
    renameSync(tmp, this.o.file);
  }

  private syncCatalogue(): void {
    this.o.catalogue.setImported([...this.records.values()].flatMap((r) => (r.approved ? [r.approved.template] : [])));
  }

  sources(): string[] {
    return this.o.sources.flatMap((s) => normaliseSourceUrl(s) ?? []);
  }

  private view(r: ImportRecord): ImportView {
    const t = r.current.template;
    const status = !r.approved ? "pending" : r.approved.hash === r.current.hash ? "approved" : "update_pending";
    return {
      id: r.id,
      url: r.url,
      name: t.name,
      role: t.role,
      tier: t.tier,
      description: t.description,
      persona: t.persona,
      defaultModel: t.defaultModel,
      hash: r.current.hash,
      ignored: r.current.ignored,
      review: r.current.review,
      status,
      importedAt: r.importedAt,
    };
  }

  list(): ImportView[] {
    return [...this.records.values()]
      .sort((a, b) => b.importedAt - a.importedAt || a.id.localeCompare(b.id))
      .map((r) => this.view(r));
  }

  private async review(t: Template): Promise<ImportReview> {
    const flags = checkTemplateText(t);
    let agent: AgentReview | undefined;
    let note: string | undefined;
    if (this.o.reviewer) {
      try {
        agent = await this.o.reviewer(t);
      } catch (e) {
        this.log.warn("import review by the security agent failed", { id: t.id, error: e instanceof Error ? e.message : String(e) });
        note = "The security agent could not be reached; only the automatic checks ran.";
      }
    } else {
      note = "The security agent is not running; only the automatic checks ran.";
    }
    const all = [...flags];
    for (const f of agent?.flags ?? []) if (!all.includes(f)) all.push(f);
    const concerned = all.length > 0 || agent?.verdict === "concerns";
    if (concerned && all.length === 0) all.push("the security agent has concerns about this template");
    return {
      verdict: concerned ? "concerns" : "pass",
      flags: all.slice(0, 12),
      checkedBy: agent ? "checks+agent" : "checks",
      ...(note ? { note } : {}),
    };
  }

  /** Fetches the file at a listed address, checks it and stores it as waiting for the user. */
  async importFrom(rawUrl: string): Promise<ImportView> {
    const url = normaliseSourceUrl(rawUrl);
    if (url === undefined || !isAllowedSource(url, this.o.sources)) {
      throw new BadRequestError("source_not_allowed", "That address is not on the list of trusted sources (config/catalogue-sources.json).", [
        { path: "url", message: "not a trusted source" },
      ]);
    }
    const text = await fetchImportText(url, { ...(this.o.fetch ? { fetch: this.o.fetch } : {}), ...(this.o.timeoutMs ? { timeoutMs: this.o.timeoutMs } : {}) });
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new BadRequestError("import_refused", "The file is not valid JSON.");
    }
    const parsed = parseImport(json, url);
    if (!parsed.ok) throw new BadRequestError("import_refused", parsed.reason);
    const { template, ignored } = parsed;
    if (this.o.catalogue.list().some((t) => t.id === template.id && t.source === BUILT_IN_SOURCE)) {
      throw new ConflictError("template_id_taken", `A built-in template already uses the id ${template.id}.`);
    }
    const existing = this.records.get(template.id);
    if (existing && existing.url !== url) {
      throw new ConflictError("template_id_taken", `A template with the id ${template.id} was already imported from another address.`);
    }
    const hash = templateHash(template);
    const review = await this.review(template);
    const record: ImportRecord = {
      id: template.id,
      url,
      importedAt: this.now(),
      current: { template, hash, ignored, review },
      ...(existing?.approved ? { approved: existing.approved } : {}),
    };
    this.records.set(template.id, record);
    this.save();
    this.syncCatalogue();
    return this.view(record);
  }

  /** The user approves the content they read: `hash` must be the hash of what is on offer now. */
  approve(id: string, hash: string): ImportView {
    const r = this.records.get(id);
    if (!r) throw new NotFoundError("unknown import");
    if (hash !== r.current.hash) {
      throw new ConflictError("content_changed", "The template changed after you looked at it. Read it again before you approve.");
    }
    r.approved = { ...r.current, approvedAt: this.now() };
    this.save();
    this.syncCatalogue();
    return this.view(r);
  }

  /** Discards the version that waits. An approved older version stays; an import that was never approved is removed. */
  reject(id: string): ImportView | undefined {
    const r = this.records.get(id);
    if (!r) throw new NotFoundError("unknown import");
    if (r.approved) {
      const { approvedAt: _at, ...snapshot } = r.approved;
      r.current = snapshot;
      this.save();
      return this.view(r);
    }
    this.records.delete(id);
    this.save();
    this.syncCatalogue();
    return undefined;
  }
}
