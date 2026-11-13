import { MemberNameSchema, SEATED_ROLES } from "@agentlife/shared";
import type { CatalogueEntry, EntityView, HrState, HrTeam, ImportView, TeamMember, TeamPick, TeamRole, TeamSuggestion } from "@agentlife/shared";
import type { PanelContent } from "./computer.ts";
import { levelLine, progressLines, statsLine } from "./progress.ts";

/** The HR desk's actions, as the panel sends them (panels.ts turns them into `hr_do` messages). */
export interface HrActions {
  hire(projectId: string, templateId: string, displayName: string, model: string | undefined): void;
  rename(projectId: string, memberId: string, displayName: string): void;
  setModel(projectId: string, memberId: string, model: string): void;
  fire(projectId: string, memberId: string): void;
  importFrom(url: string): void;
  approve(id: string, hash: string): void;
  reject(id: string): void;
  suggest(projectId: string): void;
  apply(projectId: string, picks: TeamPick[]): void;
}

export interface HrView {
  hr: HrState | null;
  error: string | null;
  suggestion: TeamSuggestion | null;
  /** Project the HR agent is working on a proposal for. */
  busy: string | null;
  /** Replay mode: the HR desk is off, and this is the reason. */
  locked?: string | undefined;
}

export type HrTab = "teams" | "catalogue" | "imports";

const TAB_LABEL: Record<HrTab, string> = { teams: "Teams", catalogue: "Catalogue", imports: "Imports" };
const ROLE_LABEL: Record<TeamRole, string> = { architect: "Architect", developer: "Developer", qa: "QA", reviewer: "Reviewer", researcher: "Researcher" };
const TIER_LABEL = { "read-only": "read-only", "write-in-worktree": "writes only in its own copy" } as const;

export const roleLabel = (role: TeamRole): string => ROLE_LABEL[role];

/** The first problem with a name the user typed, in words, or undefined when it is fine. */
export function nameProblem(name: string): string | undefined {
  const r = MemberNameSchema.safeParse(name);
  if (r.success) return undefined;
  const issue = r.error.issues[0]?.message ?? "not a valid name";
  return `Name: ${issue.charAt(0).toLowerCase()}${issue.slice(1)}.`;
}

/**
 * Where each member stands on the project's floor: the first member of a role that has a desk works it; every other
 * member (a second developer, a reviewer, a researcher, the Night intern) stands at a spot near the desks. Everybody
 * hired is on the floor (requirement 4.3).
 */
export function standing(members: readonly TeamMember[]): Map<string, "desk" | "floor"> {
  const out = new Map<string, "desk" | "floor">();
  const seated = new Set<TeamRole>();
  for (const m of members) {
    if (!(SEATED_ROLES as readonly string[]).includes(m.role) || seated.has(m.role)) {
      out.set(m.id, "floor");
    } else {
      seated.add(m.role);
      out.set(m.id, "desk");
    }
  }
  return out;
}

const STANDING_TEXT = { desk: "at the desk", floor: "on the floor" } as const;

/** One line for the status chip of an import. */
export function importStatusText(i: Pick<ImportView, "status">): string {
  return i.status === "approved" ? "Approved" : i.status === "update_pending" ? "Update waits for you" : "Waits for you";
}

/** A short line on who reviewed an import and what they found. */
export function reviewText(i: Pick<ImportView, "review">): string {
  const who = i.review.checkedBy === "checks+agent" ? "Checked by the automatic checks and the security agent" : "Checked by the automatic checks";
  return i.review.verdict === "pass" ? `${who}: nothing found.` : `${who}: read the concerns before you approve.`;
}

function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = doc.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function button(doc: Document, label: string, onClick: () => void, title?: string): HTMLButtonElement {
  const b = el(doc, "button", "al-btn", label);
  b.type = "button";
  if (title) {
    b.title = title;
    b.setAttribute("aria-label", title);
  }
  b.addEventListener("click", onClick);
  return b;
}

function selectOf(doc: Document, options: readonly { value: string; label: string }[], value: string, onChange: (v: string) => void, label: string): HTMLSelectElement {
  const s = el(doc, "select", "al-input");
  s.setAttribute("aria-label", label);
  for (const o of options) {
    const opt = el(doc, "option", undefined, o.label);
    opt.value = o.value;
    s.appendChild(opt);
  }
  s.value = options.some((o) => o.value === value) ? value : (options[0]?.value ?? "");
  s.addEventListener("change", () => onChange(s.value));
  return s;
}

function textInput(doc: Document, value: string, label: string, onInput: (v: string) => void, max = 30): HTMLInputElement {
  const i = el(doc, "input", "al-input");
  i.type = "text";
  i.maxLength = max;
  i.value = value;
  i.setAttribute("aria-label", label);
  i.addEventListener("input", () => onInput(i.value));
  return i;
}

interface HireForm {
  templateId: string;
  name: string;
  model: string;
}

/**
 * The HR desk: teams per project (hire, rename, change model, fire, ask the HR agent for a proposal), the catalogue, and
 * the imports waiting for the user's approval. The panel only sends what the user chose; the engine applies its rules
 * and answers with the new state. Form values and the open tab survive re-renders.
 */
export function createHrPanel(doc: Document, actions: HrActions, progressOf?: (projectId: string, memberId: string) => EntityView | undefined) {
  let tab: HrTab = "teams";
  const forms = new Map<string, HireForm>();
  const renames = new Map<string, string>();
  const problems = new Map<string, string>();

  const formFor = (projectId: string, catalogue: readonly CatalogueEntry[]): HireForm => {
    let f = forms.get(projectId);
    if (!f) {
      f = { templateId: catalogue[0]?.id ?? "", name: "", model: "" };
      forms.set(projectId, f);
    }
    return f;
  };

  function memberRow(team: HrTeam, m: TeamMember, where: "desk" | "floor", state: HrState, rerender: () => void): HTMLElement {
    const row = el(doc, "li", "al-card al-hr-member");
    row.dataset["member"] = m.id;
    row.dataset["standing"] = where;
    const head = el(doc, "div", "al-row al-wrap");
    head.append(el(doc, "strong", undefined, m.displayName), el(doc, "span", "al-badge", roleLabel(m.role)), el(doc, "span", "al-muted", STANDING_TEXT[where]));
    row.appendChild(head);
    const template = state.catalogue.find((c) => c.id === m.templateId);
    row.appendChild(el(doc, "p", "al-muted", `${template?.name ?? m.templateId} · ${m.model}`));
    // Level and stats come from the real work this member did (team-progress); a member with no work yet is level 0.
    const lv = progressOf?.(team.projectId, m.id);
    if (lv) {
      const line = el(doc, "p", "al-hr-level", `${levelLine(lv)} · ${statsLine(lv)}`);
      line.title = progressLines(lv).join("\n");
      row.appendChild(line);
    }

    const key = `${team.projectId}/${m.id}`;
    const controls = el(doc, "div", "al-row al-wrap");
    const rename = textInput(doc, renames.get(key) ?? m.displayName, `New name for ${m.displayName}`, (v) => renames.set(key, v));
    rename.dataset["field"] = "rename";
    const save = button(doc, "Rename", () => {
      const name = (renames.get(key) ?? m.displayName).trim();
      const problem = nameProblem(name);
      if (problem) {
        problems.set(team.projectId, problem);
        return rerender();
      }
      problems.delete(team.projectId);
      if (name !== m.displayName) actions.rename(team.projectId, m.id, name);
      renames.delete(key);
    });
    save.dataset["action"] = "rename";
    const models = state.models[m.role] ?? [m.model];
    const model = selectOf(
      doc,
      (models.includes(m.model) ? models : [m.model, ...models]).map((v) => ({ value: v, label: v })),
      m.model,
      (v) => actions.setModel(team.projectId, m.id, v),
      `Model for ${m.displayName}`,
    );
    model.dataset["field"] = "model";
    const fire = button(doc, "Fire", () => actions.fire(team.projectId, m.id), `Let ${m.displayName} go`);
    fire.dataset["action"] = "fire";
    controls.append(rename, save, model, fire);
    row.appendChild(controls);
    return row;
  }

  function hireForm(team: HrTeam, state: HrState, rerender: () => void): HTMLElement {
    const form = formFor(team.projectId, state.catalogue);
    const box = el(doc, "div", "al-field");
    box.appendChild(el(doc, "h5", undefined, "Hire"));
    const row = el(doc, "div", "al-row al-wrap");
    const template = selectOf(
      doc,
      state.catalogue.map((c) => ({ value: c.id, label: `${c.name} (${roleLabel(c.role)})` })),
      form.templateId,
      (v) => {
        form.templateId = v;
        form.model = "";
        rerender();
      },
      "Template to hire",
    );
    template.dataset["field"] = "template";
    const entry = state.catalogue.find((c) => c.id === form.templateId);
    const allowed = entry ? (state.models[entry.role] ?? []) : [];
    const modelOptions = [{ value: "", label: entry ? `Default (${entry.defaultModel})` : "Default" }, ...allowed.map((v) => ({ value: v, label: v }))];
    const model = selectOf(doc, modelOptions, form.model, (v) => (form.model = v), "Model");
    model.dataset["field"] = "hire-model";
    const name = textInput(doc, form.name, "Name of the new member", (v) => (form.name = v));
    name.placeholder = "Name";
    name.dataset["field"] = "hire-name";
    const hire = button(doc, "Hire", () => {
      const n = form.name.trim();
      const problem = nameProblem(n);
      if (problem || !form.templateId) {
        problems.set(team.projectId, problem ?? "Choose who to hire.");
        return rerender();
      }
      problems.delete(team.projectId);
      actions.hire(team.projectId, form.templateId, n, form.model || undefined);
      form.name = "";
    });
    hire.dataset["action"] = "hire";
    row.append(template, model, name, hire);
    box.appendChild(row);
    if (entry) box.appendChild(el(doc, "p", "al-muted", `${entry.description} It ${entry.tier === "read-only" ? "can only read" : "may change files only in its own copy of"} the project.`));
    return box;
  }

  function suggestionCard(team: HrTeam, s: TeamSuggestion): HTMLElement {
    const card = el(doc, "div", "al-card al-hr-suggestion");
    card.appendChild(el(doc, "strong", undefined, s.by === "agent" ? "The HR agent suggests" : "Suggestion (fixed rules; the HR agent was not available)"));
    card.appendChild(el(doc, "p", undefined, s.summary));
    if (s.picks.length === 0) {
      card.appendChild(el(doc, "p", "al-muted", "No change: the current team fits."));
      return card;
    }
    const list = el(doc, "ul", "al-night-list");
    for (const p of s.picks) {
      const li = el(doc, "li");
      li.textContent = `${p.templateName} as ${p.displayName} (${p.model})${p.replacesName ? `, instead of ${p.replacesName}` : ""}: ${p.why}`;
      list.appendChild(li);
    }
    card.appendChild(list);
    const apply = button(doc, "Apply this team", () =>
      actions.apply(
        team.projectId,
        s.picks.map((p) => ({ templateId: p.templateId, displayName: p.displayName, model: p.model, ...(p.replacesId ? { replacesId: p.replacesId } : {}) })),
      ),
    );
    apply.dataset["action"] = "apply";
    card.appendChild(apply);
    return card;
  }

  function teamsTab(state: HrState, view: HrView, rerender: () => void): HTMLElement {
    const root = el(doc, "div");
    root.appendChild(
      el(
        doc,
        "p",
        "al-muted",
        "Each project has its own team, and everybody hired is on the project's floor. The first member of a role works that role's desk; the others stand near the desks. A change applies to the next job. The HR agent only proposes: nothing changes until you apply it.",
      ),
    );
    if (state.teams.length === 0) root.appendChild(el(doc, "p", "al-muted", "There are no projects yet. Register one at the Reception in the lobby."));
    for (const team of state.teams) {
      const section = el(doc, "section", "al-card al-hr-team");
      section.dataset["project"] = team.projectId;
      const head = el(doc, "div", "al-row al-wrap");
      head.append(el(doc, "h4", undefined, team.name), el(doc, "span", "al-muted", team.customised ? "Custom team" : "Default team"));
      const busy = view.busy === team.projectId;
      const ask = button(doc, busy ? "Asking the HR agent…" : "Suggest a team", () => actions.suggest(team.projectId));
      ask.disabled = busy;
      ask.dataset["action"] = "suggest";
      head.appendChild(ask);
      section.appendChild(head);
      const problem = problems.get(team.projectId);
      if (problem) {
        const p = el(doc, "p", "al-error", problem);
        p.setAttribute("role", "alert");
        section.appendChild(p);
      }
      if (view.suggestion && view.suggestion.projectId === team.projectId) section.appendChild(suggestionCard(team, view.suggestion));
      const where = standing(team.members);
      const list = el(doc, "ul", "al-night-list");
      for (const m of team.members) list.appendChild(memberRow(team, m, where.get(m.id) ?? "floor", state, rerender));
      section.appendChild(list);
      section.appendChild(hireForm(team, state, rerender));
      root.appendChild(section);
    }
    return root;
  }

  function catalogueTab(state: HrState): HTMLElement {
    const root = el(doc, "div");
    root.appendChild(
      el(doc, "p", "al-muted", "Who can be hired. A template sets who an agent is: its name, voice and default model. What it may do comes from its tier, which no template can change."),
    );
    const list = el(doc, "ul", "al-night-list");
    for (const c of state.catalogue) {
      const li = el(doc, "li", "al-card al-hr-template");
      li.dataset["template"] = c.id;
      const head = el(doc, "div", "al-row al-wrap");
      head.append(
        el(doc, "strong", undefined, c.name),
        el(doc, "span", "al-badge", roleLabel(c.role)),
        el(doc, "span", "al-muted", `${c.origin === "imported" ? "imported" : "built in"} · ${TIER_LABEL[c.tier]} · ${c.runtime === "ollama" ? `runs on this computer (${c.defaultModel}), free` : c.defaultModel}`),
      );
      li.append(head, el(doc, "p", undefined, c.description));
      list.appendChild(li);
    }
    root.appendChild(list);
    return root;
  }

  function importCard(i: ImportView): HTMLElement {
    const card = el(doc, "li", "al-card al-hr-import");
    card.dataset["import"] = i.id;
    card.dataset["status"] = i.status;
    const head = el(doc, "div", "al-row al-wrap");
    const chip = el(doc, "span", "al-badge al-night-chip", importStatusText(i));
    chip.dataset["status"] = i.status === "approved" ? "done" : "waiting";
    head.append(chip, el(doc, "strong", undefined, i.name), el(doc, "span", "al-badge", roleLabel(i.role)), el(doc, "span", "al-muted", `${TIER_LABEL[i.tier]} · ${i.defaultModel}`));
    card.appendChild(head);
    card.appendChild(el(doc, "p", "al-muted", `From ${i.url}`));
    card.appendChild(el(doc, "p", undefined, i.description));
    if (i.ignored.length > 0) card.appendChild(el(doc, "p", "al-muted", `Ignored for safety: ${i.ignored.join(", ")}. A template cannot give an agent tools or permissions.`));
    const review = el(doc, "p", i.review.verdict === "pass" ? "al-muted" : "al-build-reason", reviewText(i));
    card.appendChild(review);
    if (i.review.flags.length > 0) {
      const flags = el(doc, "ul");
      for (const f of i.review.flags) flags.appendChild(el(doc, "li", undefined, f));
      card.appendChild(flags);
    }
    if (i.review.note) card.appendChild(el(doc, "p", "al-muted", i.review.note));
    card.appendChild(el(doc, "h5", undefined, "Persona (read it before you approve)"));
    card.appendChild(el(doc, "pre", "al-plain", i.persona));
    const row = el(doc, "div", "al-row al-wrap");
    if (i.status !== "approved") {
      const approve = button(doc, i.status === "update_pending" ? "Approve the update" : "Approve", () => actions.approve(i.id, i.hash), "Make this template hireable");
      approve.dataset["action"] = "approve";
      row.appendChild(approve);
    }
    const reject = button(doc, i.status === "approved" ? "Keep as it is" : "Reject", () => actions.reject(i.id));
    reject.dataset["action"] = "reject";
    if (i.status !== "approved") row.appendChild(reject);
    card.appendChild(row);
    return card;
  }

  function importsTab(state: HrState): HTMLElement {
    const root = el(doc, "div");
    root.appendChild(
      el(
        doc,
        "p",
        "al-muted",
        "New templates can be imported only from the addresses you list in config/catalogue-sources.json. Only the name, description, persona and default model are kept. A template becomes hireable when you approve it, and any later change to it needs a new approval.",
      ),
    );
    root.appendChild(el(doc, "h4", undefined, "Trusted sources"));
    if (state.sources.length === 0) {
      root.appendChild(el(doc, "p", "al-muted", "No sources are listed, so imports are off."));
    } else {
      const list = el(doc, "ul", "al-night-list");
      for (const url of state.sources) {
        const li = el(doc, "li", "al-row al-wrap");
        li.dataset["source"] = url;
        const go = button(doc, "Import", () => actions.importFrom(url), `Fetch ${url}`);
        go.dataset["action"] = "import";
        li.append(go, el(doc, "span", undefined, url));
        list.appendChild(li);
      }
      root.appendChild(list);
    }
    root.appendChild(el(doc, "h4", undefined, "Imported templates"));
    if (state.imports.length === 0) {
      root.appendChild(el(doc, "p", "al-muted", "Nothing has been imported."));
    } else {
      const list = el(doc, "ul", "al-night-list");
      for (const i of state.imports) list.appendChild(importCard(i));
      root.appendChild(list);
    }
    return root;
  }

  return function render(view: HrView, rerender: () => void): PanelContent {
    const root = el(doc, "div");
    if (view.locked) {
      root.appendChild(el(doc, "p", "al-muted", view.locked));
      return { body: root };
    }
    if (view.error) {
      const err = el(doc, "p", "al-error", view.error);
      err.setAttribute("role", "alert");
      root.appendChild(err);
    }
    const state = view.hr;
    if (!state) {
      if (!view.error) root.appendChild(el(doc, "p", "al-muted", "Loading the HR desk…"));
      return { body: root };
    }
    const tabs = el(doc, "div", "al-row al-wrap");
    tabs.setAttribute("role", "tablist");
    for (const t of Object.keys(TAB_LABEL) as HrTab[]) {
      const pending = t === "imports" ? state.imports.filter((i) => i.status !== "approved").length : 0;
      const b = button(doc, pending > 0 ? `${TAB_LABEL[t]} (${pending})` : TAB_LABEL[t], () => {
        tab = t;
        rerender();
      });
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", String(t === tab));
      b.dataset["tab"] = t;
      if (t === tab) b.disabled = true;
      tabs.appendChild(b);
    }
    root.appendChild(tabs);
    root.appendChild(tab === "teams" ? teamsTab(state, view, rerender) : tab === "catalogue" ? catalogueTab(state) : importsTab(state));
    return { body: root };
  };
}
