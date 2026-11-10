import { describe, expect, it } from "vitest";
import type { ServerMsg } from "@agentlife/shared";
import { escapeHtml, markdownToHtml, parseMarkdown } from "../src/ui/markdown.ts";
import { PanelState } from "../src/ui/panel-state.ts";

describe("markdown", () => {
  it("escapes raw HTML in text, headings, lists and code", () => {
    const src = "# <img src=x onerror=alert(1)>\n<script>alert(1)</script>\n- <b>x</b>\n```\n</pre><script>\n```";
    const html = markdownToHtml(src);
    expect(html).not.toMatch(/<script|<img|<b>|<\/pre><script/);
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img");
  });

  it("escapes inside bold and inline code", () => {
    expect(markdownToHtml("**<i>**")).toBe("<p><strong>&lt;i&gt;</strong></p>");
    expect(markdownToHtml("`<u>`")).toBe("<p><code>&lt;u&gt;</code></p>");
  });

  it("parses headings, lists and code fences", () => {
    const blocks = parseMarkdown("## T\n\n- a\n- b\n\n1. c\n\n```\nx\n```");
    expect(blocks.map((b) => b.kind)).toEqual(["heading", "list", "list", "code"]);
  });

  it("escapeHtml handles quotes and ampersands", () => {
    expect(escapeHtml(`&"'<>`)).toBe("&amp;&quot;&#39;&lt;&gt;");
  });
});

describe("PanelState", () => {
  const job = (taskId: string): ServerMsg => ({
    type: "job_update",
    job: { taskId, repoId: "r", goal: "g", state: "created", timeline: [] },
  });
  const approval = (status: "pending" | "approved"): ServerMsg => ({
    type: "approval",
    approval: { approvalId: "a1", taskId: "t1", kind: "plan", summary: "s", status },
  });

  it("opens and closes panels", () => {
    const s = new PanelState();
    s.apply({ type: "open_panel", panel: "mailbox" });
    expect(s.open).toBe("mailbox");
    s.close();
    expect(s.open).toBeNull();
  });

  it("upserts approvals by id", () => {
    const s = new PanelState();
    s.apply(approval("pending"));
    s.apply(approval("approved"));
    expect(s.data.approvals).toHaveLength(1);
    expect(s.data.approvals[0]?.status).toBe("approved");
  });

  it("clears approvals and reports when a new job starts", () => {
    const s = new PanelState();
    s.apply(job("t1"));
    s.apply(approval("pending"));
    s.apply(job("t2"));
    expect(s.data.approvals).toEqual([]);
  });

  it("records engine_unavailable and ignores other errors", () => {
    const s = new PanelState();
    expect(s.apply({ type: "error", code: "no_path", message: "x" })).toBe(false);
    expect(s.apply({ type: "error", code: "engine_unavailable", message: "down" })).toBe(true);
    expect(s.engineError).toBe("down");
    s.apply({ type: "open_panel", panel: "computer" });
    expect(s.engineError).toBeNull();
  });
});
