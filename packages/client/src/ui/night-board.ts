import {
  JOB_KINDS,
  JOB_TARGET_MAX_CHARS,
  GOAL_MAX_CHARS,
  NIGHT_SCOPE_MAX_PATHS,
  NightJobInputSchema,
  jobKindLabel,
  kindWritesFiles,
  nightStatusLabel,
} from "@agentlife/shared";
import type { JobKind, NightJob, NightJobRequest, NightState, NightTier } from "@agentlife/shared";
import type { PanelContent } from "./computer.ts";
import type { PanelData } from "./panel-state.ts";
import { createSelect } from "./select.ts";

export interface NightBoardActions {
  add(job: NightJobRequest): void;
  remove(id: string): void;
  move(id: string, direction: "up" | "down"): void;
}

/** What the panel shows besides the project list. */
export interface NightView {
  night: NightState | null;
  /** The engine refused a change, or the night shift is not available. Shown above the schedule. */
  error: string | null;
  /** Replay mode: the night shift is off, and this is the reason. */
  locked?: string | undefined;
}

const TIER_LABEL: Record<NightTier, string> = { cheap: "Cheap model", normal: "Normal model" };

/** What a job of this kind needs as a target, for the field label and placeholder. */
const TARGET_FIELD: Partial<Record<JobKind, { label: string; placeholder: string }>> = {
  "review-branch": { label: "Branch", placeholder: "feature/login" },
  "write-tests": { label: "Path or module", placeholder: "src/todo.ts" },
  document: { label: "Topic or path", placeholder: "How the build works" },
};

/** The pre-approval of a job in words, for the schedule and the form. */
export function approvalText(job: Pick<NightJob, "kind" | "preApprove" | "scopePaths">): string {
  if (!kindWritesFiles(job.kind)) return "No plan, so nothing to approve.";
  if (!job.preApprove) return "The plan waits for your approval.";
  if (job.kind === "write-tests") return "The plan is approved automatically if it only touches test files.";
  if (job.kind === "document") return "The plan is approved automatically if it only touches Markdown files and docs/.";
  return `The plan is approved automatically if it only touches: ${(job.scopePaths ?? []).join(", ")}.`;
}

/** The window line at the top of the panel. */
export function windowText(night: NightState): string {
  const c = night.config;
  const discord = c.discord === true ? "on" : "off";
  return `Night window ${c.start} to ${c.end} (this computer's time). Up to ${c.maxJobsPerNight} jobs a night, ${c.maxJobMinutes} minutes each. Morning message on Discord: ${discord} (set in config/night.json).`;
}

/** Scope lines typed by the user: one path per line, blank lines ignored. */
export function parseScope(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "");
}

/**
 * Checks what the user filled in with the same schema the engine uses. Returns the job to send, or the first problem in
 * words ("Branch: choose a branch").
 */
export function checkNightForm(form: {
  repoId: string;
  kind: JobKind;
  target: string;
  goal: string;
  tier: NightTier;
  preApprove: boolean;
  scope: string;
  deliver: boolean;
}): { ok: true; job: NightJobRequest } | { ok: false; problem: string; field: string } {
  const writes = kindWritesFiles(form.kind);
  const scope = form.kind === "change" && form.preApprove ? parseScope(form.scope) : [];
  const job: NightJobRequest = {
    repoId: form.repoId,
    kind: form.kind,
    tier: form.tier,
    preApprove: writes && form.preApprove,
    deliver: writes && form.deliver,
    ...(TARGET_FIELD[form.kind] ? { target: form.target.trim() } : {}),
    ...(form.kind === "change" && form.goal.trim() !== "" ? { goal: form.goal.trim() } : {}),
    ...(scope.length > 0 ? { scopePaths: scope } : {}),
  };
  if (!form.repoId) return { ok: false, field: "repoId", problem: "Choose a project." };
  const parsed = NightJobInputSchema.safeParse(job);
  if (parsed.success) return { ok: true, job };
  const issue = parsed.error.issues[0];
  const field = String(issue?.path[0] ?? "");
  const label = field === "target" ? (TARGET_FIELD[form.kind]?.label ?? "Target") : field === "goal" ? "Goal" : field === "scopePaths" ? "Scope" : "";
  const message = issue?.message ?? "check the form";
  const text = label ? `${label}: ${message}` : message;
  return { ok: false, field, problem: text.charAt(0).toUpperCase() + text.slice(1) };
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

/** Status chip text: the schedule says "Scheduled" for a job that waits for a night. */
export function nightChip(job: Pick<NightJob, "status">): string {
  return job.status === "scheduled" ? "Scheduled" : job.status === "running" ? "Running" : nightStatusLabel(job.status).replace(/^./, (c) => c.toUpperCase());
}

function jobCard(doc: Document, job: NightJob, projectName: string, canMove: { up: boolean; down: boolean }, actions: NightBoardActions): HTMLElement {
  const card = el(doc, "li", "al-card al-night-job");
  card.dataset["job"] = job.id;
  card.dataset["status"] = job.status;
  card.dataset["attention"] = String(job.status === "waiting");

  const head = el(doc, "div", "al-row al-wrap");
  const chip = el(doc, "span", "al-badge al-night-chip", nightChip(job));
  chip.dataset["status"] = job.status;
  head.append(chip, el(doc, "strong", undefined, projectName), el(doc, "span", "al-muted", jobKindLabel(job.kind)));
  card.appendChild(head);
  card.appendChild(el(doc, "p", "al-night-goal", job.goal));

  const facts = [
    TIER_LABEL[job.tier],
    approvalText(job),
    kindWritesFiles(job.kind) ? (job.deliver ? "Delivered as a branch if it passes." : "No branch is delivered.") : "",
  ].filter(Boolean);
  card.appendChild(el(doc, "p", "al-muted", facts.join(" ")));
  if (job.branch) card.appendChild(el(doc, "p", undefined, `Branch: ${job.branch}`));
  if (job.reason) card.appendChild(el(doc, "p", job.status === "waiting" ? "al-build-reason" : "al-muted", job.reason));

  const row = el(doc, "div", "al-row al-wrap");
  if (job.status === "scheduled") {
    const up = button(doc, "Up", () => actions.move(job.id, "up"), "Move this job earlier");
    up.disabled = !canMove.up;
    up.dataset["action"] = "up";
    const down = button(doc, "Down", () => actions.move(job.id, "down"), "Move this job later");
    down.disabled = !canMove.down;
    down.dataset["action"] = "down";
    row.append(up, down);
  }
  if (job.status === "running") {
    row.appendChild(el(doc, "span", "al-muted", "Running now. To stop it, cancel the job on its floor."));
  } else {
    const rm = button(doc, "Remove", () => actions.remove(job.id), job.status === "scheduled" ? "Take this job off the schedule" : "Remove this job from the list");
    rm.dataset["action"] = "remove";
    row.appendChild(rm);
  }
  card.appendChild(row);
  return card;
}

/**
 * The night board: the window and limits, the schedule in running order with up, down and remove, and a form to add a
 * job (project, kind, target, tier, automatic approval with its scope, delivery as a branch). The form is checked with
 * the engine's own schema before it is sent. Form values survive re-renders.
 */
export function createNightPanel(doc: Document, actions: NightBoardActions) {
  let repoId = "";
  let kind: JobKind = "audit-deps";
  let target = "";
  let goal = "";
  let tier: NightTier = "normal";
  let preApprove = false;
  let scope = "";
  let deliver = false;
  let problem = "";
  /** Ids on the schedule at the last render (null before the first one). */
  let known: Set<string> | null = null;
  return function render(data: PanelData, view: NightView, rerender: () => void): PanelContent {
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
    const night = view.night;
    if (!night) {
      if (!view.error) root.appendChild(el(doc, "p", "al-muted", "Loading the night schedule…"));
      return { body: root };
    }
    // A job that was not on the schedule before means the engine took the one the user just added: empty the form for
    // the next one. A refused job leaves the schedule as it was, so what the user typed stays.
    if (known !== null && night.jobs.some((j) => !known!.has(j.id))) {
      target = "";
      goal = "";
      scope = "";
    }
    known = new Set(night.jobs.map((j) => j.id));

    root.appendChild(
      el(doc, "p", "al-muted", "Jobs you schedule here run at night, one after another, while you sleep. In the morning the summary waits in the lobby mailbox. Nothing is ever pushed or merged."),
    );
    root.appendChild(el(doc, "p", night.open ? "al-build-phase" : "al-muted", night.open ? "The night shift is on now." : windowText(night)));
    if (night.open) root.appendChild(el(doc, "p", "al-muted", windowText(night)));

    const name = (id: string): string => data.projects.find((p) => p.id === id)?.name ?? id;
    root.appendChild(el(doc, "h4", undefined, "Schedule"));
    if (night.jobs.length === 0) {
      root.appendChild(el(doc, "p", "al-muted", "Nothing is scheduled."));
    } else {
      const scheduled = night.jobs.filter((j) => j.status === "scheduled");
      const list = el(doc, "ul", "al-night-list");
      for (const job of night.jobs) {
        const at = scheduled.indexOf(job);
        list.appendChild(jobCard(doc, job, name(job.repoId), { up: at > 0, down: at >= 0 && at < scheduled.length - 1 }, actions));
      }
      root.appendChild(list);
    }

    root.appendChild(el(doc, "h4", undefined, "Add a job"));
    if (data.projects.length === 0) {
      root.appendChild(el(doc, "p", "al-muted", "No projects yet. Register one at the Reception first."));
      return { body: root };
    }
    if (!data.projects.some((p) => p.id === repoId)) repoId = data.projects[0]!.id;

    const field = (label: string, control: HTMLElement): HTMLElement => {
      // A div, not a label: a label would forward clicks on its text to the select button and toggle the list.
      const wrap = el(doc, "div", "al-field");
      wrap.append(doc.createTextNode(label), control);
      root.appendChild(wrap);
      return wrap;
    };
    field(
      "Project",
      createSelect(doc, { label: "Project", value: repoId, options: data.projects.map((p) => ({ value: p.id, label: p.name })), onChange: (v) => { repoId = v; } }),
    );
    field(
      "What to do",
      createSelect(doc, {
        label: "What to do",
        value: kind,
        options: JOB_KINDS.map((k) => ({ value: k, label: jobKindLabel(k) })),
        onChange: (v) => {
          kind = v as JobKind;
          problem = "";
          rerender();
        },
      }),
    );

    const text = (label: string, value: string, set: (v: string) => void, max: number, placeholder: string, dataField: string): HTMLInputElement => {
      const wrap = el(doc, "label", undefined, label);
      const input = el(doc, "input", "al-input");
      input.type = "text";
      input.maxLength = max;
      input.placeholder = placeholder;
      input.value = value;
      input.dataset["field"] = dataField;
      input.addEventListener("input", () => set(input.value));
      wrap.appendChild(input);
      root.appendChild(wrap);
      return input;
    };
    const targetField = TARGET_FIELD[kind];
    if (targetField) text(targetField.label, target, (v) => { target = v; }, JOB_TARGET_MAX_CHARS, targetField.placeholder, "target");
    if (kind === "change") {
      const wrap = el(doc, "label", undefined, "Goal");
      const area = el(doc, "textarea", "al-input");
      area.rows = 3;
      area.maxLength = GOAL_MAX_CHARS;
      area.placeholder = "What should the agents do?";
      area.value = goal;
      area.dataset["field"] = "goal";
      area.addEventListener("input", () => { goal = area.value; });
      wrap.appendChild(area);
      root.appendChild(wrap);
    }
    if (kind === "audit-deps") {
      root.appendChild(el(doc, "p", "al-muted", "Lists outdated and vulnerable packages. It changes nothing and needs no approval. It runs offline, so the lists can be out of date."));
    }

    field(
      "Model",
      createSelect(doc, {
        label: "Model",
        value: tier,
        options: (Object.keys(TIER_LABEL) as NightTier[]).map((t) => ({ value: t, label: TIER_LABEL[t] })),
        onChange: (v) => { tier = v as NightTier; },
      }),
    );

    if (kindWritesFiles(kind)) {
      const check = (label: string, checked: boolean, set: (v: boolean) => void, dataField: string): HTMLInputElement => {
        const wrap = el(doc, "label", "al-night-check");
        const box = el(doc, "input");
        box.type = "checkbox";
        box.checked = checked;
        box.dataset["field"] = dataField;
        box.addEventListener("change", () => {
          set(box.checked);
          rerender();
        });
        wrap.append(box, doc.createTextNode(` ${label}`));
        root.appendChild(wrap);
        return box;
      };
      check("Approve the plan automatically when it stays inside a scope", preApprove, (v) => { preApprove = v; }, "preApprove");
      if (preApprove) {
        if (kind === "change") {
          const wrap = el(doc, "label", undefined, `Files and folders the plan may touch (one per line, a folder ends with /, at most ${NIGHT_SCOPE_MAX_PATHS})`);
          const area = el(doc, "textarea", "al-input");
          area.rows = 3;
          area.placeholder = "src/\nREADME.md";
          area.value = scope;
          area.dataset["field"] = "scopePaths";
          area.addEventListener("input", () => { scope = area.value; });
          wrap.appendChild(area);
          root.appendChild(wrap);
        } else {
          root.appendChild(el(doc, "p", "al-muted", approvalText({ kind, preApprove: true })));
        }
        root.appendChild(el(doc, "p", "al-muted", "If the plan touches anything else, the job stops at the approval and waits for you in the morning. Nothing is built."));
      }
      check("Deliver the result as a branch when it passes (never pushed or merged)", deliver, (v) => { deliver = v; }, "deliver");
    }

    const err = el(doc, "p", "al-error", problem);
    err.setAttribute("role", "alert");
    err.dataset["field"] = "problem";
    root.appendChild(err);

    const add = button(doc, "Add to the night", () => {
      const result = checkNightForm({ repoId, kind, target, goal, tier, preApprove, scope, deliver });
      if (!result.ok) {
        problem = result.problem;
        err.textContent = problem;
        return;
      }
      problem = "";
      err.textContent = "";
      actions.add(result.job);
    });
    add.dataset["action"] = "add";
    return { body: root, footer: add };
  };
}
