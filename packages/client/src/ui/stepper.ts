import { ROLE_INFO } from "@agentlife/shared";
import type { AgentId, JobState, JobView } from "@agentlife/shared";
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

const STEPS: readonly { key: StepKey; label: string; agentId: AgentId; states: readonly JobState[] }[] = [
  { key: "plan", label: "Plan", agentId: "architect", states: ["created", "analyzing"] },
  { key: "approve", label: "Approve", agentId: "architect", states: ["awaiting_plan_approval"] },
  { key: "build", label: "Build", agentId: "developer", states: ["developing"] },
  { key: "test", label: "Test", agentId: "qa", states: ["testing"] },
  { key: "review", label: "Review", agentId: "qa", states: ["reviewing"] },
  { key: "report", label: "Report", agentId: "architect", states: ["report_ready"] },
];

/** Index of the step a job state belongs to, or -1 for states that end the job. */
function stepIndexOf(state: JobState): number {
  return STEPS.findIndex((s) => s.states.includes(state));
}

/** Step the job was in right before it entered `endState` (failed, cancelled); 0 when unknown. */
function stepBefore(timeline: JobView["timeline"], endState: JobState): number {
  const at = timeline.findIndex((e) => e.state === endState);
  for (let i = at - 1; i >= 0; i--) {
    const idx = stepIndexOf(timeline[i]!.state);
    if (idx >= 0) return idx;
  }
  return 0;
}

/** Time spent in each step: the gaps between a state entry and the next entry, summed over retries. */
function durations(timeline: JobView["timeline"]): (number | undefined)[] {
  const out: (number | undefined)[] = STEPS.map(() => undefined);
  for (let i = 0; i + 1 < timeline.length; i++) {
    const idx = stepIndexOf(timeline[i]!.state);
    if (idx < 0) continue;
    const span = Math.max(0, timeline[i + 1]!.ts - timeline[i]!.ts);
    out[idx] = (out[idx] ?? 0) + span;
  }
  return out;
}

/**
 * Maps a job to the six steps Plan, Approve, Build, Test, Review, Report. Empty when there is no job.
 * A job whose timeline has `failed` ends with a failure report (the engine goes failed -> report_ready -> delivered),
 * so the failure is read from the timeline, not from the final state.
 */
export function stepperFor(job: JobView | null): StepperStep[] {
  if (!job) return [];
  const timeline = job.timeline;
  const spans = durations(timeline);
  const failedAtTimeline = timeline.some((e) => e.state === "failed");

  let failedAt = -1;
  let note: string | undefined;
  let current = -1;
  if (failedAtTimeline || job.state === "failed") {
    failedAt = stepBefore(timeline, "failed");
    note = "Failed";
  } else if (job.state === "cancelled") {
    failedAt = stepBefore(timeline, "cancelled");
    const text = timeline.find((e) => e.state === "cancelled")?.text;
    note = text && /reject/i.test(text) ? "Plan rejected" : "Cancelled";
  } else if (job.state !== "delivered") {
    current = Math.max(0, stepIndexOf(job.state));
  }

  return STEPS.map((s, i): StepperStep => {
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

const CSS = `
.al-stepper-wrap { min-width: 0; max-width: 100%; }
.al-stepper-wrap[hidden] { display: none; }
.al-stepper { display: flex; flex-wrap: nowrap; justify-content: center; gap: var(--al-s1); min-width: 0; max-width: 100%; overflow-x: auto; margin: 0; padding: 0; list-style: none; font: var(--al-font, 14px)/1.4 monospace; color: ${UI_COLOURS.text}; box-sizing: border-box; }
.al-stepper-compact { display: none; padding: var(--al-s1) var(--al-s2); border: 1px solid transparent; border-radius: var(--al-radius); background: none; font: var(--al-font, 14px)/1.4 monospace; color: var(--al-step-colour, ${UI_COLOURS.text}); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; box-sizing: border-box; }
.al-stepper-compact[data-status="current"] { font-weight: bold; border-color: var(--al-step-colour); }
.al-stepper-compact[data-status="failed"] { color: ${UI_COLOURS.error}; border-color: ${UI_COLOURS.error}; }
button.al-stepper-compact { cursor: pointer; background: ${UI_COLOURS.accent}; color: ${UI_COLOURS.inputBg}; border-color: ${UI_COLOURS.accent}; }
.al-shell[data-compact="true"] .al-stepper { display: none; }
.al-shell[data-compact="true"] .al-stepper-compact { display: block; }
.al-step { padding: var(--al-s1) var(--al-s2); border: 1px solid transparent; border-radius: var(--al-radius); background: none; color: ${UI_COLOURS.muted}; font: inherit; white-space: nowrap; }
.al-step[data-status="done"] { color: ${UI_COLOURS.text}; }
.al-step[data-status="current"] { color: var(--al-step-colour); font-weight: bold; border-color: var(--al-step-colour); }
.al-step[data-status="failed"] { color: ${UI_COLOURS.error}; border-color: ${UI_COLOURS.error}; }
button.al-step { cursor: pointer; background: ${UI_COLOURS.accent}; color: ${UI_COLOURS.inputBg}; border-color: ${UI_COLOURS.accent}; }
button.al-step:hover, button.al-stepper-compact:hover { background: ${UI_COLOURS.accentText}; }
`;

export interface Stepper {
  update(job: JobView | null): void;
}

/** Progress strip in the top bar. The "Your turn" step is a button that calls `onYourTurn`. In narrow windows (shell `data-compact`) only the current step shows. */
export function createStepper(onYourTurn: () => void, host: HTMLElement = document.body): Stepper {
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

  return {
    update(job) {
      const steps = stepperFor(job);
      wrap.hidden = steps.length === 0;
      const items = steps.map((s) => {
        const li = document.createElement("li");
        const el = document.createElement(s.yourTurn ? "button" : "span");
        el.className = "al-step";
        el.dataset["status"] = s.status;
        el.style.setProperty("--al-step-colour", cssHex(ROLE_COLOURS[s.agentId]));
        el.textContent = stepLabel(s);
        el.title = `${ROLE_INFO[s.agentId].name}${s.yourTurn ? ": open the mailbox to approve the plan" : ""}`;
        if (s.status === "current") el.setAttribute("aria-current", "step");
        if (el instanceof HTMLButtonElement) {
          el.type = "button";
          el.addEventListener("click", onYourTurn);
        }
        li.appendChild(el);
        return li;
      });
      root.replaceChildren(...items);

      wrap.querySelector(".al-stepper-compact")?.remove();
      const compact = compactStep(steps);
      if (compact) {
        const el = document.createElement(compact.yourTurn ? "button" : "span");
        el.className = "al-stepper-compact";
        el.dataset["status"] = compact.status;
        const active = steps.find((s) => s.status === "current" || s.status === "failed");
        if (active) el.style.setProperty("--al-step-colour", cssHex(ROLE_COLOURS[active.agentId]));
        el.textContent = compact.text;
        el.title = compact.text;
        if (el instanceof HTMLButtonElement) {
          el.type = "button";
          el.addEventListener("click", onYourTurn);
        }
        wrap.appendChild(el);
      }
    },
  };
}
