import {
  PIPELINE_STEP_KINDS,
  PIPELINE_STEP_LABELS,
  PIPELINE_STEP_ROLES,
  validatePipeline,
  type PipelineCheck,
  type PipelineMemberView,
  type PipelineResponse,
  type PipelineStep,
  type PipelineStepKind,
} from "@agentlife/shared";
import { createSelect } from "./select.ts";

/**
 * The pipeline editor of the board panel (pipeline-editor, requirement 2): the steps of a project's jobs as a row of cards
 * that can be added, removed and reordered (drag and drop, or the arrow buttons). The fixed rules run on every change with
 * the same function the engine uses; a step that breaks one turns red and says which, and Save stays off until none does.
 */

export interface PipelineEditorActions {
  save(steps: PipelineStep[]): void;
  reset(): void;
}

export interface PipelineView {
  state: PipelineResponse | null;
  /** Why the pipeline could not be read or saved. */
  error: string | null;
  /** Recorded demo: the editor needs the real engine. */
  locked?: string;
}

/** Who does a step when it names nobody, or why nobody does. */
const DOER: Partial<Record<PipelineStepKind, string>> = {
  approve: "You decide",
  test: "The engine, in Docker",
  report: "The engine",
};

export const PIPELINE_NOTE = "Changes apply to the next job. A job that is running keeps the pipeline it started with.";

// ---- pure helpers ----

/** A copy of `steps` with the one at `from` moved to `to` (both are clamped into the list). */
export function moveStep(steps: readonly PipelineStep[], from: number, to: number): PipelineStep[] {
  const list = steps.map((s) => ({ ...s }));
  if (from < 0 || from >= list.length) return list;
  const target = Math.max(0, Math.min(list.length - 1, to));
  const [item] = list.splice(from, 1);
  if (item) list.splice(target, 0, item);
  return list;
}

/** Kinds that are not in the pipeline yet, in the usual order: the steps the user can add. */
export function addableKinds(steps: readonly PipelineStep[]): PipelineStepKind[] {
  const present = new Set(steps.map((s) => s.kind));
  return PIPELINE_STEP_KINDS.filter((k) => !present.has(k));
}

/**
 * Where a new step goes: after the last step that comes before it in the usual order (`PIPELINE_STEP_KINDS`), so that
 * adding a step does not break a rule the user did not touch.
 */
export function insertIndexFor(steps: readonly PipelineStep[], kind: PipelineStepKind): number {
  const rank = (k: PipelineStepKind): number => PIPELINE_STEP_KINDS.indexOf(k);
  let at = 0;
  steps.forEach((s, i) => {
    if (rank(s.kind) < rank(kind)) at = i + 1;
  });
  return at;
}

export function addStep(steps: readonly PipelineStep[], kind: PipelineStepKind): PipelineStep[] {
  const list = steps.map((s) => ({ ...s }));
  list.splice(insertIndexFor(steps, kind), 0, { kind });
  return list;
}

export function removeStep(steps: readonly PipelineStep[], index: number): PipelineStep[] {
  return steps.filter((_, i) => i !== index).map((s) => ({ ...s }));
}

/** A copy with the member of one step set (`undefined` goes back to the default member). */
export function setMember(steps: readonly PipelineStep[], index: number, memberId: string | undefined): PipelineStep[] {
  return steps.map((s, i) => {
    if (i !== index) return { ...s };
    return memberId ? { kind: s.kind, memberId } : { kind: s.kind };
  });
}

/** Index of the card nearest to a pointer, for the drop. Empty list: 0. */
export function dropIndex(centres: readonly { x: number; y: number }[], point: { x: number; y: number }): number {
  let best = 0;
  let bestDist = Number.POSITIVE_INFINITY;
  centres.forEach((c, i) => {
    const d = (c.x - point.x) ** 2 + (c.y - point.y) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  });
  return best;
}

export function sameSteps(a: readonly PipelineStep[], b: readonly PipelineStep[]): boolean {
  return a.length === b.length && a.every((s, i) => s.kind === b[i]?.kind && (s.memberId ?? "") === (b[i]?.memberId ?? ""));
}

/** The rule texts of each step; the key `null` holds those of the pipeline as a whole. */
export function errorsByStep(check: PipelineCheck): Map<number | null, string[]> {
  const out = new Map<number | null, string[]>();
  if (check.ok) return out;
  for (const e of check.errors) out.set(e.index, [...(out.get(e.index) ?? []), e.rule]);
  return out;
}

/** The member who does the step: the one it names, else the first of its usual role. Undefined for steps no member does. */
export function memberOfStep(step: PipelineStep, members: readonly PipelineMemberView[]): PipelineMemberView | undefined {
  if (step.memberId) return members.find((m) => m.id === step.memberId);
  const role = PIPELINE_STEP_ROLES[step.kind][0];
  return role ? members.find((m) => m.role === role) : undefined;
}

/** The choices of the member menu of a step: the default, then every member whose role the step accepts. */
export function memberChoices(step: PipelineStep, members: readonly PipelineMemberView[]): { value: string; label: string }[] {
  const roles = PIPELINE_STEP_ROLES[step.kind];
  const def = memberOfStep({ kind: step.kind }, members);
  return [
    { value: "", label: def ? `Default: ${def.displayName}` : "Default: nobody on the team yet" },
    ...members.filter((m) => roles.includes(m.role)).map((m) => ({ value: m.id, label: `${m.displayName} (${m.role})` })),
  ];
}

// ---- DOM ----

function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = doc.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function button(doc: Document, label: string, onClick: () => void, aria?: string): HTMLButtonElement {
  const b = el(doc, "button", "al-btn", label);
  b.type = "button";
  if (aria) {
    b.title = aria;
    b.setAttribute("aria-label", aria);
  }
  b.addEventListener("click", onClick);
  return b;
}

/**
 * Builds the editor. The draft the user is working on lives in the closure, so a refresh of the board (a job moves on)
 * does not lose it; it is replaced when the engine sends a pipeline that differs from the one the draft started from.
 */
export function createPipelineEditor(doc: Document, actions: PipelineEditorActions): (view: PipelineView, rerender: () => void) => HTMLElement {
  let draft: PipelineStep[] = [];
  let baseKey = "";

  return (view, rerender) => {
    const root = el(doc, "section", "al-pipe");
    root.dataset["pipeline"] = "editor";
    root.appendChild(el(doc, "h4", undefined, "Pipeline"));
    if (view.locked) {
      root.appendChild(el(doc, "p", "al-muted", view.locked));
      return root;
    }
    const state = view.state;
    if (!state) {
      root.appendChild(el(doc, "p", view.error ? "al-error" : "al-muted", view.error ?? "Loading the pipeline…"));
      return root;
    }
    const key = `${state.projectId}|${JSON.stringify(state.steps)}`;
    if (key !== baseKey) {
      baseKey = key;
      draft = state.steps.map((s) => ({ ...s }));
    }
    const members = state.members;
    const check = validatePipeline(draft, members);
    const errors = errorsByStep(check);
    const changed = !sameSteps(draft, state.steps);

    root.appendChild(el(doc, "p", "al-muted", PIPELINE_NOTE));
    const general = errors.get(null) ?? [];
    if (general.length > 0) {
      const ul = el(doc, "ul", "al-error al-pipe-errors");
      for (const g of general) ul.appendChild(el(doc, "li", undefined, g));
      root.appendChild(ul);
    }
    if (view.error) root.appendChild(el(doc, "p", "al-error", view.error));

    const row = el(doc, "ol", "al-pipe-row");
    row.setAttribute("aria-label", "Steps of the pipeline, in order");
    draft.forEach((step, i) => row.appendChild(card(doc, step, i)));
    root.appendChild(row);

    function card(d: Document, step: PipelineStep, i: number): HTMLElement {
      const li = el(d, "li", "al-pipe-card");
      li.dataset["kind"] = step.kind;
      li.dataset["index"] = String(i);
      const problems = errors.get(i) ?? [];
      li.dataset["invalid"] = String(problems.length > 0);

      const head = el(d, "div", "al-pipe-head");
      const grip = el(d, "button", "al-btn al-pipe-grip", "⠿");
      grip.type = "button";
      grip.title = `Drag ${PIPELINE_STEP_LABELS[step.kind]} to move it`;
      grip.setAttribute("aria-label", `Drag ${PIPELINE_STEP_LABELS[step.kind]} to move it`);
      grip.addEventListener("pointerdown", (ev) => startDrag(ev as PointerEvent, li, i));
      head.append(grip, el(d, "strong", "al-pipe-name", `${i + 1}. ${PIPELINE_STEP_LABELS[step.kind]}`));
      li.appendChild(head);

      const doer = DOER[step.kind];
      if (doer) {
        li.appendChild(el(d, "p", "al-muted al-pipe-who", doer));
      } else {
        const who = memberOfStep(step, members);
        li.appendChild(
          createSelect(d, {
            options: memberChoices(step, members),
            value: step.memberId ?? "",
            label: `Who does ${PIPELINE_STEP_LABELS[step.kind]}`,
            onChange: (v) => {
              draft = setMember(draft, i, v || undefined);
              rerender();
            },
          }),
        );
        li.appendChild(el(d, "p", "al-muted al-pipe-model", who ? `Model: ${who.model}` : "No one has this role yet"));
      }

      const buttons = el(d, "div", "al-row al-wrap");
      const earlier = button(d, "←", () => move(i, i - 1), `Move ${PIPELINE_STEP_LABELS[step.kind]} earlier`);
      earlier.disabled = i === 0;
      const later = button(d, "→", () => move(i, i + 1), `Move ${PIPELINE_STEP_LABELS[step.kind]} later`);
      later.disabled = i === draft.length - 1;
      buttons.append(earlier, later, button(d, "Remove", () => {
        draft = removeStep(draft, i);
        rerender();
      }, `Remove ${PIPELINE_STEP_LABELS[step.kind]}`));
      li.appendChild(buttons);

      for (const p of problems) li.appendChild(el(d, "p", "al-error al-pipe-problem", p));
      return li;
    }

    function move(from: number, to: number): void {
      draft = moveStep(draft, from, to);
      rerender();
    }

    /** Drag with the pointer: the card nearest to the pointer is the drop place. */
    function startDrag(ev: PointerEvent, source: HTMLElement, from: number): void {
      ev.preventDefault();
      const cards = Array.from(row.children) as HTMLElement[];
      const centres = cards.map((c) => {
        const r = c.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      });
      const grip = ev.currentTarget as HTMLElement;
      grip.setPointerCapture?.(ev.pointerId);
      source.dataset["dragging"] = "true";
      let target = from;
      const mark = (): void => cards.forEach((c, n) => (c.dataset["drop"] = String(n === target && n !== from)));
      const onMove = (e: PointerEvent): void => {
        target = dropIndex(centres, { x: e.clientX, y: e.clientY });
        mark();
      };
      const finish = (apply: boolean): void => {
        grip.removeEventListener("pointermove", onMove as EventListener);
        grip.removeEventListener("pointerup", onUp as EventListener);
        grip.removeEventListener("pointercancel", onCancel);
        grip.releasePointerCapture?.(ev.pointerId);
        delete source.dataset["dragging"];
        cards.forEach((c) => delete c.dataset["drop"]);
        if (apply && target !== from) move(from, target);
      };
      const onUp = (): void => finish(true);
      const onCancel = (): void => finish(false);
      grip.addEventListener("pointermove", onMove as EventListener);
      grip.addEventListener("pointerup", onUp as EventListener);
      grip.addEventListener("pointercancel", onCancel);
    }

    const add = addableKinds(draft);
    if (add.length > 0) {
      const addRow = el(doc, "div", "al-row al-wrap al-pipe-add");
      addRow.appendChild(el(doc, "span", "al-muted", "Add a step:"));
      for (const kind of add) {
        const b = button(doc, `+ ${PIPELINE_STEP_LABELS[kind]}`, () => {
          draft = addStep(draft, kind);
          rerender();
        }, `Add ${PIPELINE_STEP_LABELS[kind]}`);
        b.dataset["add"] = kind;
        addRow.appendChild(b);
      }
      root.appendChild(addRow);
    }

    const foot = el(doc, "div", "al-row al-wrap al-pipe-foot");
    const save = button(doc, "Save pipeline", () => actions.save(draft.map((s) => ({ ...s }))));
    save.dataset["action"] = "save-pipeline";
    save.disabled = !check.ok || !changed;
    if (!check.ok) save.title = "Fix the red steps first";
    foot.appendChild(save);
    if (changed) {
      const discard = button(doc, "Discard changes", () => {
        draft = state.steps.map((s) => ({ ...s }));
        rerender();
      });
      discard.dataset["action"] = "discard-pipeline";
      foot.appendChild(discard);
    }
    if (state.customised) {
      const reset = button(doc, "Back to the default", () => actions.reset());
      reset.dataset["action"] = "reset-pipeline";
      foot.appendChild(reset);
    }
    root.appendChild(foot);
    return root;
  };
}
