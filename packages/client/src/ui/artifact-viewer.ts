import { PlanSchema, ReviewSchema, type ArtifactView, type Plan, type Review } from "@agentlife/shared";
import { renderDiffBlock, renderMarkdown } from "./markdown.ts";

/** Removes terminal colour codes (test logs from Vitest carry them). */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "");
}

/** The plan in an artifact, or undefined when the content is not a valid plan. */
export function parsePlan(content: string): Plan | undefined {
  try {
    const r = PlanSchema.safeParse(JSON.parse(content));
    return r.success ? r.data : undefined;
  } catch {
    return undefined;
  }
}

export function parseReview(content: string): Review | undefined {
  try {
    const r = ReviewSchema.safeParse(JSON.parse(content));
    return r.success ? r.data : undefined;
  } catch {
    return undefined;
  }
}

function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
  const e = doc.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (className) e.className = className;
  return e;
}

function plainBlock(doc: Document, text: string): HTMLElement {
  const pre = el(doc, "pre", undefined, "al-plain");
  pre.appendChild(el(doc, "code", text));
  return pre;
}

function renderPlan(doc: Document, plan: Plan): HTMLElement {
  const root = el(doc, "div");
  plan.tasks.forEach((t, i) => {
    const card = el(doc, "section", undefined, "al-card");
    card.appendChild(el(doc, "strong", `${i + 1}. ${t.title}`));
    const facts = el(doc, "ul");
    for (const line of [`Why: ${t.why}`, `Files: ${t.files.join(", ") || "none"}`, `Acceptance: ${t.acceptance}`, `Risk: ${t.risk}`]) {
      facts.appendChild(el(doc, "li", line));
    }
    card.appendChild(facts);
    root.appendChild(card);
  });
  root.appendChild(el(doc, "p", "Approving the plan builds task 1.", "al-muted"));
  return root;
}

function renderReview(doc: Document, review: Review): HTMLElement {
  const root = el(doc, "div");
  root.appendChild(el(doc, "p", `Verdict: ${review.verdict.toUpperCase()}   Risk: ${review.risk}`));
  if (review.notes.length > 0) {
    const ul = el(doc, "ul");
    for (const n of review.notes) ul.appendChild(el(doc, "li", n));
    root.appendChild(ul);
  }
  return root;
}

/**
 * A readable view of one artifact by kind: plan and review as lists, the patch with green and red lines, the
 * test log as plain text, the report as Markdown. Content is always set as text, never as HTML.
 */
export function renderArtifact(doc: Document, artifact: ArtifactView): HTMLElement {
  const root = el(doc, "div", undefined, "al-artifact");
  root.dataset["kind"] = artifact.kind;
  switch (artifact.kind) {
    case "plan": {
      const plan = parsePlan(artifact.content);
      root.appendChild(plan ? renderPlan(doc, plan) : plainBlock(doc, artifact.content));
      break;
    }
    case "review": {
      const review = parseReview(artifact.content);
      root.appendChild(review ? renderReview(doc, review) : plainBlock(doc, artifact.content));
      break;
    }
    case "diff":
      root.appendChild(artifact.content.trim() === "" ? el(doc, "p", "The patch is empty.", "al-muted") : renderDiffBlock(doc, artifact.content));
      break;
    case "test_log":
      root.appendChild(plainBlock(doc, stripAnsi(artifact.content)));
      break;
    case "report":
      root.appendChild(renderMarkdown(doc, artifact.content));
      break;
    default:
      root.appendChild(plainBlock(doc, artifact.content));
  }
  if (artifact.truncated) root.appendChild(el(doc, "p", "Shown in part: the document is longer than the viewer limit.", "al-muted"));
  return root;
}
