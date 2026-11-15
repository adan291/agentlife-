import type { BugComponent, BugContext, BugGroup, BugOpenCount, BugProcess, BugStatus, BugSummary } from "@agentlife/shared";
import type { PanelContent } from "./computer.ts";

/** What the Bug sack panel shows, from the client's state. */
export interface BugSackView {
  /** Every group (without samples) and the open counts, or null before the server answered. */
  list: { groups: readonly BugSummary[]; open: BugOpenCount } | null;
  /** The group the user opened, and its details (null until the answer arrives). */
  selected: string | null;
  detail: BugGroup | null;
  /** Screenshots already fetched: sample id to PNG in base64. */
  shots: Readonly<Record<string, string>>;
  /** Why the server refused something (the Bug sack may be off on this server). */
  error: string | null;
  /** What Copy for Kiro just did ("Copied 3 bugs for Kiro."). */
  notice: string | null;
  /** The text of a copy the browser refused, to select by hand. */
  fallbackText: string | null;
}

export interface BugSackActions {
  open(id: string): void;
  back(): void;
  setStatus(id: string, status: BugStatus): void;
  shot(sample: string): void;
  copy(what: { id: string } | { component: BugComponent }): void;
}

export type BugFilter = BugStatus;

const COMPONENT_LABEL: Record<BugComponent, string> = { game: "Game", code: "Code" };
const COMPONENT_HELP: Record<BugComponent, string> = {
  game: "What the browser and the scene caught.",
  code: "What the world-server, the agent engine, Docker, kiro-cli and the conductor caught.",
};
const FILTER_LABEL: Record<BugFilter, string> = { open: "Open", fixed: "Fixed", ignored: "Ignored" };
const STATUS_WORD: Record<BugStatus, string> = { open: "Open", fixed: "Fixed", ignored: "Ignored" };
const PROCESS_LABEL: Record<BugProcess, string> = {
  client: "browser",
  "world-server": "world-server",
  "agent-engine": "agent engine",
  conductor: "conductor",
  session: "session",
};

/** `YYYY-MM-DD HH:MM` in local time. */
export function bugTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Where it happened, in words: "floor project:x, panel board, task t1". Empty when nothing is known. */
export function whereText(last: BugContext): string {
  const names: [keyof BugContext, string][] = [["floor", "floor"], ["panel", "panel"], ["view", "view"], ["task", "task"], ["step", "step"], ["session", "session"], ["spec", "spec"]];
  return names.flatMap(([key, label]) => (last[key] ? [`${label} ${last[key]}`] : [])).join(", ");
}

/** The groups of one component, with one status, that match the search (case-insensitive, over what a row shows). */
export function filterBugs(groups: readonly BugSummary[], opts: { component: BugComponent; status: BugFilter; search: string }): BugSummary[] {
  const needle = opts.search.trim().toLowerCase();
  return groups.filter((g) => {
    if (g.component !== opts.component || g.status !== opts.status) return false;
    if (!needle) return true;
    return [g.message, g.kind, g.frame, PROCESS_LABEL[g.process], g.process, ...Object.values(g.last)].join("\n").toLowerCase().includes(needle);
  });
}

/** How many groups of a component have each status. */
export function statusCounts(groups: readonly BugSummary[], component: BugComponent): Record<BugStatus, number> {
  const out: Record<BugStatus, number> = { open: 0, fixed: 0, ignored: 0 };
  for (const g of groups) if (g.component === component) out[g.status] += 1;
  return out;
}

/** "x3" for a group seen three times. */
export function countText(n: number): string {
  return `x${n}`;
}

function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = doc.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function button(doc: Document, text: string, onClick: () => void, label?: string): HTMLButtonElement {
  const b = el(doc, "button", "al-btn", text);
  b.type = "button";
  if (label) b.setAttribute("aria-label", label);
  b.addEventListener("click", onClick);
  return b;
}

/**
 * The Bug sack panel (spec bug-sack): two tabs, Game and Code, the groups of each newest first, a details view with the
 * stack, the samples and the screenshot, and the actions on a group (Fixed, Ignored, Open again, Copy for Kiro). Every text
 * that came from a bug is put in with `textContent`, never as HTML. The tab, the filter and the search are kept here and
 * survive re-renders.
 */
export function createBugSackPanel(doc: Document, actions: BugSackActions) {
  let tab: BugComponent = "game";
  let filter: BugFilter = "open";
  let search = "";
  let searchFocused = false;

  function groupItem(g: BugSummary): HTMLElement {
    const li = el(doc, "li");
    const item = el(doc, "button", "al-bug-item");
    item.type = "button";
    item.dataset["bug"] = g.id;
    item.dataset["status"] = g.status;
    item.addEventListener("click", () => actions.open(g.id));
    const head = el(doc, "span", "al-bug-head");
    head.append(el(doc, "span", "al-badge", g.kind), el(doc, "span", "al-bug-count", countText(g.count)));
    if (g.status !== "open") head.appendChild(el(doc, "span", "al-badge al-bug-status", STATUS_WORD[g.status]));
    if (g.reopened > 0) head.appendChild(el(doc, "span", "al-muted", `came back ${g.reopened}x`));
    if (g.shots > 0) head.appendChild(el(doc, "span", "al-muted", "screenshot"));
    const message = el(doc, "span", "al-bug-message", g.message);
    const meta = el(doc, "span", "al-bug-meta al-muted");
    meta.append(
      el(doc, "span", undefined, "First "),
      el(doc, "span", "al-bug-time", bugTime(g.firstSeen)),
      el(doc, "span", undefined, " · Last "),
      el(doc, "span", "al-bug-time", bugTime(g.lastSeen)),
    );
    const where = [g.component === "code" ? PROCESS_LABEL[g.process] : "", whereText(g.last)].filter((s) => s !== "").join(" · ");
    item.append(head, message, meta);
    if (where) item.appendChild(el(doc, "span", "al-bug-where al-muted", where));
    li.appendChild(item);
    return li;
  }

  function emptyText(counts: Record<BugStatus, number>): string {
    if (search.trim() !== "") return "Nothing matches that search.";
    if (filter === "open") return counts.fixed + counts.ignored > 0 ? "No open bugs. The ones you fixed or ignored are under their filters." : `Nothing caught yet. The ${COMPONENT_LABEL[tab].toLowerCase()} side has been quiet.`;
    return filter === "fixed" ? "No bug is marked fixed." : "No bug is ignored.";
  }

  function listBody(view: BugSackView, rerender: () => void): HTMLElement {
    const root = el(doc, "div", "al-bugs");
    const list = view.list;
    if (!list) {
      root.appendChild(el(doc, "p", view.error ? "al-error" : "al-muted", view.error ?? "Reading the Bug sack…"));
      return root;
    }
    const tabs = el(doc, "div", "al-row al-wrap");
    tabs.setAttribute("role", "tablist");
    for (const c of ["game", "code"] as const) {
      const n = list.open[c];
      const b = el(doc, "button", "al-btn", n > 0 ? `${COMPONENT_LABEL[c]} (${n})` : COMPONENT_LABEL[c]);
      b.type = "button";
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", String(c === tab));
      b.dataset["tab"] = c;
      if (c === tab) b.disabled = true;
      b.addEventListener("click", () => {
        tab = c;
        rerender();
      });
      tabs.appendChild(b);
    }
    root.append(tabs, el(doc, "p", "al-muted", COMPONENT_HELP[tab]));

    const counts = statusCounts(list.groups, tab);
    const controls = el(doc, "div", "al-row al-wrap");
    for (const f of ["open", "fixed", "ignored"] as const) {
      const b = el(doc, "button", "al-btn", `${FILTER_LABEL[f]} (${counts[f]})`);
      b.type = "button";
      b.dataset["filter"] = f;
      b.setAttribute("aria-pressed", String(f === filter));
      if (f === filter) b.disabled = true;
      b.addEventListener("click", () => {
        filter = f;
        rerender();
      });
      controls.appendChild(b);
    }
    const box = el(doc, "input", "al-input al-bug-search");
    box.type = "search";
    box.placeholder = "Search";
    box.value = search;
    box.setAttribute("aria-label", "Search bugs");
    box.maxLength = 100;
    controls.appendChild(box);
    root.appendChild(controls);

    const items = el(doc, "ul", "al-bug-list");
    const fill = (): void => {
      const shown = filterBugs(list.groups, { component: tab, status: filter, search });
      items.replaceChildren(...shown.map(groupItem));
      if (shown.length === 0) items.appendChild(el(doc, "li", "al-muted", emptyText(counts)));
    };
    fill();
    box.addEventListener("input", () => {
      search = box.value;
      fill();
    });
    box.addEventListener("focus", () => {
      searchFocused = true;
    });
    box.addEventListener("blur", () => {
      searchFocused = false;
    });
    // A refresh that arrives while the user types must not take the cursor away.
    if (searchFocused) {
      queueMicrotask(() => {
        box.focus();
        box.setSelectionRange(box.value.length, box.value.length);
      });
    }
    root.appendChild(items);
    return root;
  }

  function sampleCard(g: BugGroup, s: BugGroup["samples"][number], view: BugSackView): HTMLElement {
    const card = el(doc, "div", "al-card al-bug-sample");
    card.dataset["sample"] = s.id;
    const head = el(doc, "div", "al-row al-wrap");
    head.append(el(doc, "span", "al-bug-time", bugTime(s.at)));
    const where = whereText(s.context);
    if (where) head.appendChild(el(doc, "span", "al-muted", where));
    card.appendChild(head);
    if (s.note) card.appendChild(el(doc, "p", "al-bug-note", `Note: ${s.note}`));
    if (s.message !== g.message) card.appendChild(el(doc, "p", "al-bug-sample-message", s.message));
    if (s.stack) {
      const pre = el(doc, "pre", "al-plain");
      pre.appendChild(el(doc, "code", undefined, s.stack));
      card.appendChild(pre);
    }
    if (s.shot) {
      const png = view.shots[s.id];
      if (png) {
        const img = el(doc, "img", "al-bug-shot");
        img.src = `data:image/png;base64,${png}`;
        img.alt = "Screenshot of the room when the bug was reported";
        card.appendChild(img);
      } else {
        const b = button(doc, "Show screenshot", () => actions.shot(s.id));
        b.dataset["shot"] = s.id;
        card.appendChild(b);
      }
    }
    return card;
  }

  function detailBody(view: BugSackView, g: BugGroup): HTMLElement {
    const root = el(doc, "div", "al-bugs");
    root.dataset["bugDetail"] = g.id;
    const bar = el(doc, "div", "al-row al-wrap");
    bar.appendChild(button(doc, "Back to the list", () => actions.back()));
    root.appendChild(bar);
    const title = el(doc, "h4", "al-bug-title");
    title.append(el(doc, "span", "al-badge", g.kind), doc.createTextNode(" "), doc.createTextNode(g.message));
    root.appendChild(title);

    const facts = el(doc, "dl", "al-facts");
    const fact = (k: string, v: string): void => {
      facts.append(el(doc, "dt", undefined, k), el(doc, "dd", undefined, v));
    };
    fact("Status", STATUS_WORD[g.status]);
    fact("From", `${COMPONENT_LABEL[g.component]}, ${PROCESS_LABEL[g.process]}`);
    fact("Seen", g.count === 1 ? "once" : `${g.count} times`);
    fact("First seen", bugTime(g.firstSeen));
    fact("Last seen", bugTime(g.lastSeen));
    const where = whereText(g.last);
    if (where) fact("Where", where);
    if (g.reopened > 0) fact("Came back", `${g.reopened} time${g.reopened === 1 ? "" : "s"} after it was marked fixed`);
    if (g.frame) fact("First frame", g.frame);
    root.appendChild(facts);

    const act = el(doc, "div", "al-row al-wrap");
    const mark = (text: string, status: BugStatus): void => {
      const b = button(doc, text, () => actions.setStatus(g.id, status));
      b.dataset["mark"] = status;
      act.appendChild(b);
    };
    if (g.status === "open") {
      mark("Mark fixed", "fixed");
      mark("Ignore", "ignored");
    } else {
      mark("Open again", "open");
      mark(g.status === "fixed" ? "Ignore" : "Mark fixed", g.status === "fixed" ? "ignored" : "fixed");
    }
    const copy = button(doc, "Copy for Kiro", () => actions.copy({ id: g.id }), "Copy this bug for Kiro");
    copy.dataset["copy"] = "one";
    act.appendChild(copy);
    root.appendChild(act);

    root.appendChild(el(doc, "h5", undefined, g.samples.length === 1 ? "The report" : `The last ${g.samples.length} reports`));
    for (const s of [...g.samples].reverse()) root.appendChild(sampleCard(g, s, view));
    return root;
  }

  function render(view: BugSackView, rerender: () => void): PanelContent {
    const frame = el(doc, "div", "al-bug-frame");
    if (view.notice) {
      const n = el(doc, "p", "al-bug-notice", view.notice);
      n.setAttribute("role", "status");
      frame.appendChild(n);
    }
    if (view.fallbackText !== null) {
      frame.appendChild(el(doc, "p", "al-muted", "The browser did not allow copying. Select the text below and copy it."));
      const area = el(doc, "textarea", "al-input al-bug-fallback");
      area.readOnly = true;
      area.rows = 8;
      area.value = view.fallbackText;
      area.setAttribute("aria-label", "Bugs as text for Kiro");
      frame.appendChild(area);
      queueMicrotask(() => {
        area.focus();
        area.select();
      });
    }
    if (view.error && view.list) frame.appendChild(el(doc, "p", "al-error", view.error));

    if (view.selected !== null) {
      if (view.detail && view.detail.id === view.selected) {
        frame.appendChild(detailBody(view, view.detail));
        return { body: frame };
      }
      const wait = el(doc, "div", "al-bugs");
      wait.append(button(doc, "Back to the list", () => actions.back()), el(doc, "p", view.error ? "al-error" : "al-muted", view.error ?? "Reading the bug…"));
      frame.appendChild(wait);
      return { body: frame };
    }

    frame.appendChild(listBody(view, rerender));
    const open = view.list?.open[tab] ?? 0;
    if (open === 0) return { body: frame };
    const foot = el(doc, "div", "al-row");
    const all = button(doc, `Copy all open ${COMPONENT_LABEL[tab].toLowerCase()} bugs for Kiro`, () => actions.copy({ component: tab }));
    all.dataset["copy"] = "all";
    foot.appendChild(all);
    return { body: frame, footer: foot };
  }

  return Object.assign(render, {
    /** Back to the first tab and the open filter, with no search: what the panel shows each time it is opened. */
    reset(): void {
      tab = "game";
      filter = "open";
      search = "";
      searchFocused = false;
    },
  });
}
