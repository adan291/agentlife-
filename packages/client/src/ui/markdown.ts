/**
 * Safe Markdown subset: headings, bullet/numbered lists, fenced code, paragraphs, **bold**, `code`.
 * Input is parsed to a small tree of plain text; the DOM renderer only uses createElement/textContent,
 * so raw HTML in the input is never interpreted.
 */

export type Inline = { kind: "text"; text: string } | { kind: "bold"; text: string } | { kind: "code"; text: string };

export type Block =
  | { kind: "heading"; level: number; inline: Inline[] }
  | { kind: "paragraph"; inline: Inline[] }
  | { kind: "list"; ordered: boolean; items: Inline[][] }
  | { kind: "code"; text: string; lang?: string };

/** How a line of a unified diff is coloured. */
export type DiffLineKind = "add" | "del" | "hunk" | "meta" | "ctx";

export function diffLineKind(line: string): DiffLineKind {
  if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff ") || line.startsWith("index ")) return "meta";
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "del";
  return "ctx";
}

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  const re = /\*\*([^*]+)\*\*|`([^`]+)`/g;
  let last = 0;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    if (m.index > last) out.push({ kind: "text", text: src.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ kind: "bold", text: m[1] });
    else out.push({ kind: "code", text: m[2] ?? "" });
    last = m.index + m[0].length;
  }
  if (last < src.length) out.push({ kind: "text", text: src.slice(last) });
  return out;
}

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: Inline[][] } | null = null;

  const flushPara = () => {
    if (para.length > 0) blocks.push({ kind: "paragraph", inline: parseInline(para.join(" ")) });
    para = [];
  };
  const flushList = () => {
    if (list) blocks.push({ kind: "list", ordered: list.ordered, items: list.items });
    list = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line.trimStart().startsWith("```")) {
      flushPara();
      flushList();
      const lang = line.trimStart().slice(3).trim().split(/\s+/)[0]?.toLowerCase() ?? "";
      const code: string[] = [];
      for (i++; i < lines.length && !(lines[i] ?? "").trimStart().startsWith("```"); i++) code.push(lines[i] ?? "");
      blocks.push(lang ? { kind: "code", text: code.join("\n"), lang } : { kind: "code", text: code.join("\n") });
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (heading) {
      flushPara();
      flushList();
      blocks.push({ kind: "heading", level: heading[1]!.length, inline: parseInline(heading[2] ?? "") });
    } else if (bullet || numbered) {
      flushPara();
      const ordered = !bullet;
      if (list && list.ordered !== ordered) flushList();
      list ??= { ordered, items: [] };
      list.items.push(parseInline((bullet ?? numbered)![1] ?? ""));
    } else if (line.trim() === "") {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushPara();
  flushList();
  return blocks;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const inlineHtml = (xs: Inline[]): string =>
  xs
    .map((x) => (x.kind === "bold" ? `<strong>${escapeHtml(x.text)}</strong>` : x.kind === "code" ? `<code>${escapeHtml(x.text)}</code>` : escapeHtml(x.text)))
    .join("");

/** HTML string form, with every text escaped. Used by tests; the UI uses `renderMarkdown`. */
export function markdownToHtml(src: string): string {
  return parseMarkdown(src)
    .map((b) => {
      switch (b.kind) {
        case "heading":
          return `<h${b.level}>${inlineHtml(b.inline)}</h${b.level}>`;
        case "paragraph":
          return `<p>${inlineHtml(b.inline)}</p>`;
        case "list": {
          const tag = b.ordered ? "ol" : "ul";
          return `<${tag}>${b.items.map((i) => `<li>${inlineHtml(i)}</li>`).join("")}</${tag}>`;
        }
        case "code":
          return `<pre><code>${escapeHtml(b.text)}</code></pre>`;
      }
    })
    .join("");
}

function appendInline(doc: Document, parent: HTMLElement, xs: Inline[]): void {
  for (const x of xs) {
    if (x.kind === "text") parent.appendChild(doc.createTextNode(x.text));
    else {
      const el = doc.createElement(x.kind === "bold" ? "strong" : "code");
      el.textContent = x.text;
      parent.appendChild(el);
    }
  }
}

/** Build DOM nodes for the Markdown. Never uses innerHTML. */
export function renderMarkdown(doc: Document, src: string): DocumentFragment {
  const frag = doc.createDocumentFragment();
  for (const b of parseMarkdown(src)) {
    if (b.kind === "heading") {
      const el = doc.createElement(`h${Math.min(6, b.level + 2)}`);
      appendInline(doc, el, b.inline);
      frag.appendChild(el);
    } else if (b.kind === "paragraph") {
      const el = doc.createElement("p");
      appendInline(doc, el, b.inline);
      frag.appendChild(el);
    } else if (b.kind === "list") {
      const el = doc.createElement(b.ordered ? "ol" : "ul");
      for (const item of b.items) {
        const li = doc.createElement("li");
        appendInline(doc, li, item);
        el.appendChild(li);
      }
      frag.appendChild(el);
    } else {
      const pre = doc.createElement("pre");
      const code = doc.createElement("code");
      if (b.lang === "diff") {
        pre.className = "al-diff";
        for (const line of b.text.split("\n")) {
          // One block element per line; text only, so the diff content is never interpreted as HTML.
          const row = doc.createElement("span");
          row.className = `al-diff-line al-diff-${diffLineKind(line)}`;
          row.textContent = line === "" ? " " : line;
          code.appendChild(row);
        }
      } else {
        code.textContent = b.text;
      }
      pre.appendChild(code);
      frag.appendChild(pre);
    }
  }
  return frag;
}
