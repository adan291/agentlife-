import { MEMORY_KINDS, MEMORY_KIND_LABELS, MEMORY_TEXT_MAX } from "@agentlife/shared";
import type { MemoryEntry, MemoryKind, MemoryProposal, MemoryState, Report } from "@agentlife/shared";
import { formatTime } from "./board.ts";
import type { PanelContent } from "./computer.ts";
import type { PanelData } from "./panel-state.ts";
import { createSelect } from "./select.ts";

/** What the Library panel and the report's "Remember this?" card can do. The server knows the project (the user's floor). */
export interface LibraryActions {
  edit(entryId: string, patch: { kind?: MemoryKind; text?: string }): void;
  remove(entryId: string): void;
  accept(proposalId: string, edit?: { kind?: MemoryKind; text?: string }): void;
  dismiss(proposalId: string): void;
  setAuto(on: boolean): void;
  /** Opens a report of the floor in the mailbox (the job an entry came from, while its report is still there). */
  openReport(reportId: string): void;
}

export interface LibraryView {
  memory: MemoryState | null;
  /** Why the last change was refused, or why the Library could not be read. */
  error: string | null;
  /** Recorded demo: the Library needs the real engine. */
  locked?: string;
}

export type KindFilter = MemoryKind | "all";

/** Entries that match the search words (all of them, anywhere in the text) and the kind. Order is kept. */
export function filterEntries(entries: readonly MemoryEntry[], query: string, kind: KindFilter): MemoryEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return entries.filter((e) => (kind === "all" || e.kind === kind) && words.every((w) => e.text.toLowerCase().includes(w)));
}

/** Entries grouped by kind in the fixed order of `MEMORY_KINDS`; kinds without entries are left out. */
export function groupByKind(entries: readonly MemoryEntry[]): { kind: MemoryKind; entries: MemoryEntry[] }[] {
  return MEMORY_KINDS.map((kind) => ({ kind, entries: entries.filter((e) => e.kind === kind) })).filter((g) => g.entries.length > 0);
}

/** "Job 1a2b3c4d" for `task-1a2b3c4d`. */
export function sourceLabel(taskId: string): string {
  return `Job ${taskId.replace(/^task-/, "")}`;
}

/** The first problem with a text typed by the user, in words, or undefined. The engine checks paths and secrets itself. */
export function textProblem(text: string): string | undefined {
  const t = text.replace(/\s+/g, " ").trim();
  if (t === "") return "Write something to remember.";
  if (t.length > MEMORY_TEXT_MAX) return `Keep it under ${MEMORY_TEXT_MAX} characters (now ${t.length}).`;
  return undefined;
}

function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = doc.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function button(doc: Document, label: string, onClick: () => void, title?: string): HTMLButtonElement {
  const b = el(doc, "button", "al-btn", label);
  b.type = "button";
  if (title) {
    b.title = title;
    b.setAttribute("aria-label", title);
  }
  b.addEventListener("click", onClick);
  return b;
}

function kindBadge(doc: Document, kind: MemoryKind): HTMLElement {
  const b = el(doc, "span", "al-badge al-mem-kind", MEMORY_KIND_LABELS[kind]);
  b.dataset["kind"] = kind;
  return b;
}

function autoToggle(doc: Document, on: boolean, actions: Pick<LibraryActions, "setAuto">): HTMLElement {
  const label = el(doc, "label", "al-night-check");
  const box = el(doc, "input");
  box.type = "checkbox";
  box.checked = on;
  box.dataset["action"] = "auto-remember";
  box.addEventListener("change", () => actions.setAuto(box.checked));
  label.append(box, el(doc, "span", undefined, "Remember lessons automatically in this project (you can still edit or delete them)"));
  return label;
}

/**
 * The "Remember this?" card of a report (requirement 2.2): what the librarian suggests from this job, with Remember and
 * Skip for each note, and the project's auto-remember switch. While the librarian is still reading the job it says so.
 * Nothing when the job has no suggestions and none are being written.
 */
export function renderRememberCard(
  doc: Document,
  taskId: string,
  memory: MemoryState | null,
  actions: Pick<LibraryActions, "accept" | "dismiss" | "setAuto">,
): HTMLElement | null {
  if (!memory) return null;
  const mine = memory.proposals.filter((p) => p.sourceTaskId === taskId);
  const reading = memory.learning.includes(taskId);
  if (mine.length === 0 && !reading) return null;
  const box = el(doc, "section", "al-card al-remember");
  box.dataset["remember"] = reading ? "reading" : "ready";
  box.appendChild(el(doc, "strong", undefined, "Remember this?"));
  if (mine.length === 0) {
    box.appendChild(el(doc, "p", "al-muted", "The librarian is reading this job to suggest what the team should remember…"));
    return box;
  }
  box.appendChild(el(doc, "p", "al-muted", "Notes the team could use on the next job. Nothing is kept unless you say so."));
  const list = el(doc, "ul", "al-mem-list");
  for (const p of mine) {
    const li = el(doc, "li", "al-mem-item");
    li.dataset["proposal"] = p.id;
    const row = el(doc, "div", "al-row al-wrap");
    row.append(kindBadge(doc, p.kind), el(doc, "span", "al-mem-text", p.text));
    const buttons = el(doc, "div", "al-row al-wrap");
    buttons.append(button(doc, "Remember", () => actions.accept(p.id)), button(doc, "Skip", () => actions.dismiss(p.id)));
    li.append(row, buttons);
    list.appendChild(li);
  }
  box.append(list, autoToggle(doc, memory.autoRemember, actions));
  return box;
}

/** One card of the panel: a stored entry or a proposal, in reading mode or editing mode. */
interface CardState {
  /** Ids being edited, with the draft. */
  drafts: Map<string, { kind: MemoryKind; text: string }>;
  /** Entries whose delete button was pressed once. */
  confirming: Set<string>;
}

/**
 * The Library panel (requirement 4.1), opened by the library shelf. Two tabs: the project's memory (proposals waiting for
 * a decision, a search box, a kind filter, entries grouped by kind with their source job, edit and delete) and the
 * "write docs" form the shelf had before. Search text, filter, tab and drafts survive a re-render.
 */
export function createLibraryPanel(
  doc: Document,
  actions: LibraryActions,
  docs: (data: PanelData, engineError: string | null) => PanelContent,
) {
  let tab: "memory" | "docs" = "memory";
  let query = "";
  let kindFilter: KindFilter = "all";
  const cards: CardState = { drafts: new Map(), confirming: new Set() };

  return function render(data: PanelData, view: LibraryView, engineError: string | null, rerender: () => void): PanelContent {
    const root = el(doc, "div");
    const tabs = el(doc, "div", "al-row al-wrap");
    tabs.setAttribute("role", "tablist");
    for (const [id, label] of [
      ["memory", "Memory"],
      ["docs", "Write docs"],
    ] as const) {
      const b = button(doc, label, () => {
        tab = id;
        rerender();
      });
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", String(tab === id));
      b.dataset["tab"] = id;
      b.disabled = tab === id;
      tabs.appendChild(b);
    }
    root.appendChild(tabs);

    if (tab === "docs") {
      const content = docs(data, engineError);
      root.appendChild(content.body);
      return content.footer ? { body: root, footer: content.footer } : { body: root };
    }

    if (view.locked) {
      root.appendChild(el(doc, "p", "al-muted", view.locked));
      return { body: root };
    }
    root.appendChild(
      el(doc, "p", "al-muted", "What the team of this project learned from earlier jobs. Every new job starts with the most relevant notes. You can edit or delete any of them."),
    );
    if (view.error) {
      const err = el(doc, "p", "al-error", view.error);
      err.setAttribute("role", "alert");
      root.appendChild(err);
    }
    const memory = view.memory;
    if (!memory) {
      if (!view.error) root.appendChild(el(doc, "p", "al-muted", "Opening the Library…"));
      return { body: root };
    }

    const reportOf = (taskId: string): Report | undefined => data.reports.find((r) => r.taskId === taskId);
    const meta = (item: MemoryEntry | MemoryProposal): HTMLElement => {
      const line = el(doc, "div", "al-row al-wrap al-muted");
      line.append(`${sourceLabel(item.sourceTaskId)} · ${new Date(item.createdAt).toLocaleDateString()} ${formatTime(item.createdAt)}`);
      const report = reportOf(item.sourceTaskId);
      if (report) line.appendChild(button(doc, "Open its report", () => actions.openReport(report.reportId)));
      return line;
    };

    /** The editor for a card: kind, text and Save / Cancel. `save` gets the checked values. */
    const editor = (id: string, saveLabel: string, save: (draft: { kind: MemoryKind; text: string }) => void): HTMLElement => {
      const draft = cards.drafts.get(id)!;
      const form = el(doc, "div");
      const kindLabel = el(doc, "div", "al-field");
      kindLabel.append("Kind");
      kindLabel.appendChild(
        createSelect(doc, {
          label: "Kind",
          value: draft.kind,
          options: MEMORY_KINDS.map((k) => ({ value: k, label: MEMORY_KIND_LABELS[k] })),
          onChange: (v) => {
            draft.kind = v as MemoryKind;
          },
        }),
      );
      const area = el(doc, "textarea", "al-input");
      area.rows = 3;
      area.maxLength = MEMORY_TEXT_MAX + 100;
      area.value = draft.text;
      area.setAttribute("aria-label", "Note");
      const problem = el(doc, "p", "al-error");
      problem.setAttribute("role", "alert");
      area.addEventListener("input", () => {
        draft.text = area.value;
        problem.textContent = "";
      });
      const row = el(doc, "div", "al-row al-wrap");
      row.append(
        button(doc, saveLabel, () => {
          const why = textProblem(draft.text);
          if (why) {
            problem.textContent = why;
            area.focus();
            return;
          }
          save({ kind: draft.kind, text: draft.text.replace(/\s+/g, " ").trim() });
          cards.drafts.delete(id);
        }),
        button(doc, "Cancel", () => {
          cards.drafts.delete(id);
          rerender();
        }),
      );
      form.append(kindLabel, area, problem, row);
      return form;
    };

    const startEdit = (item: MemoryEntry | MemoryProposal) => {
      cards.drafts.set(item.id, { kind: item.kind, text: item.text });
      rerender();
    };

    // ---- proposals waiting for a decision ----
    if (memory.proposals.length > 0) {
      root.appendChild(el(doc, "h4", undefined, `Waiting for your decision (${memory.proposals.length})`));
      const list = el(doc, "ul", "al-mem-list");
      for (const p of memory.proposals) {
        const li = el(doc, "li", "al-card al-mem-item");
        li.dataset["proposal"] = p.id;
        if (cards.drafts.has(p.id)) {
          li.appendChild(editor(p.id, "Remember", (d) => actions.accept(p.id, d)));
        } else {
          const row = el(doc, "div", "al-row al-wrap");
          row.append(kindBadge(doc, p.kind), el(doc, "span", "al-mem-text", p.text));
          const buttons = el(doc, "div", "al-row al-wrap");
          buttons.append(
            button(doc, "Remember", () => actions.accept(p.id)),
            button(doc, "Edit first", () => startEdit(p)),
            button(doc, "Skip", () => actions.dismiss(p.id)),
          );
          li.append(row, meta(p), buttons);
        }
        list.appendChild(li);
      }
      root.appendChild(list);
    }
    if (memory.learning.length > 0) root.appendChild(el(doc, "p", "al-muted", "The librarian is reading a finished job…"));
    root.appendChild(autoToggle(doc, memory.autoRemember, actions));

    // ---- the entries ----
    root.appendChild(el(doc, "h4", undefined, `Remembered (${memory.entries.length})`));
    const filters = el(doc, "div", "al-row al-wrap");
    const search = el(doc, "input", "al-input");
    search.type = "search";
    search.placeholder = "Search the notes";
    search.setAttribute("aria-label", "Search the notes");
    search.value = query;
    const kindPick = createSelect(doc, {
      label: "Kind",
      value: kindFilter,
      options: [{ value: "all", label: "All kinds" }, ...MEMORY_KINDS.map((k) => ({ value: k, label: MEMORY_KIND_LABELS[k] }))],
      onChange: (v) => {
        kindFilter = v as KindFilter;
        fill();
      },
    });
    filters.append(search, kindPick);
    root.appendChild(filters);
    const results = el(doc, "div", "al-mem-results");
    root.appendChild(results);

    /** Re-draws only the list, so typing in the search box keeps its focus. */
    function fill(): void {
      const shown = filterEntries(memory!.entries, query, kindFilter);
      results.replaceChildren();
      if (memory!.entries.length === 0) {
        results.appendChild(el(doc, "p", "al-muted", "Nothing remembered yet. After a job, the librarian suggests notes in its report."));
        return;
      }
      if (shown.length === 0) {
        results.appendChild(el(doc, "p", "al-muted", "No note matches."));
        return;
      }
      for (const group of groupByKind(shown)) {
        results.appendChild(el(doc, "h5", undefined, `${MEMORY_KIND_LABELS[group.kind]} (${group.entries.length})`));
        const list = el(doc, "ul", "al-mem-list");
        for (const e of group.entries) {
          const li = el(doc, "li", "al-card al-mem-item");
          li.dataset["entry"] = e.id;
          if (cards.drafts.has(e.id)) {
            li.appendChild(editor(e.id, "Save", (d) => actions.edit(e.id, d)));
          } else {
            const row = el(doc, "div", "al-row al-wrap");
            row.append(kindBadge(doc, e.kind), el(doc, "span", "al-mem-text", e.text));
            const buttons = el(doc, "div", "al-row al-wrap");
            buttons.appendChild(button(doc, "Edit", () => startEdit(e)));
            if (cards.confirming.has(e.id)) {
              buttons.append(
                button(doc, "Really delete", () => {
                  cards.confirming.delete(e.id);
                  actions.remove(e.id);
                }),
                button(doc, "Keep", () => {
                  cards.confirming.delete(e.id);
                  rerender();
                }),
              );
            } else {
              buttons.appendChild(
                button(doc, "Delete", () => {
                  cards.confirming.add(e.id);
                  rerender();
                }),
              );
            }
            li.append(row, meta(e), buttons);
          }
          list.appendChild(li);
        }
        results.appendChild(list);
      }
    }
    search.addEventListener("input", () => {
      query = search.value;
      fill();
    });
    fill();
    return { body: root };
  };
}
