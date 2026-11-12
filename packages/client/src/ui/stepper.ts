import { ROLE_INFO } from "@agentlife/shared";
import type { AgentId, JobKind, JobState, JobView } from "@agentlife/shared";
import { ROLE_COLOURS } from "../palette.ts";
import { formatDuration } from "./duration.ts";
import { UI_COLOURS, cssHex } from "./theme.ts";

export type StepKey = "plan" | "approve" | "build" | "test" | "review" | "report";
/** `done` shows a check, `failed` is red (also for a rejected or cancelled job). */
export type StepStatus = "pending" | "current" | "done" | "failed";

export interface StepperStep {
  key: StepKey;
  /** Plain label ("Approve"); the "Your turn" wording is `stepLabel`. */
  label: string;
  status: StepStatus;
  /** Agent responsible for the step; its colour highlights the current step. */
  agentId: AgentId;
  /** Time spent in the step, once it is done. */
  durationMs?: number;
  /** The Approve step while the plan waits for the user: clickable, opens the mailbox. */
  yourTurn: boolean;
  /** Why a step is red ("Plan rejected", "Cancelled", "Failed"). */
  note?: string;
}

type StepDef = { key: StepKey; label: string; agentId: AgentId; states: readonly JobState[] };

const STEPS: readonly StepDef[] = [
  { key: "plan", label: "Plan", agentId: "architect", states: ["created", "analyzing"] },
  { key: "approve", label: "Approve", agentId: "architect", states: ["awaiting_plan_approval"] },
  { key: "build", label: "Build", agentId: "developer", states: ["developing"] },
  { key: "test", label: "Test", agentId: "qa", states: ["testing"] },
  { key: "review", label: "Review", agentId: "qa", states: ["reviewing"] },
  { key: "report", label: "Report", agentId: "architect", states: ["report_ready"] },
];

/** The steps of each kind of job, in order: they follow the pipeline the engine runs (job-types spec). */
const KIND_STEPS: Record<JobKind, readonly StepKey[]> = {
  change: ["plan", "approve", "build", "test", "review", "report"],
  "write-tests": ["plan", "approve", "build", "test", "review", "report"],
  document: ["plan", "approve", "build", "review", "report"],
  "review-branch": ["review", "test", "report"],
};

/** A kind that calls a step something else. */
const KIND_LABELS: Partial<Record<JobKind, Partial<Record<StepKey, string>>>> = {
  document: { plan: "Research" },
};

/** The steps of a job of this kind (an absent kind is a change). */
export function stepsFor(kind: JobKind | undefined): readonly StepDef[] {
  const k = kind ?? "change";
  return KIND_STEPS[k].map((key) => {
    const def = STEPS.find((s) => s.key === key)!;
    const label = KIND_LABELS[k]?.[key];
    return label ? { ...def, label } : def;
  });
}

/** Index of the step a job state belongs to, or -1 for states that end the job. */
function stepIndexOf(steps: readonly StepDef[], state: JobState): number {
  return steps.findIndex((s) => s.states.includes(state));
}

/** Step the job was in right before it entered `endState` (failed, cancelled); 0 when unknown. */
function stepBefore(steps: readonly StepDef[], timeline: JobView["timeline"], endState: JobState): number {
  const at = timeline.findIndex((e) => e.state === endState);
  for (let i = at - 1; i >= 0; i--) {
    const idx = stepIndexOf(steps, timeline[i]!.state);
    if (idx >= 0) return idx;
  }
  return 0;
}

/** Time spent in each step: the gaps between a state entry and the next entry, summed over retries. */
function durations(steps: readonly StepDef[], timeline: JobView["timeline"]): (number | undefined)[] {
  const out: (number | undefined)[] = steps.map(() => undefined);
  for (let i = 0; i + 1 < timeline.length; i++) {
    const idx = stepIndexOf(steps, timeline[i]!.state);
    if (idx < 0) continue;
    const span = Math.max(0, timeline[i + 1]!.ts - timeline[i]!.ts);
    out[idx] = (out[idx] ?? 0) + span;
  }
  return out;
}

/**
 * Maps a job to the steps of its kind: Plan, Approve, Build, Test, Review, Report for a change. Empty when there is no job.
 * A job whose timeline has `failed` ends with a failure report (the engine goes failed -> report_ready -> delivered),
 * so the failure is read from the timeline, not from the final state.
 */
export function stepperFor(job: JobView | null): StepperStep[] {
  if (!job) return [];
  const steps = stepsFor(job.kind);
  const timeline = job.timeline;
  const spans = durations(steps, timeline);
  const failedAtTimeline = timeline.some((e) => e.state === "failed");

  let failedAt = -1;
  let note: string | undefined;
  let current = -1;
  if (failedAtTimeline || job.state === "failed") {
    failedAt = stepBefore(steps, timeline, "failed");
    note = "Failed";
  } else if (job.state === "cancelled") {
    failedAt = stepBefore(steps, timeline, "cancelled");
    const text = timeline.find((e) => e.state === "cancelled")?.text;
    note = text && /reject/i.test(text) ? "Plan rejected" : "Cancelled";
  } else if (job.state !== "delivered") {
    current = Math.max(0, stepIndexOf(steps, job.state));
  }

  return steps.map((s, i): StepperStep => {
    let status: StepStatus;
    if (failedAt >= 0) status = i < failedAt ? "done" : i === failedAt ? "failed" : "pending";
    else if (current >= 0) status = i < current ? "done" : i === current ? "current" : "pending";
    else status = "done";
    const duration = status === "done" ? spans[i] : undefined;
    return {
      key: s.key,
      label: s.label,
      status,
      agentId: s.agentId,
      ...(duration === undefined ? {} : { durationMs: duration }),
      yourTurn: s.key === "approve" && status === "current",
      ...(status === "failed" && note ? { note } : {}),
    };
  });
}

/** Text of a step: "Your turn" for the Approve step that waits for the user, with the duration of a finished step. */
export function stepLabel(step: StepperStep): string {
  const name = step.yourTurn ? "Your turn" : step.label;
  if (step.status === "done") return `✓ ${name}${step.durationMs === undefined ? "" : ` ${formatDuration(step.durationMs)}`}`;
  if (step.status === "failed") return `✗ ${name}${step.note ? ` (${step.note})` : ""}`;
  return name;
}

/**
 * Compact form for narrow windows: only the step that matters now and "n/6". The current step, or the failed one;
 * "Done" once every step is finished. `yourTurn` turns it into the button that opens the mailbox.
 */
export function compactStep(steps: readonly StepperStep[]): { text: string; yourTurn: boolean; status: StepStatus } | null {
  if (steps.length === 0) return null;
  const at = steps.findIndex((s) => s.status === "current" || s.status === "failed");
  if (at < 0) return { text: `Done ${steps.length}/${steps.length}`, yourTurn: false, status: "done" };
  const step = steps[at]!;
  const name = step.yourTurn ? "Your turn" : step.label;
  const text = step.status === "failed" ? `✗ ${name}${step.note ? ` (${step.note})` : ""}` : name;
  return { text: `${text} ${at + 1}/${steps.length}`, yourTurn: step.yourTurn, status: step.status };
}

/** Widest the stepper gets, in px. */
export const STEPPER_MAX_PX = 760;
/** Characters one step needs with its label: the icon, a space and the longest label ("Your turn"). */
export const STEP_LABEL_CHARS = 11;
/** Width of a monospace character in em. */
const CHAR_EM = 0.62;
/** Padding, border and gap around one step, in px. */
const STEP_CHROME_PX = 14;

/**
 * True when the steps fit with their labels in `widthPx`; below that the labels give way to icons (the full text
 * stays in each step's tooltip and accessible name). Pure, so the threshold can be tested.
 */
export function stepperFitsLabels(widthPx: number, fontPx: number, steps = 6): boolean {
  return widthPx >= steps * (STEP_LABEL_CHARS * CHAR_EM * fontPx + STEP_CHROME_PX);
}

/** The icon of a step: a shape for each status, so the state does not depend on colour alone. */
export function stepIcon(status: StepStatus): string {
  return status === "done" ? "✓" : status === "failed" ? "✗" : status === "current" ? "●" : "○";
}

/** Name of the step as shown: "Your turn" for the Approve step that waits for the user. */
export function stepName(step: StepperStep): string {
  return step.yourTurn ? "Your turn" : step.label;
}

/** Second line under the label: how long a finished step took, or why a step is red. */
export function stepNote(step: StepperStep): string {
  if (step.status === "done") return step.durationMs === undefined ? "" : formatDuration(step.durationMs);
  if (step.status === "failed") return step.note ?? "";
  return "";
}

/** Tooltip and accessible name of a step: all the information, also when only the icon shows. */
export function stepTitle(step: StepperStep): string {
  const who = ROLE_INFO[step.agentId].name;
  const name = step.label;
  switch (step.status) {
    case "done":
      return `${name} (${who}): done${step.durationMs === undefined ? "" : ` in ${formatDuration(step.durationMs)}`}. Click to open the job card.`;
    case "failed":
      return `${name} (${who}): failed${step.note ? `, ${step.note}` : ""}. Click to open the job card.`;
    case "current":
      return step.yourTurn
        ? `${name} (${who}): waiting for you. Click to open the mailbox and approve the plan.`
        : `${name} (${who}): in progress. Click to open the job card.`;
    default:
      return `${name} (${who}): not started yet. Click to open the job card.`;
  }
}

const CSS = `
.al-stepper-wrap { display: flex; justify-content: center; width: min(100%, ${STEPPER_MAX_PX}px); min-width: 0; max-width: 100%; overflow: hidden; }
.al-stepper-wrap[hidden] { display: none; }
.al-stepper { display: grid; grid-template-columns: repeat(var(--al-steps, 6), minmax(0, 1fr)); gap: var(--al-s1); width: 100%; min-width: 0; margin: 0; padding: 0; list-style: none; overflow: hidden; font: var(--al-font, 14px)/1.2 monospace; color: ${UI_COLOURS.text}; box-sizing: border-box; }
.al-stepper > li { min-width: 0; display: flex; }
.al-stepper-compact { display: none; padding: var(--al-s1) var(--al-s2); border: 1px solid transparent; border-radius: var(--al-radius); background: none; font: var(--al-font, 14px)/1.4 monospace; color: var(--al-step-colour, ${UI_COLOURS.text}); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; box-sizing: border-box; cursor: pointer; }
.al-stepper-compact[data-status="current"] { font-weight: bold; border-color: var(--al-step-colour); }
.al-stepper-compact[data-status="failed"] { color: ${UI_COLOURS.error}; border-color: ${UI_COLOURS.error}; }
.al-shell[data-compact="true"] .al-stepper { display: none; }
.al-shell[data-compact="true"] .al-stepper-compact { display: block; }
.al-step { display: grid; grid-template-columns: auto minmax(0, 1fr); grid-template-areas: "icon label" "icon time"; align-items: center; column-gap: var(--al-s1); width: 100%; min-width: 0; padding: 2px var(--al-s1); border: 1px solid transparent; border-radius: var(--al-radius); background: none; color: ${UI_COLOURS.muted}; font: inherit; text-align: left; overflow: hidden; cursor: pointer; box-sizing: border-box; }
.al-step-icon { grid-area: icon; min-width: 1.2ch; text-align: center; font-weight: bold; }
.al-step-label { grid-area: label; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.al-step-time { grid-area: time; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.8em; color: ${UI_COLOURS.muted}; }
.al-step-time:empty { display: none; }
.al-stepper[data-icons="true"] .al-step { grid-template-columns: minmax(0, 1fr); grid-template-areas: "icon" "time"; justify-items: center; text-align: center; }
.al-stepper[data-icons="true"] .al-step-label { display: none; }
.al-step[data-status="done"] { color: ${UI_COLOURS.text}; }
.al-step[data-status="done"] .al-step-icon { color: ${UI_COLOURS.add}; }
.al-step[data-status="current"] { color: var(--al-step-colour); font-weight: bold; border-color: var(--al-step-colour); }
.al-step[data-status="failed"] { color: ${UI_COLOURS.error}; border-color: ${UI_COLOURS.error}; }
.al-step[data-status="failed"] .al-step-time { color: ${UI_COLOURS.error}; }
.al-step:hover, .al-stepper-compact:hover { border-color: var(--al-accent); }
/* The strip clips its content, so the focus ring goes inside the button. */
.al-shell .al-step:focus-visible { outline-offset: -3px; }
.al-step[data-turn="true"], .al-stepper-compact[data-turn="true"] { background: ${UI_COLOURS.accent}; color: ${UI_COLOURS.inputBg}; border-color: ${UI_COLOURS.accent}; }
.al-step[data-turn="true"] .al-step-time { color: ${UI_COLOURS.inputBg}; }
.al-step[data-turn="true"]:hover, .al-stepper-compact[data-turn="true"]:hover { background: ${UI_COLOURS.accentText}; }
`;

export interface Stepper {
  update(job: JobView | null): void;
  /** Measures the top bar again (call after the text size changed). */
  refresh(): void;
}

/**
 * Progress strip in the top bar: six equal columns that never scroll. With room, a step shows icon, label and (once
 * done) its duration on a second line; without room only icon and duration, with the full text in the tooltip.
 * The "Your turn" step is a button that calls `onYourTurn`; every other step opens the job card (`onOpenJob`).
 * In narrow windows (shell `data-compact`) only the current step shows.
 */
export function createStepper(onYourTurn: () => void, host: HTMLElement = document.body, onOpenJob: () => void = () => {}): Stepper {
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  const wrap = document.createElement("div");
  wrap.className = "al-stepper-wrap";
  wrap.hidden = true;
  const root = document.createElement("ol");
  root.className = "al-stepper";
  root.setAttribute("aria-label", "Job progress");
  wrap.appendChild(root);
  host.appendChild(wrap);

  /** Labels or icons, from the width the top bar gives the stepper and the text size. */
  let stepCount = 6;
  const fit = () => {
    const width = Math.min(host.clientWidth, STEPPER_MAX_PX);
    const font = parseFloat(getComputedStyle(root).fontSize) || 14;
    root.dataset["icons"] = String(!stepperFitsLabels(width, font, stepCount));
  };
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(fit).observe(host);
  fit();

  return {
    refresh: fit,
    update(job) {
      const steps = stepperFor(job);
      wrap.hidden = steps.length === 0;
      stepCount = Math.max(1, steps.length);
      root.style.setProperty("--al-steps", String(stepCount));
      const items = steps.map((s) => {
        const li = document.createElement("li");
        const el = document.createElement("button");
        el.type = "button";
        el.className = "al-step";
        el.dataset["status"] = s.status;
        el.dataset["turn"] = String(s.yourTurn);
        el.style.setProperty("--al-step-colour", cssHex(ROLE_COLOURS[s.agentId]));
        const icon = document.createElement("span");
        icon.className = "al-step-icon";
        icon.setAttribute("aria-hidden", "true");
        icon.textContent = stepIcon(s.status);
        const label = document.createElement("span");
        label.className = "al-step-label";
        label.textContent = stepName(s);
        const time = document.createElement("span");
        time.className = "al-step-time";
        time.textContent = stepNote(s);
        el.append(icon, label, time);
        el.title = stepTitle(s);
        el.setAttribute("aria-label", `${stepLabel(s)}. ${stepTitle(s)}`);
        if (s.status === "current") el.setAttribute("aria-current", "step");
        el.addEventListener("click", s.yourTurn ? onYourTurn : onOpenJob);
        li.appendChild(el);
        return li;
      });
      root.replaceChildren(...items);
      fit();

      wrap.querySelector(".al-stepper-compact")?.remove();
      const compact = compactStep(steps);
      if (compact) {
        const el = document.createElement("button");
        el.type = "button";
        el.className = "al-stepper-compact";
        el.dataset["status"] = compact.status;
        el.dataset["turn"] = String(compact.yourTurn);
        const active = steps.find((s) => s.status === "current" || s.status === "failed");
        if (active) el.style.setProperty("--al-step-colour", cssHex(ROLE_COLOURS[active.agentId]));
        el.textContent = compact.text;
        el.title = compact.yourTurn ? `${compact.text}: open the mailbox` : `${compact.text}: open the job card`;
        el.addEventListener("click", compact.yourTurn ? onYourTurn : onOpenJob);
        wrap.appendChild(el);
      }
    },
  };
}
