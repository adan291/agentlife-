import type { ClientMsg, HrAction, MemoryAction, PanelName, ServerMsg } from "@agentlife/shared";
import { approveMessage, deliverMessage, startJobMessage } from "./actions.ts";
import { createComputerPanel } from "./computer.ts";
import type { PanelContent } from "./computer.ts";
import { createKindPanel } from "./kind-forms.ts";
import type { KindFormActions } from "./kind-forms.ts";
import { createLibraryPanel } from "./library.ts";
import type { LibraryActions } from "./library.ts";
import { renderJobPanel } from "./job-panel.ts";
import { renderMailbox } from "./mailbox.ts";
import { renderFloorList } from "./elevator.ts";
import { BUILD_EVENT_REFRESH_MS, BUILD_REFRESH_MS, isBuilderMessage, renderBuildBoard, renderBuildReport } from "./build-board.ts";
import { createNightPanel } from "./night-board.ts";
import { createPipelineEditor } from "./pipeline-editor.ts";
import { createShopPanel } from "./shop.ts";
import { createHrPanel } from "./hr.ts";
import { PanelState } from "./panel-state.ts";
import { createReceptionPanel } from "./reception.ts";
import { UI_COLOURS } from "./theme.ts";

const CSS = `
.al-panel { position: absolute; z-index: 20; top: var(--al-s2); left: 50%; transform: translateX(-50%); width: min(720px, calc(100% - var(--al-s4))); max-height: calc(100% - var(--al-s4)); display: flex; flex-direction: column; background: ${UI_COLOURS.panelBg}; color: ${UI_COLOURS.text}; border: 1px solid var(--al-accent); border-radius: var(--al-radius); box-shadow: var(--al-shadow); font: var(--al-font, 14px)/1.5 monospace; box-sizing: border-box; }
.al-panel[hidden] { display: none; }
.al-shell[data-compact="true"] .al-panel { top: 0; left: 0; transform: none; width: 100%; max-height: 100%; border-radius: 0; border-width: 1px 0; }
.al-panel-head { flex: none; display: flex; justify-content: space-between; align-items: center; gap: var(--al-s3); padding: var(--al-s2) var(--al-s4); border-bottom: 1px solid var(--al-border); }
.al-panel-body { flex: 1; min-height: 0; overflow: auto; padding: var(--al-s2) var(--al-s4) var(--al-s3); }
.al-panel-foot { flex: none; display: flex; justify-content: flex-end; gap: var(--al-s2); padding: var(--al-s2) var(--al-s4); border-top: 1px solid var(--al-border); }
.al-panel-foot[hidden] { display: none; }
.al-panel h3, .al-panel h4, .al-panel h5, .al-panel h6 { margin: var(--al-s2) 0 var(--al-s1); color: ${UI_COLOURS.accentText}; }
.al-panel h3 { margin: 0; }
.al-panel label { display: block; margin: var(--al-s2) 0; }
.al-field { margin: var(--al-s2) 0; }
.al-repo-line { margin: var(--al-s2) 0; }
.al-input { display: block; width: 100%; box-sizing: border-box; margin-top: var(--al-s1); padding: var(--al-s1); }
.al-row { display: flex; gap: var(--al-s2); margin-top: var(--al-s2); }
.al-card { border: 1px solid var(--al-border); border-radius: var(--al-radius); padding: var(--al-s2); margin: var(--al-s2) 0; }
.al-card pre { overflow-x: auto; background: ${UI_COLOURS.inputBg}; padding: var(--al-s1); margin: var(--al-s2) 0; }
.al-card code { font: inherit; }
.al-diff-line { display: block; white-space: pre; }
.al-diff-add { color: ${UI_COLOURS.add}; background: ${UI_COLOURS.addBg}; }
.al-diff-del { color: ${UI_COLOURS.del}; background: ${UI_COLOURS.delBg}; }
.al-diff-hunk { color: ${UI_COLOURS.hunk}; }
.al-diff-meta { color: ${UI_COLOURS.muted}; }
.al-muted { color: ${UI_COLOURS.muted}; }
.al-error { color: ${UI_COLOURS.error}; }
.al-timeline { padding-left: var(--al-s5); white-space: pre-wrap; }
.al-panel[data-wide="true"] { width: min(960px, calc(100% - var(--al-s4))); }
.al-wrap { flex-wrap: wrap; }
.al-facts { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: var(--al-s1) var(--al-s3); margin: 0 0 var(--al-s2); }
.al-facts dt { color: ${UI_COLOURS.muted}; }
.al-facts dd { margin: 0; overflow-wrap: anywhere; }
.al-table-wrap { overflow-x: auto; }
.al-table { width: 100%; border-collapse: collapse; }
.al-table th, .al-table td { text-align: left; padding: var(--al-s1) var(--al-s2); border-bottom: 1px solid var(--al-border); white-space: nowrap; }
.al-table th { color: ${UI_COLOURS.accentText}; }
.al-plain { overflow-x: auto; background: ${UI_COLOURS.inputBg}; padding: var(--al-s2); margin: var(--al-s2) 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.al-plain code, .al-diff code { font: inherit; }
.al-diff { overflow-x: auto; background: ${UI_COLOURS.inputBg}; padding: var(--al-s2); margin: var(--al-s2) 0; }
.al-credits { margin-top: var(--al-s3); }
.al-badge { display: inline-block; flex: none; padding: 0 var(--al-s2); border: 1px solid var(--al-border); border-radius: var(--al-s1); font-weight: bold; white-space: nowrap; color: ${UI_COLOURS.muted}; }
.al-badge[data-verdict="pass"] { color: ${UI_COLOURS.add}; background: ${UI_COLOURS.addBg}; border-color: ${UI_COLOURS.add}; }
.al-badge[data-verdict="fail"] { color: ${UI_COLOURS.del}; background: ${UI_COLOURS.delBg}; border-color: ${UI_COLOURS.del}; }
.al-report-head { display: flex; align-items: center; flex-wrap: wrap; gap: var(--al-s3); margin: var(--al-s3) 0 var(--al-s2); }
.al-report-facts { margin: 0 0 var(--al-s2); padding-left: var(--al-s5); }
.al-report-item { display: flex; align-items: center; gap: var(--al-s3); width: 100%; margin: var(--al-s1) 0; padding: var(--al-s2); text-align: left; background: none; color: inherit; font: inherit; cursor: pointer; border: 1px solid var(--al-border); border-radius: var(--al-radius); box-sizing: border-box; }
.al-report-item:hover { border-color: var(--al-accent); background: ${UI_COLOURS.inputBg}; }
.al-report-item[data-unread="true"] { border-color: var(--al-accent); }
.al-report-open { flex: none; padding: 0 var(--al-s2); border: 1px solid var(--al-border); border-radius: var(--al-radius); color: var(--al-accent); }
.al-report-item:hover .al-report-open, .al-report-item:focus-visible .al-report-open { border-color: var(--al-accent); }
.al-report-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.al-new { flex: none; padding: 0 var(--al-s2); border-radius: var(--al-s1); background: var(--al-accent); color: ${UI_COLOURS.inputBg}; font-weight: bold; }
.al-floor-list { list-style: none; margin: 0; padding: 0; }
.al-floor { display: flex; align-items: center; gap: var(--al-s3); margin: var(--al-s1) 0; padding: var(--al-s2); border: 1px solid var(--al-border); border-radius: var(--al-radius); }
.al-floor[data-here="true"] { border-color: var(--al-accent); }
.al-floor[data-attention="true"] { border-color: var(--al-accent); background: ${UI_COLOURS.inputBg}; box-shadow: inset 4px 0 0 var(--al-accent); }
.al-floor-tag { flex: none; min-width: 3ch; text-align: center; font-weight: bold; color: ${UI_COLOURS.accentText}; }
.al-floor-name { flex: none; max-width: 40%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.al-floor-status { flex: 1; min-width: 0; color: ${UI_COLOURS.muted}; overflow-wrap: anywhere; }
.al-floor[data-attention="true"] .al-floor-status { color: ${UI_COLOURS.accentText}; font-weight: bold; }
.al-build-list, .al-build-sessions, .al-build-tasks { list-style: none; margin: 0; padding: 0; }
.al-build-phase { margin: 0 0 var(--al-s2); font-weight: bold; color: ${UI_COLOURS.accentText}; }
.al-build-row { margin: var(--al-s2) 0; padding: var(--al-s2); border: 1px solid var(--al-border); border-radius: var(--al-radius); }
.al-build-row[data-status="running"], .al-build-row[data-status="verifying"] { border-color: var(--al-accent); background: ${UI_COLOURS.inputBg}; }
.al-build-row[data-attention="true"] { border-color: var(--al-accent); box-shadow: inset 4px 0 0 var(--al-accent); }
.al-build-head { display: flex; align-items: center; gap: var(--al-s3); }
.al-build-name { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.al-build-chip[data-status="merged"] { color: ${UI_COLOURS.add}; border-color: ${UI_COLOURS.add}; }
.al-build-chip[data-status="waits_for_you"], .al-build-chip[data-status="running"], .al-build-chip[data-status="verifying"] { color: ${UI_COLOURS.accentText}; border-color: var(--al-accent); }
.al-build-purpose { margin: var(--al-s1) 0; }
.al-build-meta { display: flex; align-items: center; gap: var(--al-s3); }
.al-build-bar { flex: 1; height: 10px; border: 1px solid var(--al-border); border-radius: var(--al-s1); background: ${UI_COLOURS.inputBg}; overflow: hidden; }
.al-build-fill { height: 100%; background: var(--al-accent); }
.al-build-count { flex: none; }
.al-build-reason { margin: var(--al-s1) 0; color: ${UI_COLOURS.accentText}; font-weight: bold; }
.al-build-tasks { margin-top: var(--al-s2); }
.al-build-tasks li { margin: var(--al-s1) 0; overflow-wrap: anywhere; }
.al-build-tasks li[data-done="true"] { color: ${UI_COLOURS.muted}; }
.al-build-verdict[data-verdict="pass"] { color: ${UI_COLOURS.add}; }
.al-build-verdict[data-verdict="fail"] { color: ${UI_COLOURS.del}; }
.al-night-list { list-style: none; margin: 0; padding: 0; }
.al-night-job[data-attention="true"] { border-color: var(--al-accent); box-shadow: inset 4px 0 0 var(--al-accent); }
.al-night-job[data-status="running"] { border-color: var(--al-accent); }
.al-night-goal { margin: var(--al-s1) 0; overflow-wrap: anywhere; }
.al-night-chip[data-status="done"] { color: ${UI_COLOURS.add}; border-color: ${UI_COLOURS.add}; }
.al-night-chip[data-status="failed"], .al-night-chip[data-status="timed_out"] { color: ${UI_COLOURS.del}; border-color: ${UI_COLOURS.del}; }
.al-night-chip[data-status="waiting"], .al-night-chip[data-status="running"] { color: ${UI_COLOURS.accentText}; border-color: var(--al-accent); }
.al-night-check { display: flex; align-items: flex-start; gap: var(--al-s2); }
.al-mem-list { list-style: none; margin: 0; padding: 0; }
.al-mem-text { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.al-mem-kind[data-kind="decision"] { color: ${UI_COLOURS.accentText}; border-color: var(--al-accent); }
.al-mem-kind[data-kind="pitfall"] { color: ${UI_COLOURS.del}; border-color: ${UI_COLOURS.del}; }
.al-mem-kind[data-kind="convention"] { color: ${UI_COLOURS.add}; border-color: ${UI_COLOURS.add}; }
.al-remember { border-color: var(--al-accent); }
.al-mem-item { margin: var(--al-s2) 0; }
.al-badge[data-verdict="night"] { color: ${UI_COLOURS.accentText}; border-color: var(--al-accent); }
.al-pipe { margin: 0 0 var(--al-s3); padding-bottom: var(--al-s2); border-bottom: 1px solid var(--al-border); }
.al-pipe-row { list-style: none; margin: var(--al-s2) 0; padding: 0; display: flex; flex-wrap: wrap; gap: var(--al-s2); }
.al-pipe-card { flex: 1 1 150px; max-width: 220px; min-width: 0; padding: var(--al-s2); border: 1px solid var(--al-border); border-radius: var(--al-radius); box-sizing: border-box; }
.al-pipe-card[data-invalid="true"] { border-color: ${UI_COLOURS.del}; background: ${UI_COLOURS.delBg}; }
.al-pipe-card[data-dragging="true"] { opacity: 0.6; border-color: var(--al-accent); }
.al-pipe-card[data-drop="true"] { box-shadow: inset 4px 0 0 var(--al-accent); }
.al-pipe-head { display: flex; align-items: center; gap: var(--al-s2); }
.al-pipe-grip { cursor: grab; touch-action: none; padding: 0 var(--al-s2); }
.al-pipe-name { min-width: 0; overflow-wrap: anywhere; }
.al-pipe-who, .al-pipe-model { margin: var(--al-s1) 0; }
.al-pipe-problem { margin: var(--al-s1) 0 0; }
.al-pipe-errors { margin: var(--al-s2) 0; padding-left: var(--al-s5); }
.al-shop-head { margin: 0 0 var(--al-s2); font-weight: bold; color: ${UI_COLOURS.accentText}; }
.al-shop-list { list-style: none; margin: var(--al-s2) 0 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: var(--al-s2); }
.al-shop-item { display: flex; flex-direction: column; gap: var(--al-s1); padding: var(--al-s2); border: 1px solid var(--al-border); border-radius: var(--al-radius); }
.al-shop-item p { margin: 0; }
.al-shop-preview { display: flex; align-items: center; justify-content: center; height: 112px; background: ${UI_COLOURS.inputBg}; border-radius: var(--al-radius); overflow: hidden; }
.al-shop-preview img { max-width: 100%; max-height: 100%; image-rendering: pixelated; transform: scale(1.5); }
.al-shop-price { font-weight: bold; color: ${UI_COLOURS.accentText}; }
`;

const TITLES: Record<PanelName, string> = {
  computer: "Computer",
  mailbox: "Mailbox",
  board: "Job",
  reception: "Reception",
  elevator: "Elevator",
  directory: "Floors",
  door: "Door",
  build: "Construction board",
  review: "Review desk",
  tests: "Test lab",
  library: "Library",
  night: "Night shift",
  hr: "HR desk",
  shop: "Shop",
};

/** The shop needs the real hotel: the recorded demo shows this instead of the catalogue. */
const SHOP_LOCKED = "The shop is off in the recorded demo. Run AGENT LIFE on your computer: real, verified work earns Ecto to spend on furniture.";

/** The HR desk needs the real engine: the recorded demo shows this instead of the desk. */
const HR_LOCKED = "The HR desk is off in the recorded demo. Run AGENT LIFE on your computer to hire, rename and fire agents.";

/** The night shift needs the real engine: the recorded demo shows this instead of the board. */
const NIGHT_LOCKED = "The night shift is off in the recorded demo. Run AGENT LIFE on your computer to schedule jobs for the night.";

/** While the Library panel or a report with a "Remember this?" card is open and the librarian is still working, it asks this often. */
export const MEMORY_REFRESH_MS = 4_000;

/** The Library needs the real engine: the recorded demo shows this instead of the notes. */
const LIBRARY_LOCKED = "The Library is off in the recorded demo. Run AGENT LIFE on your computer and the team will remember what it learns about your project.";

/** While the night board is open it asks for fresh data this often (a job changes state while the user looks). */export const NIGHT_REFRESH_MS = 10_000;

/** The pipeline editor needs the real engine: the recorded demo shows this instead of the editor. */
const PIPELINE_LOCKED = "The pipeline editor is off in the recorded demo. Run AGENT LIFE on your computer to choose the steps of your jobs.";

/** The door panel is never shown in practice: the server turns a door into a floor change. */
function doorNote(doc: Document): HTMLElement {
  const p = doc.createElement("p");
  p.textContent = "Opening the door…";
  return p;
}

/** How long the job card waits after a `work` message before it asks for fresh numbers. */
export const DETAILS_REFRESH_MS = 1500;

export interface Panels {
  /** Feed every server message; opens panels and refreshes the open one. */
  handle(msg: ServerMsg): void;
  close(): void;
  /** Opens a panel with the data already on the client, without walking to the furniture. */
  open(panel: PanelName): void;
  /** Opens the mailbox with this report in the viewer (toast "Open report"). */
  openReport(reportId: string): void;
  /** Arrange mode: while locked no panel opens (by the server, a toast or a button), and the open one closes. */
  lock(on: boolean): void;
  readonly state: PanelState;
}

export interface PanelHooks {
  /** Reports that were delivered and not opened yet; the mailbox marks them. */
  unreadReports?(): ReadonlySet<string>;
  /** A report was opened in the viewer. */
  onReportOpened?(reportId: string): void;
  /** Replay mode: the goal of the recorded run. The computer panel shows it read-only. */
  lockedGoal?: string;
  /** Replay mode: registering and removing projects is off; the Reception panel shows this text instead of the form. */
  projectsLocked?: string;
  /** The user picked a floor in the elevator panel. */
  goTo?(roomId: string): void;
  /** The user asked the HR agent for a proposal: the HR ghost starts thinking (it stops when the answer or an error arrives). */
  hrThinking?(): void;
  /** A picture of a piece of furniture drawn by the room's own renderer (a data URL), for the shop. */
  shopPreview?(defId: string): string | undefined;
}

/**
 * DOM panels for computer, mailbox and board, mounted in `host` (the stage). A panel has a header (title, close button),
 * a scrollable body and an optional footer for actions. Hidden panels take no space and never block the canvas.
 * `onChange` runs after every re-render (open, close, refresh).
 */
export function createPanels(
  send: (msg: ClientMsg) => void,
  onChange: () => void = () => {},
  host: HTMLElement = document.body,
  hooks: PanelHooks = {},
): Panels {
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  const state = new PanelState();
  /** Arrange mode is on: no panel opens. */
  let arranging = false;
  const computer = createComputerPanel(document, { startJob: (repoId, goal) => send(startJobMessage(repoId, goal)) }, hooks.lockedGoal);
  const kindActions: KindFormActions = {
    startJob: (repoId, goal, kind, target) => send(startJobMessage(repoId, goal, kind, target)),
  };
  const locked = hooks.lockedGoal !== undefined;
  const kindPanels = {
    review: createKindPanel(document, "review-branch", kindActions, locked),
    tests: createKindPanel(document, "write-tests", kindActions, locked),
    library: createKindPanel(document, "document", kindActions, locked),
  };
  const memoryAct = (act: MemoryAction): void => {
    state.memoryError = null;
    send({ type: "memory_do", act });
  };
  const libraryActions: LibraryActions = {
    edit: (entryId, patch) => memoryAct({ action: "edit", entryId, ...patch }),
    remove: (entryId) => memoryAct({ action: "delete", entryId }),
    accept: (proposalId, edit) => memoryAct({ action: "accept", proposalId, ...edit }),
    dismiss: (proposalId) => memoryAct({ action: "dismiss", proposalId }),
    setAuto: (autoRemember) => memoryAct({ action: "auto", autoRemember }),
    openReport: (reportId) => openReport(reportId),
  };
  const libraryPanel = createLibraryPanel(document, libraryActions, kindPanels.library);
  const reception = createReceptionPanel(document, {
    register: (body) => send({ type: "register_project", ...body }),
    remove: (projectId) => send({ type: "remove_project", projectId }),
  });
  const nightPanel = createNightPanel(document, {
    add: (job) => {
      state.nightError = null;
      send({ type: "night_add", job });
    },
    remove: (id) => {
      state.nightError = null;
      send({ type: "night_remove", id });
    },
    move: (id, direction) => {
      state.nightError = null;
      send({ type: "night_move", id, direction });
    },
  });

  const pipelineEditor = createPipelineEditor(document, {
    save: (steps) => {
      state.pipelineError = null;
      send({ type: "pipeline_save", steps });
    },
    reset: () => {
      state.pipelineError = null;
      send({ type: "pipeline_reset" });
    },
  });

  const shopPanel = createShopPanel(
    document,
    {
      buy: (itemId) => {
        state.shopError = null;
        send({ type: "shop_buy", itemId });
      },
    },
    hooks.shopPreview ? { preview: hooks.shopPreview } : {},
  );

  const hrAct = (act: HrAction): void => {
    state.hrError = null;
    send({ type: "hr_do", act });
  };
  const hrPanel = createHrPanel(document, {
    hire: (projectId, templateId, displayName, model) => hrAct({ action: "hire", projectId, templateId, displayName, ...(model ? { model } : {}) }),
    rename: (projectId, memberId, displayName) => hrAct({ action: "update", projectId, memberId, displayName }),
    setModel: (projectId, memberId, model) => hrAct({ action: "update", projectId, memberId, model }),
    fire: (projectId, memberId) => hrAct({ action: "fire", projectId, memberId }),
    importFrom: (url) => hrAct({ action: "import", url }),
    approve: (id, hash) => hrAct({ action: "approve_import", id, hash }),
    reject: (id) => hrAct({ action: "reject_import", id }),
    suggest: (projectId) => {
      state.suggestion = null;
      state.hrBusy = projectId;
      hooks.hrThinking?.();
      hrAct({ action: "suggest", projectId });
      render();
    },
    apply: (projectId, picks) => {
      state.suggestion = null;
      hrAct({ action: "apply", projectId, picks });
    },
  });

  const root = document.createElement("div");
  root.className = "al-panel";
  root.hidden = true;
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", "Panel");
  const title = document.createElement("h3");
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "al-btn";
  closeBtn.textContent = "Close";
  closeBtn.setAttribute("aria-label", "Close panel");
  const header = document.createElement("header");
  header.className = "al-panel-head";
  header.append(title, closeBtn);
  const body = document.createElement("div");
  body.className = "al-panel-body";
  const footer = document.createElement("footer");
  footer.className = "al-panel-foot";
  footer.hidden = true;
  root.append(header, body, footer);
  host.appendChild(root);

  const expandedSpecs = new Set<string>();
  let buildInterval: ReturnType<typeof setInterval> | undefined;
  let buildEventTimer: ReturnType<typeof setTimeout> | undefined;

  /** The construction board, or the verification report the user opened from it. */
  const renderBuild = (): HTMLElement => {
    if (state.buildViewing) {
      return renderBuildReport(document, state.buildViewing, state.buildReport, () => {
        state.buildViewing = null;
        render();
      });
    }
    return renderBuildBoard(
      document,
      state.build,
      expandedSpecs,
      {
        toggle: (spec) => {
          if (!expandedSpecs.delete(spec)) expandedSpecs.add(spec);
          render();
        },
        openReport: (spec) => {
          state.buildViewing = spec;
          state.buildReport = null;
          send({ type: "build_report", spec });
          render();
        },
      },
      state.buildError,
    );
  };

  /** While the board is open: a refresh every 10 s, and one soon after a Builder message (crew or phase event). */
  const syncBuildTimers = () => {
    if (state.open === "build") {
      buildInterval ??= setInterval(() => send({ type: "build_board" }), BUILD_REFRESH_MS);
      return;
    }
    clearInterval(buildInterval);
    buildInterval = undefined;
    clearTimeout(buildEventTimer);
    buildEventTimer = undefined;
  };
  const scheduleBuildRefresh = () => {
    if (buildEventTimer !== undefined) return;
    buildEventTimer = setTimeout(() => {
      buildEventTimer = undefined;
      if (state.open === "build") send({ type: "build_board" });
    }, BUILD_EVENT_REFRESH_MS);
  };

  let lastViewKey = "";
  let nightInterval: ReturnType<typeof setInterval> | undefined;
  const syncNightTimer = () => {
    if (state.open === "night" && !locked) {
      nightInterval ??= setInterval(() => send({ type: "night_state" }), NIGHT_REFRESH_MS);
      return;
    }
    clearInterval(nightInterval);
    nightInterval = undefined;
  };
  /** The librarian reads a finished job for a while: ask again until it is done (only while its result is on screen). */
  let memoryInterval: ReturnType<typeof setInterval> | undefined;
  const syncMemoryTimer = () => {
    const m = state.memory;
    let waiting = false;
    if (m && !locked) {
      if (state.open === "library") waiting = m.learning.length > 0;
      else if (state.open === "mailbox" && state.viewing) {
        const report = state.data.reports.find((r) => r.reportId === state.viewing);
        waiting = report !== undefined && m.learning.includes(report.taskId);
      }
    }
    if (waiting) {
      memoryInterval ??= setInterval(() => send({ type: "memory_state" }), MEMORY_REFRESH_MS);
      return;
    }
    clearInterval(memoryInterval);
    memoryInterval = undefined;
  };
  /** The board: the pipeline editor of the project, then the card of its job. A document opened in the viewer replaces both. */
  const boardBody = (): HTMLElement => {
    const card = renderJobPanel(document, state.data, state.viewing, {
      view: (artifactId) => {
        state.view(artifactId);
        render();
      },
      back: () => {
        state.back();
        render();
      },
    });
    if (state.viewing || !state.roomId?.startsWith("project:")) return card;
    const wrap = document.createElement("div");
    wrap.append(pipelineEditor({ state: state.pipeline, error: state.pipelineError, ...(locked ? { locked: PIPELINE_LOCKED } : {}) }, render), card);
    return wrap;
  };

  const render = () => {
    syncBuildTimers();
    syncNightTimer();
    syncMemoryTimer();
    if (!state.open) {
      root.hidden = true;
      onChange();
      return;
    }
    const wasHidden = root.hidden;
    root.hidden = false;
    title.textContent = TITLES[state.open];
    root.setAttribute("aria-label", TITLES[state.open]);
    root.dataset["wide"] = String(state.open === "board" || state.open === "build" || state.open === "night" || state.open === "hr" || state.open === "shop" || (state.open === "mailbox" && state.viewing !== null));
    const content: PanelContent =
      state.open === "computer"
        ? computer(state.data, state.engineError)
        : state.open === "library"
          ? libraryPanel(state.data, { memory: state.memory, error: state.memoryError, ...(locked ? { locked: LIBRARY_LOCKED } : {}) }, state.engineError, render)
          : state.open === "review" || state.open === "tests"
          ? kindPanels[state.open](state.data, state.engineError)
          : state.open === "reception"
          ? reception(state.data, { registration: state.registration, engineError: state.engineError, locked: hooks.projectsLocked }, render)
          : state.open === "mailbox"
            ? {
                body: renderMailbox(
                  document,
                  state.data,
                  {
                    decide: (approvalId, decision) => send(approveMessage(approvalId, decision)),
                    openReport: (reportId) => openReport(reportId),
                    deliver: (taskId) => send(deliverMessage(taskId)),
                    ...(locked ? {} : { remember: libraryActions }),
                    back: () => {
                      state.back();
                      render();
                    },
                  },
                  { reading: state.viewing, unread: hooks.unreadReports?.() ?? new Set(), memory: state.memory, memoryError: state.memoryError },
                ),
              }
            : state.open === "elevator"
              ? { body: renderFloorList(document, state.floors, state.roomId, { go: (roomId) => hooks.goTo?.(roomId) }) }
              : state.open === "directory"
                ? { body: renderFloorList(document, state.floors, state.roomId) }
                : state.open === "build"
                  ? { body: renderBuild() }
                  : state.open === "night"
                    ? nightPanel(
                        state.data,
                        { night: state.night, error: state.nightError, ...(locked ? { locked: NIGHT_LOCKED } : {}) },
                        render,
                      )
                    : state.open === "hr"
                      ? hrPanel({ hr: state.hr, error: state.hrError, suggestion: state.suggestion, busy: state.hrBusy, ...(locked ? { locked: HR_LOCKED } : {}) }, render)
                      : state.open === "shop"
                        ? shopPanel({ shop: state.shop, error: state.shopError, ...(locked ? { locked: SHOP_LOCKED } : {}) }, render)
                    : state.open === "door"
                  ? { body: doorNote(document) }
                  : { body: boardBody() };
    // A refresh of the same view keeps the reading position; opening another view starts at the top.
    const viewKey = `${state.open}:${state.viewing ?? ""}`;
    const keep = !wasHidden && viewKey === lastViewKey ? body.scrollTop : 0;
    lastViewKey = viewKey;
    body.replaceChildren(content.body);
    body.scrollTop = keep;
    footer.replaceChildren(...(content.footer ? [content.footer] : []));
    footer.hidden = !content.footer;
    if (wasHidden) closeBtn.focus();
    onChange();
  };

  const openReport = (reportId: string) => {
    if (arranging) return;
    if (state.open !== "mailbox") state.apply({ type: "open_panel", panel: "mailbox" });
    state.view(reportId);
    hooks.onReportOpened?.(reportId);
    // The "Remember this?" card needs the Library's latest word (the librarian may have just finished).
    if (!locked && state.roomId?.startsWith("project:")) send({ type: "memory_state" });
    render();
  };

  const requestDetails = () => {
    const job = state.data.job;
    if (job) send({ type: "job_details", taskId: job.taskId });
  };
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  const scheduleRefresh = () => {
    if (refreshTimer !== undefined) return;
    refreshTimer = setTimeout(() => {
      refreshTimer = undefined;
      if (state.open === "board") requestDetails();
    }, DETAILS_REFRESH_MS);
  };

  const close = () => {
    state.close();
    clearTimeout(refreshTimer);
    refreshTimer = undefined;
    render();
  };
  closeBtn.addEventListener("click", close);
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && state.open) close();
  });

  return {
    state,
    close,
    lock(on) {
      arranging = on;
      if (on && state.open) close();
    },
    open(panel) {
      if (arranging) return;
      if (state.apply({ type: "open_panel", panel })) render();
      if (panel === "board") requestDetails();
    },
    openReport,
    handle(msg) {
      // Arranging the floor: a panel the server wants to open (the avatar arrived at some furniture) stays shut.
      if (arranging && msg.type === "open_panel") return;
      const changed = state.apply(msg);
      if (state.open === "build" && isBuilderMessage(msg)) scheduleBuildRefresh();
      if (state.open === "board") {
        if (msg.type === "open_panel" || msg.type === "job_update") requestDetails();
        else if (msg.type === "work") scheduleRefresh();
      }
      if (changed) render();
    },
  };
}
