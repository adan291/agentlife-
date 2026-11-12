import type { ClientMsg, PanelName, ServerMsg } from "@agentlife/shared";
import { createComputerPanel } from "./computer.ts";
import type { PanelContent } from "./computer.ts";
import { createKindPanel } from "./kind-forms.ts";
import type { KindFormActions } from "./kind-forms.ts";
import { renderJobPanel } from "./job-panel.ts";
import { renderMailbox } from "./mailbox.ts";
import { renderFloorList } from "./elevator.ts";
import { BUILD_EVENT_REFRESH_MS, BUILD_REFRESH_MS, isBuilderMessage, renderBuildBoard, renderBuildReport } from "./build-board.ts";
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
};

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
  const computer = createComputerPanel(document, { startJob: (repoId, goal) => send({ type: "start_job", repoId, goal }) }, hooks.lockedGoal);
  const kindActions: KindFormActions = {
    startJob: (repoId, goal, kind, target) => send({ type: "start_job", repoId, goal, kind, target }),
  };
  const locked = hooks.lockedGoal !== undefined;
  const kindPanels = {
    review: createKindPanel(document, "review-branch", kindActions, locked),
    tests: createKindPanel(document, "write-tests", kindActions, locked),
    library: createKindPanel(document, "document", kindActions, locked),
  };
  const reception = createReceptionPanel(document, {
    register: (body) => send({ type: "register_project", ...body }),
    remove: (projectId) => send({ type: "remove_project", projectId }),
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
  const render = () => {
    syncBuildTimers();
    if (!state.open) {
      root.hidden = true;
      onChange();
      return;
    }
    const wasHidden = root.hidden;
    root.hidden = false;
    title.textContent = TITLES[state.open];
    root.setAttribute("aria-label", TITLES[state.open]);
    root.dataset["wide"] = String(state.open === "board" || state.open === "build" || (state.open === "mailbox" && state.viewing !== null));
    const content: PanelContent =
      state.open === "computer"
        ? computer(state.data, state.engineError)
        : state.open === "review" || state.open === "tests" || state.open === "library"
          ? kindPanels[state.open](state.data, state.engineError)
          : state.open === "reception"
          ? reception(state.data, { registration: state.registration, engineError: state.engineError, locked: hooks.projectsLocked }, render)
          : state.open === "mailbox"
            ? {
                body: renderMailbox(
                  document,
                  state.data,
                  {
                    decide: (approvalId, decision) => send({ type: "approve", approvalId, decision }),
                    openReport: (reportId) => openReport(reportId),
                    deliver: (taskId) => send({ type: "deliver", taskId }),
                    back: () => {
                      state.back();
                      render();
                    },
                  },
                  { reading: state.viewing, unread: hooks.unreadReports?.() ?? new Set() },
                ),
              }
            : state.open === "elevator"
              ? { body: renderFloorList(document, state.floors, state.roomId, { go: (roomId) => hooks.goTo?.(roomId) }) }
              : state.open === "directory"
                ? { body: renderFloorList(document, state.floors, state.roomId) }
                : state.open === "build"
                  ? { body: renderBuild() }
                  : state.open === "door"
                  ? { body: doorNote(document) }
                  : {
                      body: renderJobPanel(document, state.data, state.viewing, {
                        view: (artifactId) => {
                          state.view(artifactId);
                          render();
                        },
                        back: () => {
                          state.back();
                          render();
                        },
                      }),
                    };
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
    if (state.open !== "mailbox") state.apply({ type: "open_panel", panel: "mailbox" });
    state.view(reportId);
    hooks.onReportOpened?.(reportId);
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
    open(panel) {
      if (state.apply({ type: "open_panel", panel })) render();
      if (panel === "board") requestDetails();
    },
    openReport,
    handle(msg) {
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
