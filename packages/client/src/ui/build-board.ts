import type { BuildBoard, BuildPhase, BuildReport, BuildRow, BuildRowStatus, BuildSpec, ServerMsg } from "@agentlife/shared";
import { phaseGroup } from "@agentlife/shared";
import { renderMarkdown } from "./markdown.ts";

/** The panel asks for fresh data at most this often when no crew or phase message arrives (build-board, 3.3). */
export const BUILD_REFRESH_MS = 10_000;
/** After a crew or phase message the panel waits this long (so a burst becomes one request). */
export const BUILD_EVENT_REFRESH_MS = 1500;

/** True for a message that comes from the Builder (a crew or phase event): the board refreshes soon after it. */
export function isBuilderMessage(msg: ServerMsg): boolean {
  return (
    (msg.type === "agent_state" && msg.agentId === "builder") ||
    (msg.type === "say" && msg.id === "builder") ||
    (msg.type === "activity" && msg.line.agentId === "builder")
  );
}

export interface BuildBoardActions {
  /** Expand or collapse the task list of a row. */
  toggle(spec: string): void;
  /** Open the verify report of a spec. */
  openReport(spec: string): void;
}

/** Status chip text. The words carry the meaning; the colour only helps. */
export function chipText(status: BuildRowStatus): string {
  switch (status) {
    case "todo":
      return "To do";
    case "running":
      return "Running";
    case "verifying":
      return "Verifying";
    case "merged":
      return "Merged";
    case "waits_for_you":
      return "Waits for you";
    case "skipped":
      return "Skipped";
  }
}

/** Done tasks as a whole percentage; 0 when the spec has no tasks. */
export function progressPercent(spec: Pick<BuildSpec, "done" | "total"> | undefined): number {
  if (!spec || spec.total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((spec.done / spec.total) * 100)));
}

/** What the conductor is doing, in words, for the top of the panel. */
export function phaseLine(phase: BuildPhase | undefined): string {
  if (!phase) return "The conductor is not running.";
  const group = phaseGroup(phase.text);
  const where = phase.spec ? ` on ${phase.spec}` : "";
  if (group === "stopped") return `Stopped${phase.text.replace(/^stopped/i, "") || ""}${where}`.replace(/\s+/g, " ").trim();
  if (group === "done") return "The conductor finished the task map.";
  return `Conductor: ${phase.text}${where}`;
}

export function verdictLabel(verdict: BuildSpec["verdict"]): string {
  return verdict === "PASS" ? "✓ Verified: PASS" : verdict === "FAIL" ? "✗ Verified: FAIL" : "Not verified yet";
}

function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = doc.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function renderRow(doc: Document, row: BuildRow, spec: BuildSpec | undefined, expanded: boolean, actions: BuildBoardActions): HTMLElement {
  const item = el(doc, "li", "al-build-row");
  item.dataset["spec"] = row.spec;
  item.dataset["status"] = row.status;
  item.dataset["attention"] = String(row.status === "waits_for_you");

  const head = el(doc, "div", "al-build-head");
  const num = el(doc, "span", "al-floor-tag", String(row.number));
  num.setAttribute("aria-hidden", "true");
  const name = el(doc, "strong", "al-build-name", row.spec);
  const chip = el(doc, "span", "al-badge al-build-chip", chipText(row.status));
  chip.dataset["status"] = row.status;
  head.append(num, name, chip);

  const pct = progressPercent(spec);
  const bar = el(doc, "div", "al-build-bar");
  bar.setAttribute("role", "progressbar");
  bar.setAttribute("aria-valuemin", "0");
  bar.setAttribute("aria-valuemax", "100");
  bar.setAttribute("aria-valuenow", String(pct));
  bar.setAttribute("aria-label", `${row.spec}: ${spec?.done ?? 0} of ${spec?.total ?? 0} tasks done`);
  const fill = el(doc, "div", "al-build-fill");
  fill.style.width = `${pct}%`;
  bar.appendChild(fill);
  const count = el(doc, "span", "al-muted al-build-count", spec && spec.total > 0 ? `${spec.done}/${spec.total} tasks` : "no tasks yet");

  const meta = el(doc, "div", "al-build-meta");
  meta.append(bar, count);
  item.append(head, el(doc, "p", "al-muted al-build-purpose", row.purpose), meta);

  if (row.reason) {
    const why = el(doc, "p", "al-build-reason", `Waits for you: ${row.reason}`);
    why.setAttribute("role", "status");
    item.appendChild(why);
  }

  const buttons = el(doc, "div", "al-row al-wrap");
  if (spec && spec.tasks.length > 0) {
    const toggle = el(doc, "button", "al-btn", expanded ? "Hide tasks" : "Show tasks");
    toggle.type = "button";
    toggle.dataset["action"] = "toggle";
    toggle.setAttribute("aria-expanded", String(expanded));
    toggle.addEventListener("click", () => actions.toggle(row.spec));
    buttons.appendChild(toggle);
  }
  if (spec && spec.verdict !== "none") {
    const verdict = el(doc, "button", "al-btn al-build-verdict", verdictLabel(spec.verdict));
    verdict.type = "button";
    verdict.dataset["action"] = "report";
    verdict.dataset["verdict"] = spec.verdict.toLowerCase();
    verdict.setAttribute("aria-label", `Open the verification report of ${row.spec}`);
    verdict.addEventListener("click", () => actions.openReport(row.spec));
    buttons.appendChild(verdict);
  }
  if (buttons.children.length > 0) item.appendChild(buttons);

  if (expanded && spec) {
    const list = el(doc, "ul", "al-build-tasks");
    for (const t of spec.tasks) {
      const li = el(doc, "li", undefined, `${t.done ? "✓" : "○"} ${t.number}. ${t.title}`);
      li.dataset["done"] = String(t.done);
      list.appendChild(li);
    }
    item.appendChild(list);
  }
  return item;
}

/**
 * The construction board: what the conductor is doing, then the TASKMAP rows (rows that wait for the user come first,
 * the server already put them there), each with a status chip, a progress bar, its tasks on demand and a link to the
 * verification report. Text only.
 */
export function renderBuildBoard(doc: Document, board: BuildBoard | null, expanded: ReadonlySet<string>, actions: BuildBoardActions, error?: string | null): HTMLElement {
  const root = el(doc, "div", "al-build");
  if (!board) {
    const p = el(doc, "p", error ? "al-error" : "al-muted", error ? `Not available: ${error}` : "Loading the construction board…");
    if (error) p.setAttribute("role", "alert");
    root.appendChild(p);
    return root;
  }
  const phase = el(doc, "p", "al-build-phase", phaseLine(board.phase));
  phase.dataset["phase"] = board.phase ? phaseGroup(board.phase.text) : "none";
  root.appendChild(phase);
  if (board.rows.length === 0) {
    root.appendChild(el(doc, "p", "al-muted", "No task map found."));
  } else {
    const list = el(doc, "ul", "al-build-list");
    for (const row of board.rows) {
      list.appendChild(renderRow(doc, row, board.specs.find((s) => s.spec === row.spec), expanded.has(row.spec), actions));
    }
    root.appendChild(list);
  }
  if (board.sessions.length > 0) {
    root.appendChild(el(doc, "h4", undefined, "Last build sessions"));
    const log = el(doc, "ul", "al-build-sessions");
    for (const s of [...board.sessions].reverse()) {
      log.appendChild(el(doc, "li", "al-muted", `${s.session} · ${s.date} · ${s.model} · ${s.minutes} min · ${s.status}`));
    }
    root.appendChild(log);
  }
  return root;
}

/** The verification report of a spec as Markdown (text only, no HTML). */
export function renderBuildReport(doc: Document, spec: string, report: BuildReport | null, back: () => void): HTMLElement {
  const root = el(doc, "div", "al-build-report");
  const btn = el(doc, "button", "al-btn", "← Back to the construction board");
  btn.type = "button";
  btn.addEventListener("click", back);
  root.append(btn, el(doc, "h4", undefined, `Verification of ${spec}`));
  if (!report || report.spec !== spec) root.appendChild(el(doc, "p", "al-muted", "Loading the report…"));
  else root.appendChild(renderMarkdown(doc, report.content));
  return root;
}
