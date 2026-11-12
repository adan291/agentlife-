import type { OverviewFloor } from "@agentlife/shared";
import { JOB_CHOICES, jobLine, nightCount, reportLine, sortFloors, statusLine, stepsOf, waitingBadge } from "./list-model.ts";
import type { JobChoice } from "./list-model.ts";
import { stepIcon, stepNote } from "./stepper.ts";
import { UI_COLOURS } from "./theme.ts";

/** What the list can do. Each one moves to the project's floor first when the user is elsewhere (see `actions.ts`). */
export interface ListActions {
  newJob(roomId: string, choice: JobChoice): void;
  /** Opens the mailbox with the plan that waits (approve or reject there). */
  reviewPlan(roomId: string): void;
  openReport(roomId: string, reportId: string): void;
  openJobCard(roomId: string): void;
  goTo(roomId: string): void;
  scheduleNight(): void;
}

export interface ListData {
  /** Null until the first `overview` arrived. */
  floors: readonly OverviewFloor[] | null;
  now: number;
  /** Why the list is not available (the recorded demo), shown instead of the rows. */
  locked: string | null;
}

const CSS = `
.al-list { position: absolute; inset: 0; z-index: 5; overflow: auto; box-sizing: border-box; padding: var(--al-s3) var(--al-s4); background: ${UI_COLOURS.inputBg}; color: ${UI_COLOURS.text}; font: var(--al-font, 14px)/1.5 monospace; }
.al-list[hidden] { display: none; }
.al-list-head { display: flex; align-items: center; justify-content: space-between; gap: var(--al-s3); margin: 0 auto var(--al-s3); max-width: 960px; }
.al-list-head h2 { margin: 0; font: inherit; font-weight: bold; color: ${UI_COLOURS.accentText}; }
.al-list-rows { list-style: none; margin: 0 auto; padding: 0; max-width: 960px; }
.al-list-row { border: 1px solid var(--al-border); border-radius: var(--al-radius); background: ${UI_COLOURS.panelBg}; margin: 0 0 var(--al-s2); padding: var(--al-s2) var(--al-s3); }
.al-list-row[data-status="waiting_approval"] { border-color: var(--al-accent); }
.al-list-line { display: flex; flex-wrap: wrap; align-items: center; gap: var(--al-s2) var(--al-s3); }
.al-list-name { font-weight: bold; min-width: 8ch; }
.al-list-chip { padding: 0 var(--al-s2); border: 1px solid var(--al-control); border-radius: var(--al-radius); color: ${UI_COLOURS.muted}; white-space: nowrap; }
.al-list-chip[data-status="working"], .al-list-chip[data-status="queued"] { color: ${UI_COLOURS.accentText}; }
.al-list-chip[data-status="failed"] { color: ${UI_COLOURS.error}; border-color: ${UI_COLOURS.error}; }
.al-list-badge { padding: 0 var(--al-s2); border-radius: var(--al-radius); background: var(--al-accent); color: ${UI_COLOURS.inputBg}; font-weight: bold; white-space: nowrap; }
.al-list-job { flex: 1 1 18ch; min-width: 0; overflow-wrap: anywhere; }
.al-list-meta { display: flex; flex-wrap: wrap; gap: var(--al-s1) var(--al-s4); color: ${UI_COLOURS.muted}; margin-top: var(--al-s1); }
.al-list-meta [data-verdict="fail"] { color: ${UI_COLOURS.error}; }
.al-list-meta [data-verdict="pass"] { color: ${UI_COLOURS.add}; }
.al-list-actions { display: flex; flex-wrap: wrap; gap: var(--al-s2); margin-top: var(--al-s2); }
.al-list-detail { margin-top: var(--al-s2); padding-top: var(--al-s2); border-top: 1px solid var(--al-border); }
.al-list-steps { list-style: none; margin: 0 0 var(--al-s2); padding: 0; display: flex; flex-wrap: wrap; gap: var(--al-s1) var(--al-s3); }
.al-list-steps [data-status="done"] .al-list-step-icon { color: ${UI_COLOURS.add}; }
.al-list-steps [data-status="current"] { color: ${UI_COLOURS.accentText}; font-weight: bold; }
.al-list-steps [data-status="failed"] { color: ${UI_COLOURS.error}; }
.al-list-steps [data-status="pending"] { color: ${UI_COLOURS.muted}; }
.al-list-empty { max-width: 960px; margin: var(--al-s4) auto; color: ${UI_COLOURS.muted}; }
.al-shell[data-view="list"] .al-stage > canvas { visibility: hidden; }
`;

export function listCss(): string {
  return CSS;
}

const SCHEDULE_HINT = "Open the night board in the lobby to schedule a job for the night";

/**
 * The list of projects. Pure of state: it renders what it is given, and the caller keeps `expanded` between renders.
 * One row per project floor, rows that need the user first.
 */
export function renderList(doc: Document, data: ListData, expanded: ReadonlySet<string>, actions: ListActions, toggle: (roomId: string) => void): HTMLElement {
  const root = doc.createElement("div");
  const head = doc.createElement("div");
  head.className = "al-list-head";
  const title = doc.createElement("h2");
  title.textContent = "Projects";
  const night = doc.createElement("button");
  night.type = "button";
  night.className = "al-btn";
  night.textContent = "Schedule night job";
  night.title = SCHEDULE_HINT;
  night.disabled = data.locked !== null;
  night.addEventListener("click", () => actions.scheduleNight());
  head.append(title, night);
  root.appendChild(head);

  const note = (text: string, role?: string): HTMLElement => {
    const p = doc.createElement("p");
    p.className = "al-list-empty";
    p.textContent = text;
    if (role) p.setAttribute("role", role);
    return p;
  };
  if (data.locked !== null) {
    root.appendChild(note(data.locked));
    return root;
  }
  if (data.floors === null) {
    root.appendChild(note("Loading the projects…", "status"));
    return root;
  }
  if (data.floors.length === 0) {
    root.appendChild(note("No projects yet. Register one at the Reception in the lobby (switch to the hotel view with L)."));
    return root;
  }

  const rows = doc.createElement("ul");
  rows.className = "al-list-rows";
  for (const floor of sortFloors(data.floors)) rows.appendChild(renderRow(doc, floor, data, expanded.has(floor.roomId), actions, toggle));
  root.appendChild(rows);
  return root;
}

function button(doc: Document, text: string, label: string, onClick: () => void): HTMLButtonElement {
  const b = doc.createElement("button");
  b.type = "button";
  b.className = "al-btn";
  b.textContent = text;
  b.title = label;
  b.setAttribute("aria-label", label);
  b.addEventListener("click", onClick);
  return b;
}

function renderRow(doc: Document, floor: OverviewFloor, data: ListData, open: boolean, actions: ListActions, toggle: (roomId: string) => void): HTMLElement {
  const li = doc.createElement("li");
  li.className = "al-list-row";
  li.dataset["status"] = floor.status;
  li.dataset["room"] = floor.roomId;

  const line = doc.createElement("div");
  line.className = "al-list-line";
  const name = doc.createElement("span");
  name.className = "al-list-name";
  name.textContent = floor.name;
  const chip = doc.createElement("span");
  chip.className = "al-list-chip";
  chip.dataset["status"] = floor.status;
  chip.textContent = statusLine(floor);
  line.append(name, chip);
  const waiting = waitingBadge(floor);
  if (waiting) {
    const badge = doc.createElement("span");
    badge.className = "al-list-badge";
    badge.textContent = waiting;
    line.appendChild(badge);
  }
  const job = doc.createElement("span");
  job.className = "al-list-job";
  job.textContent = jobLine(floor);
  line.appendChild(job);
  li.appendChild(line);

  const meta = doc.createElement("div");
  meta.className = "al-list-meta";
  const report = reportLine(floor, data.now);
  if (report) {
    const r = doc.createElement("span");
    r.textContent = report;
    if (floor.lastReport?.verdict) r.dataset["verdict"] = floor.lastReport.verdict;
    meta.appendChild(r);
  }
  const nights = nightCount(floor);
  if (nights > 0) {
    const n = doc.createElement("span");
    n.textContent = nights === 1 ? "1 night job scheduled" : `${nights} night jobs scheduled`;
    meta.appendChild(n);
  }
  if (meta.children.length > 0) li.appendChild(meta);

  const buttons = doc.createElement("div");
  buttons.className = "al-list-actions";
  if (floor.waiting > 0) buttons.appendChild(button(doc, "Review plan", `Review the plan of ${floor.name}: approve or reject it`, () => actions.reviewPlan(floor.roomId)));
  if (floor.lastReport) {
    const id = floor.lastReport.reportId;
    buttons.appendChild(button(doc, "Open report", `Open the latest report of ${floor.name}`, () => actions.openReport(floor.roomId, id)));
  }
  for (const choice of JOB_CHOICES) {
    buttons.appendChild(button(doc, `New ${choice.name}`, `Start a ${choice.name} job in ${floor.name}`, () => actions.newJob(floor.roomId, choice)));
  }
  const more = button(doc, open ? "Hide details" : "Details", `${open ? "Hide" : "Show"} the steps of ${floor.name}`, () => toggle(floor.roomId));
  more.setAttribute("aria-expanded", String(open));
  buttons.appendChild(more);
  li.appendChild(buttons);

  if (open) li.appendChild(renderDetail(doc, floor, actions));
  return li;
}

function renderDetail(doc: Document, floor: OverviewFloor, actions: ListActions): HTMLElement {
  const detail = doc.createElement("div");
  detail.className = "al-list-detail";
  const steps = stepsOf(floor);
  if (steps.length === 0) {
    const p = doc.createElement("p");
    p.className = "al-muted";
    p.textContent = "No job has run on this floor since the hotel started.";
    detail.appendChild(p);
  } else {
    const ol = doc.createElement("ol");
    ol.className = "al-list-steps";
    ol.setAttribute("aria-label", "Steps of the job");
    for (const s of steps) {
      const li = doc.createElement("li");
      li.dataset["status"] = s.status;
      const icon = doc.createElement("span");
      icon.className = "al-list-step-icon";
      icon.textContent = stepIcon(s.status);
      const note = stepNote(s);
      li.append(icon, doc.createTextNode(` ${s.label}${note ? ` ${note}` : ""}`));
      ol.appendChild(li);
    }
    detail.appendChild(ol);
  }
  const links = doc.createElement("div");
  links.className = "al-list-actions";
  if (floor.job) links.appendChild(button(doc, "Job card", `Open the job card of ${floor.name}: plan, diff, tests and review`, () => actions.openJobCard(floor.roomId)));
  const last = floor.lastReport;
  if (last) {
    links.appendChild(button(doc, "Report", `Open the report of ${floor.name}`, () => actions.openReport(floor.roomId, last.reportId)));
    if (last.delivery === "available") {
      links.appendChild(button(doc, "Deliver as branch", `Open the report of ${floor.name}, where the branch can be delivered`, () => actions.openReport(floor.roomId, last.reportId)));
    } else if (last.delivery === "done") {
      const p = doc.createElement("span");
      p.className = "al-muted";
      p.textContent = "Delivered as a branch";
      links.appendChild(p);
    }
  }
  links.appendChild(button(doc, "Go to floor", `Go to the floor of ${floor.name} in the hotel`, () => actions.goTo(floor.roomId)));
  detail.appendChild(links);
  return detail;
}

/** The list view in the stage: a container that re-renders when its data or the expanded rows change. */
export interface ListView {
  readonly root: HTMLElement;
  update(patch: Partial<ListData>): void;
  setVisible(visible: boolean): void;
  readonly visible: boolean;
}

export function createListView(doc: Document, host: HTMLElement, actions: ListActions, clock: () => number = Date.now): ListView {
  const style = doc.createElement("style");
  style.textContent = CSS;
  doc.head.appendChild(style);

  const root = doc.createElement("section");
  root.className = "al-list";
  root.setAttribute("aria-label", "Projects");
  root.hidden = true;
  host.appendChild(root);

  let data: ListData = { floors: null, now: clock(), locked: null };
  const expanded = new Set<string>();
  let visible = false;

  const render = (): void => {
    if (!visible) return;
    // Keep the reading position and the focused button's row when the data refreshes.
    const top = root.scrollTop;
    root.replaceChildren(
      renderList(doc, { ...data, now: clock() }, expanded, actions, (roomId) => {
        if (!expanded.delete(roomId)) expanded.add(roomId);
        render();
      }),
    );
    root.scrollTop = top;
  };

  return {
    root,
    get visible() {
      return visible;
    },
    update(patch) {
      // The server repeats an overview that did not change after a reconnect; a re-render would drop the focused button.
      const next = { ...data, ...patch };
      const same = JSON.stringify([next.floors, next.locked]) === JSON.stringify([data.floors, data.locked]);
      data = next;
      if (!same) render();
    },
    setVisible(v) {
      visible = v;
      root.hidden = !v;
      render();
    },
  };
}
