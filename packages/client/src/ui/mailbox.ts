import type { MemoryState } from "@agentlife/shared";
import type { PanelData } from "./panel-state.ts";
import { formatTime } from "./board.ts";
import type { LibraryActions } from "./library.ts";
import { renderRememberCard } from "./library.ts";
import { renderMarkdown } from "./markdown.ts";
import { newestFirst, renderReportViewer, reportBadge, reportHeadline } from "./report-viewer.ts";

export interface MailboxActions {
  decide(approvalId: string, decision: "approve" | "reject"): void;
  /** Open a report in the viewer. */
  openReport(reportId: string): void;
  /** Back from the viewer to the list. */
  back(): void;
  /** "Deliver as branch" in the report viewer. */
  deliver?(taskId: string): void;
  /** "Remember this?" in the report viewer. Absent in the recorded demo. */
  remember?: Pick<LibraryActions, "accept" | "dismiss" | "setAuto">;
}

export interface MailboxView {
  /** Report open in the viewer, if any. */
  reading: string | null;
  /** Reports delivered and not opened yet. */
  unread: ReadonlySet<string>;
  /** The Library of the floor's project, for the "Remember this?" card of the open report. */
  memory?: MemoryState | null;
  /** Why the last change to the Library was refused. */
  memoryError?: string | null;
}

const NO_VIEW: MailboxView = { reading: null, unread: new Set() };

export function renderMailbox(doc: Document, data: PanelData, actions: MailboxActions, view: MailboxView = NO_VIEW): HTMLElement {
  if (view.reading) {
    const report = data.reports.find((r) => r.reportId === view.reading);
    if (report) {
      const remember = actions.remember && report.kind !== "night" ? renderRememberCard(doc, report.taskId, view.memory ?? null, actions.remember) : null;
      if (remember && view.memoryError) {
        const err = doc.createElement("p");
        err.className = "al-error";
        err.setAttribute("role", "alert");
        err.textContent = view.memoryError;
        remember.appendChild(err);
      }
      return renderReportViewer(doc, report, actions, remember);
    }
  }
  const root = doc.createElement("div");

  const h1 = doc.createElement("h4");
  h1.textContent = "Approvals";
  root.appendChild(h1);
  if (data.approvals.length === 0) root.appendChild(note(doc, "No approvals."));
  for (const a of data.approvals) {
    const card = doc.createElement("section");
    card.className = "al-card";
    const title = doc.createElement("strong");
    title.textContent = `${a.kind} (${a.status})`;
    const body = doc.createElement("div");
    body.appendChild(renderMarkdown(doc, a.summary));
    card.append(title, body);
    if (a.status === "pending") {
      const row = doc.createElement("div");
      row.className = "al-row";
      for (const decision of ["approve", "reject"] as const) {
        const b = doc.createElement("button");
        b.type = "button";
        b.className = "al-btn";
        b.textContent = decision === "approve" ? "Approve" : "Reject";
        b.addEventListener("click", () => actions.decide(a.approvalId, decision));
        row.appendChild(b);
      }
      card.appendChild(row);
    }
    root.appendChild(card);
  }

  const h2 = doc.createElement("h4");
  h2.textContent = "Reports";
  root.appendChild(h2);
  if (data.reports.length === 0) root.appendChild(note(doc, "No reports yet."));
  for (const r of newestFirst(data.reports)) {
    const unread = view.unread.has(r.reportId);
    const item = doc.createElement("button");
    item.type = "button";
    item.className = "al-report-item";
    item.dataset["unread"] = String(unread);
    item.dataset["report"] = r.reportId;
    const headline = reportHeadline(r);
    item.title = `Open the report: ${headline}`;
    const label = doc.createElement("span");
    label.className = "al-report-title";
    label.textContent = headline;
    const when = doc.createElement("span");
    when.className = "al-muted";
    when.textContent = r.ts === undefined ? "" : formatTime(r.ts);
    item.append(reportBadge(doc, r), label, when);
    if (unread) {
      const mark = doc.createElement("span");
      mark.className = "al-new";
      mark.textContent = "NEW";
      item.appendChild(mark);
    }
    item.addEventListener("click", () => actions.openReport(r.reportId));
    root.appendChild(item);
  }
  return root;
}

function note(doc: Document, text: string): HTMLElement {
  const p = doc.createElement("p");
  p.className = "al-muted";
  p.textContent = text;
  return p;
}
