import type { PanelData } from "./panel-state.ts";

export function formatTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** Board panel: current job and its state-change timeline. */
export function renderBoard(doc: Document, data: PanelData): HTMLElement {
  const root = doc.createElement("div");
  const job = data.job;
  if (!job) {
    const p = doc.createElement("p");
    p.className = "al-muted";
    p.textContent = "No job yet. Use the computer to start one.";
    root.appendChild(p);
    return root;
  }
  const head = doc.createElement("p");
  const strong = doc.createElement("strong");
  strong.textContent = `${job.state}`;
  head.append(strong, doc.createTextNode(` - ${job.goal}`));
  root.appendChild(head);

  const ol = doc.createElement("ol");
  ol.className = "al-timeline";
  for (const e of job.timeline) {
    const li = doc.createElement("li");
    li.textContent = `${formatTime(e.ts)}  ${e.state}${e.text ? ` - ${e.text}` : ""}`;
    ol.appendChild(li);
  }
  root.appendChild(ol);
  return root;
}
