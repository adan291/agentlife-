import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { BUILT_IN_SOURCE, TEAM_ROLES, TemplateSchema, type CatalogueEntry, type TeamRole, type Template } from "@agentlife/shared";
import { DEFAULT_CONFIG_DIR } from "../config.ts";

export const CATALOGUE_DIR = path.join(DEFAULT_CONFIG_DIR, "catalogue");

/** Reads every `*.json` of the directory as a template. A file that is not valid, or whose id is not its file name, stops the engine. */
export function loadTemplates(dir: string = CATALOGUE_DIR): Template[] {
  const out: Template[] = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".json")).sort()) {
    const full = path.join(dir, f);
    let json: unknown;
    try {
      json = JSON.parse(readFileSync(full, "utf8"));
    } catch (e) {
      throw new Error(`catalogue: ${f} is not valid JSON: ${(e as Error).message}`);
    }
    const parsed = TemplateSchema.safeParse(json);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
      throw new Error(`catalogue: ${f} is invalid: ${issues}`);
    }
    if (`${parsed.data.id}.json` !== f) throw new Error(`catalogue: ${f} has id "${parsed.data.id}"`);
    out.push(parsed.data);
  }
  for (const role of TEAM_ROLES) {
    if (!out.some((t) => t.role === role)) throw new Error(`catalogue: no template for the role ${role}`);
  }
  return out;
}

/** The templates the user can hire from: the built-in ones, plus the imported ones the user approved. */
export class Catalogue {
  private readonly templates: Template[];
  private imported: Template[] = [];

  constructor(templates: readonly Template[] = loadTemplates()) {
    this.templates = [...templates];
  }

  list(): readonly Template[] {
    return [...this.templates, ...this.imported];
  }

  get(id: string): Template | undefined {
    return this.templates.find((t) => t.id === id) ?? this.imported.find((t) => t.id === id);
  }

  /**
   * Replaces the imported templates (the approved ones, kept by the import service). An imported template can never
   * take the id of a built-in one, so a built-in template cannot be shadowed.
   */
  setImported(templates: readonly Template[]): void {
    this.imported = templates.filter((t) => !this.templates.some((b) => b.id === t.id));
  }

  /** The template of the default team for a pipeline role: the one whose id is the role. */
  defaultFor(role: TeamRole): Template {
    const t = this.get(role);
    if (!t || t.role !== role) throw new Error(`catalogue: no default template for the role ${role}`);
    return t;
  }

  entries(): CatalogueEntry[] {
    return this.list().map((t) => ({
      id: t.id,
      name: t.name,
      role: t.role,
      tier: t.tier,
      defaultModel: t.defaultModel,
      description: t.description,
      source: t.source,
      origin: t.source === BUILT_IN_SOURCE ? "built-in" : "imported",
    }));
  }
}
