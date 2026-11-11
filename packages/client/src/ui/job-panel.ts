import { ROLE_INFO } from "@agentlife/shared";
import type { AgentId, ArtifactView, EngineJobView, JobDetails, Plan, StepName, StepRecord } from "@agentlife/shared";
import { renderArtifact, parsePlan } from "./artifact-viewer.ts";
import { formatTime } from "./board.ts";
import { formatDuration } from "./duration.ts";
import type { PanelData } from "./panel-state.ts";
import { filesText } from "./work.ts";

type PlanTask = Plan["tasks"][number];

/** Shown instead of any credit number: kiro-cli headless does not report credits or tokens. */
export const CREDITS_LINE = "Credits: not reported by kiro-cli headless; see the Kiro usage panel";

const STEP_AGENT: Record<StepName, AgentId> = {
  analyze: "architect",
  develop: "developer",
  test: "qa",
  review: "qa",
  report: "architect",
};

const STATUS_TEXT: Record<StepRecord["status"], string> = {
  ok: "✓ ok",
  failed: "✗ failed",
  cancelled: "– cancelled",
  running: "… running",
};

/** One row of the steps table, as plain text. */
export interface StepRow {
  agent: string;
  step: StepName;
  model: string;
  status: string;
  duration: string;
  context: string;
  files: string;
  /** 1 for the first run of a step, 2 for the retry after a QA fail. */
  attempt: number;
}

const NONE = "—";

export function stepRows(steps: readonly StepRecord[], now: number = Date.now()): StepRow[] {
  const seen = new Map<StepName, number>();
  return steps.map((s) => {
    const attempt = (seen.get(s.step) ?? 0) + 1;
    seen.set(s.step, attempt);
    const ms = s.durationMs ?? (s.status === "running" ? Math.max(0, now - s.startedAt) : undefined);
    return {
      agent: ROLE_INFO[STEP_AGENT[s.step]].name,
      step: s.step,
      model: s.model ?? NONE,
      status: STATUS_TEXT[s.status],
      duration: ms === undefined ? NONE : formatDuration(ms),
      context: s.contextPeak === undefined ? NONE : `${Math.round(s.contextPeak)}%`,
      files: s.filesRead === undefined && s.filesEdited === undefined ? NONE : filesText(s.filesRead ?? 0, s.filesEdited ?? 0),
      attempt,
    };
  });
}

/** The plan task the job builds (the first one), from the plan artifact; undefined while there is no plan. */
export function chosenTask(details: JobDetails | null): PlanTask | undefined {
  const plan = details?.artifacts.find((a) => a.kind === "plan");
  return plan ? parsePlan(plan.content)?.tasks[0] : undefined;
}

/** Labels of the documents the card links to, in the order the job made them. */
export function documentLinks(details: JobDetails | null): { artifactId: string; label: string; kind: string }[] {
  return (details?.artifacts ?? []).map((a) => ({ artifactId: a.artifactId, kind: a.kind, label: a.title.length > 48 ? `${a.title.slice(0, 47)}…` : a.title }));
}

export interface JobPanelActions {
  /** Open a document of the job in the viewer. */
  view(artifactId: string): void;
  /** Back from the viewer to the card. */
  back(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
  const e = doc.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (className) e.className = className;
  return e;
}

function fact(doc: Document, dl: HTMLElement, name: string, value: string | HTMLElement): void {
  dl.appendChild(el(doc, "dt", name));
  const dd = el(doc, "dd");
  if (typeof value === "string") dd.textContent = value;
  else dd.appendChild(value);
  dl.appendChild(dd);
}

function stepsTable(doc: Document, steps: readonly StepRecord[], now: number): HTMLElement {
  const wrap = el(doc, "div", undefined, "al-table-wrap");
  const table = el(doc, "table", undefined, "al-table");
  const head = el(doc, "tr");
  for (const h of ["Agent", "Step", "Model", "Status", "Time", "Context", "Files", "Try"]) head.appendChild(el(doc, "th", h));
  table.appendChild(el(doc, "thead")).appendChild(head);
  const body = el(doc, "tbody");
  for (const r of stepRows(steps, now)) {
    const tr = el(doc, "tr");
    for (const cell of [r.agent, r.step, r.model, r.status, r.duration, r.context, r.files, String(r.attempt)]) tr.appendChild(el(doc, "td", cell));
    body.appendChild(tr);
  }
  table.appendChild(body);
  wrap.appendChild(table);
  return wrap;
}

function documentButtons(doc: Document, details: JobDetails, actions: JobPanelActions): HTMLElement {
  const row = el(doc, "div", undefined, "al-row al-wrap");
  for (const l of documentLinks(details)) {
    const b = el(doc, "button", l.label, "al-btn");
    b.type = "button";
    b.dataset["artifact"] = l.artifactId;
    b.title = `Open ${l.label}`;
    b.addEventListener("click", () => actions.view(l.artifactId));
    row.appendChild(b);
  }
  return row;
}

function viewer(doc: Document, artifact: ArtifactView, actions: JobPanelActions): HTMLElement {
  const root = el(doc, "div");
  const back = el(doc, "button", "← Back to the job", "al-btn");
  back.type = "button";
  back.addEventListener("click", actions.back);
  root.append(back, el(doc, "h4", artifact.title), renderArtifact(doc, artifact));
  return root;
}

/**
 * Job panel (the board): goal, chosen task and its acceptance criteria, repository, branch, state, the steps
 * table, links to the plan, patch, test log, review and report, the credits note and the timeline.
 * `viewing` is the id of a document opened in the viewer (it replaces the card).
 */
export function renderJobPanel(doc: Document, data: PanelData, viewing: string | null, actions: JobPanelActions, now: number = Date.now()): HTMLElement {
  const root = el(doc, "div", undefined, "al-job");
  const job = data.job;
  if (!job) {
    root.appendChild(el(doc, "p", "No job yet. Use the computer to start one.", "al-muted"));
    return root;
  }
  const details = data.details;
  if (viewing && details) {
    const a = details.artifacts.find((x) => x.artifactId === viewing);
    if (a) return viewer(doc, a, actions);
  }

  const view: Pick<EngineJobView, "goal" | "repoId" | "state"> & { branch?: string | undefined } = details ? details.job : job;
  const facts = el(doc, "dl", undefined, "al-facts");
  fact(doc, facts, "Goal", view.goal);
  const task = chosenTask(details);
  if (task) {
    fact(doc, facts, "Task", task.title);
    fact(doc, facts, "Acceptance", task.acceptance);
  }
  fact(doc, facts, "Repository", view.repoId);
  fact(doc, facts, "Branch", view.branch ?? NONE);
  fact(doc, facts, "State", view.state.replace(/_/g, " "));
  root.appendChild(facts);

  root.appendChild(el(doc, "h4", "Steps"));
  if (!details) root.appendChild(el(doc, "p", "Loading details…", "al-muted"));
  else if (details.job.steps.length === 0) root.appendChild(el(doc, "p", "No step has started yet.", "al-muted"));
  else root.appendChild(stepsTable(doc, details.job.steps, now));

  if (details && details.artifacts.length > 0) {
    root.appendChild(el(doc, "h4", "Documents"));
    root.appendChild(documentButtons(doc, details, actions));
  }
  root.appendChild(el(doc, "p", CREDITS_LINE, "al-muted al-credits"));

  root.appendChild(el(doc, "h4", "Timeline"));
  const ol = el(doc, "ol", undefined, "al-timeline");
  for (const e of job.timeline) ol.appendChild(el(doc, "li", `${formatTime(e.ts)}  ${e.state}${e.text ? ` - ${e.text}` : ""}`));
  root.appendChild(ol);
  return root;
}
