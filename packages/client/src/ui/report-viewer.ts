import type { Report } from "@agentlife/shared";
import { formatTime } from "./board.ts";
import { parseMarkdown, renderMarkdown, type Block, type Inline } from "./markdown.ts";

export type ReportVerdict = "pass" | "fail";

const inlineText = (xs: readonly Inline[]): string => xs.map((x) => x.text).join("");

/** The facts a reader wants before the full text. All optional: an old or failed report may lack a section. */
export interface ReportFacts {
  task?: string;
  /** "1 file changed, +1 -1." */
  change?: string;
  /** "Passed (exit code 0)" */
  tests?: string;
  /** "Verdict: PASS, risk: low." */
  review?: string;
  /** Verdict written in the Summary section, used when the message carries none. */
  verdict?: ReportVerdict;
}

function firstSentence(text: string): string {
  const cut = /\.(\s|$)/.exec(text);
  return (cut ? text.slice(0, cut.index) : text).trim();
}

/** Reads the facts out of the Markdown of `buildReport` (engine). Works on the parsed blocks, never on HTML. */
export function reportFacts(markdown: string): ReportFacts {
  const facts: ReportFacts = {};
  let section = "";
  for (const b of parseMarkdown(markdown) as Block[]) {
    if (b.kind === "heading") {
      if (b.level === 2) section = inlineText(b.inline).trim().toLowerCase();
      continue;
    }
    if (section === "summary" && b.kind === "list") {
      for (const item of b.items) {
        const text = inlineText(item).trim();
        const task = /^task:\s*(.*)$/i.exec(text);
        if (task?.[1]) facts.task = task[1];
        const verdict = /^verdict:\s*(pass|fail)\b/i.exec(text);
        if (verdict?.[1]) facts.verdict = verdict[1].toLowerCase() === "pass" ? "pass" : "fail";
      }
    } else if (b.kind === "paragraph") {
      const text = inlineText(b.inline).trim();
      if (section === "change" && facts.change === undefined) facts.change = text;
      else if (section === "tests" && facts.tests === undefined) facts.tests = firstSentence(text.replace(/\bLast lines of the log:?$/i, "").trim());
      else if (section === "review" && facts.review === undefined) facts.review = text;
    }
  }
  return facts;
}

/** The verdict of a report: the one the server sent, or the one written in its Summary. */
export function reportVerdict(report: Pick<Report, "verdict" | "markdown">): ReportVerdict | undefined {
  return report.verdict ?? reportFacts(report.markdown).verdict;
}

/** Line of the mailbox list: the implemented task when the report names it, otherwise the report title. */
export function reportHeadline(report: Pick<Report, "title" | "markdown">): string {
  return reportFacts(report.markdown).task ?? report.title;
}

/** Reports newest first. Reports without a time keep their arrival order, the later one first. */
export function newestFirst<T extends { reportId: string; ts?: number | undefined }>(reports: readonly T[]): T[] {
  return reports
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (b.r.ts ?? 0) - (a.r.ts ?? 0) || b.i - a.i)
    .map((x) => x.r);
}

/** Text of the verdict badge. The words and the symbol carry the meaning, the colour only helps. */
export function verdictText(verdict: ReportVerdict | undefined): string {
  return verdict === "pass" ? "✓ PASS" : verdict === "fail" ? "✗ FAIL" : "? No verdict";
}

export function verdictBadge(doc: Document, verdict: ReportVerdict | undefined): HTMLElement {
  const badge = doc.createElement("span");
  badge.className = "al-badge";
  badge.dataset["verdict"] = verdict ?? "unknown";
  badge.textContent = verdictText(verdict);
  return badge;
}

export interface ReportViewerActions {
  back(): void;
  /** Fetch the job's branch into the user's repository ("Deliver as branch"). */
  deliver?(taskId: string): void;
}

/** `git log agentlife/task-1`: how to look at a delivered branch. Built from the engine's branch name. */
export function deliveryCommand(branch: string): string {
  return `git log ${branch}`;
}

/**
 * The delivery block of a report on a registered project: the button while the branch can be delivered, and after
 * delivery the branch name, its commit and the command to look at it. Nothing for reports without delivery.
 */
export function renderDelivery(doc: Document, report: Report, actions: ReportViewerActions): HTMLElement | null {
  const d = report.delivery;
  if (!d) return null;
  const box = doc.createElement("section");
  box.className = "al-card al-delivery";
  box.dataset["delivery"] = d.state;
  if (d.state === "available") {
    const note = doc.createElement("p");
    note.textContent = "The change is a branch in the hotel's copy of your project. Deliver it to get a new branch in your repository. Your files and your current branch stay as they are; nothing is merged or pushed.";
    const btn = doc.createElement("button");
    btn.type = "button";
    btn.className = "al-btn";
    btn.textContent = "Deliver as branch";
    btn.dataset["action"] = "deliver";
    btn.addEventListener("click", () => actions.deliver?.(report.taskId));
    box.append(note, btn);
    return box;
  }
  const done = doc.createElement("p");
  done.append("Delivered as branch ");
  const name = doc.createElement("code");
  name.textContent = d.branch;
  done.append(name, ` (commit ${d.commit.slice(0, 7)}). Look at it with `);
  const cmd = doc.createElement("code");
  cmd.textContent = deliveryCommand(d.branch);
  done.append(cmd, ". Merge it yourself when you are happy with it.");
  box.appendChild(done);
  return box;
}

/**
 * The report in a wide panel: verdict badge first, then the title, the time and the key facts, then every section of
 * the report (headings, the change with green and red diff lines, the test summary and log, the review). Text only.
 */
export function renderReportViewer(doc: Document, report: Report, actions: ReportViewerActions): HTMLElement {
  const root = doc.createElement("div");
  root.className = "al-report";
  const back = doc.createElement("button");
  back.type = "button";
  back.className = "al-btn";
  back.textContent = "← Back to the mailbox";
  back.addEventListener("click", actions.back);

  const head = doc.createElement("div");
  head.className = "al-report-head";
  const title = doc.createElement("strong");
  title.textContent = report.title;
  const when = doc.createElement("span");
  when.className = "al-muted";
  when.textContent = report.ts === undefined ? "" : formatTime(report.ts);
  head.append(verdictBadge(doc, reportVerdict(report)), title, when);

  const facts = reportFacts(report.markdown);
  const list = doc.createElement("ul");
  list.className = "al-report-facts";
  for (const [label, value] of [
    ["Task", facts.task],
    ["Change", facts.change],
    ["Tests", facts.tests],
    ["Review", facts.review],
  ] as const) {
    if (!value) continue;
    const li = doc.createElement("li");
    li.textContent = `${label}: ${value}`;
    list.appendChild(li);
  }

  root.append(back, head);
  const delivery = renderDelivery(doc, report, actions);
  if (delivery) root.appendChild(delivery);
  if (list.children.length > 0) root.appendChild(list);
  root.appendChild(renderMarkdown(doc, report.markdown));
  return root;
}
