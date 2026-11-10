import type { PanelData } from "./panel-state.ts";
import { renderMarkdown } from "./markdown.ts";

export interface MailboxActions {
  decide(approvalId: string, decision: "approve" | "reject"): void;
}

export function renderMailbox(doc: Document, data: PanelData, actions: MailboxActions): HTMLElement {
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
  for (const r of data.reports) {
    const card = doc.createElement("section");
    card.className = "al-card";
    const title = doc.createElement("strong");
    title.textContent = r.title;
    card.append(title, renderMarkdown(doc, r.markdown));
    root.appendChild(card);
  }
  return root;
}

function note(doc: Document, text: string): HTMLElement {
  const p = doc.createElement("p");
  p.className = "al-muted";
  p.textContent = text;
  return p;
}
