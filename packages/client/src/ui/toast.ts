import type { PanelName } from "@agentlife/shared";
import { UI_COLOURS } from "./theme.ts";
import type { ReportVerdict } from "./report-viewer.ts";

export const TAB_TITLE = "AGENT LIFE";
export const YOUR_TURN_TEXT = "The Architect's plan is ready. Review it in the mailbox.";

/**
 * The toast stays while an approval is pending and the mailbox is closed. It goes away when the
 * approval is resolved or the mailbox is opened, and comes back if the mailbox is closed while one is still pending.
 */
export function yourTurnVisible(pending: number, openPanel: PanelName | null): boolean {
  return pending > 0 && openPanel !== "mailbox";
}

/** "(1) AGENT LIFE" while something waits for the user (approvals and unread reports), whether or not the mailbox is open. */
export function tabTitle(waiting: number): string {
  return waiting > 0 ? `(${waiting}) ${TAB_TITLE}` : TAB_TITLE;
}

/** "Report ready: PASS". The verdict is spelled out; without one the text still says a report arrived. */
export function reportToastText(verdict: ReportVerdict | undefined, night = false): string {
  if (night) return "Your morning summary is ready";
  return verdict ? `Report ready: ${verdict.toUpperCase()}` : "Report ready";
}

export type ToastKind = "your-turn" | "report";

export interface ToastSpec {
  kind: ToastKind;
  text: string;
  /** Label of the button. */
  action: string;
}

export interface ToastInput {
  /** Approvals that wait for the user. */
  pending: number;
  openPanel: PanelName | null;
  /** The newest report that was not opened yet, with its verdict (undefined when unknown). `night`: the morning summary. */
  unreadReport?: { reportId: string; verdict: ReportVerdict | undefined; night?: boolean } | undefined;
}

/**
 * Toasts to show now, most urgent first: the plan that waits for approval, then the delivered report. Both follow the
 * same rule: they are shown while the mailbox is closed and hidden once it is open.
 */
export function toastPlan(input: ToastInput): ToastSpec[] {
  const out: ToastSpec[] = [];
  if (yourTurnVisible(input.pending, input.openPanel)) out.push({ kind: "your-turn", text: YOUR_TURN_TEXT, action: "Open mailbox" });
  if (input.unreadReport && input.openPanel !== "mailbox") {
    out.push({ kind: "report", text: reportToastText(input.unreadReport.verdict, input.unreadReport.night === true), action: "Open report" });
  }
  return out;
}

const CSS = `
.al-turn { z-index: 12; max-width: min(560px, 100%); display: flex; gap: var(--al-s3); align-items: center; background: ${UI_COLOURS.panelBg}; color: ${UI_COLOURS.text}; border: 2px solid var(--al-accent); border-radius: var(--al-radius); padding: var(--al-s2) var(--al-s3); font: var(--al-font, 14px)/1.4 monospace; box-sizing: border-box; box-shadow: var(--al-shadow), 0 0 12px rgba(255, 138, 31, 0.45); }
.al-turn[hidden] { display: none; }
.al-turn[data-kind="report"] { border-color: var(--al-focus); box-shadow: var(--al-shadow), 0 0 12px rgba(143, 216, 255, 0.4); }
.al-turn button { flex: none; }
`;

export interface Toasts {
  /** Call after any change of the pending approvals, the unread reports or the open panel. Also sets the tab title. */
  update(input: ToastInput): void;
}

export interface ToastActions {
  openMailbox(): void;
  /** Open the report with this id in the viewer. */
  openReport(reportId: string): void;
}

/**
 * Call-to-action toasts under the top bar (in `host`, the stage banner column): "your turn" with a button that opens
 * the mailbox, and "Report ready" with a button that opens the report. They stack in that order.
 */
export function createToasts(actions: ToastActions, host: HTMLElement = document.body): Toasts {
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  const make = (kind: ToastKind, onClick: () => void) => {
    const root = document.createElement("div");
    root.className = "al-turn";
    root.dataset["kind"] = kind;
    root.hidden = true;
    root.setAttribute("role", kind === "your-turn" ? "alert" : "status");
    const text = document.createElement("span");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "al-btn";
    button.addEventListener("click", onClick);
    root.append(text, button);
    host.appendChild(root);
    return { root, text, button };
  };

  let reportId: string | undefined;
  const turn = make("your-turn", () => actions.openMailbox());
  const report = make("report", () => {
    if (reportId) actions.openReport(reportId);
  });
  const parts = { "your-turn": turn, report } as const;

  return {
    update(input) {
      const plan = toastPlan(input);
      reportId = input.unreadReport?.reportId;
      for (const kind of ["your-turn", "report"] as const) {
        const spec = plan.find((s) => s.kind === kind);
        const p = parts[kind];
        p.root.hidden = !spec;
        if (spec) {
          p.text.textContent = spec.text;
          p.button.textContent = spec.action;
        }
      }
      document.title = tabTitle(input.pending + (input.unreadReport ? 1 : 0));
    },
  };
}
