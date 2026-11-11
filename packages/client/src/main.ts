import { Application } from "pixi.js";
import { RunExportSchema, validateRoom } from "@agentlife/shared";
import type { RoomDef, RunExport } from "@agentlife/shared";
import { PALETTE } from "./palette.ts";
import { DEMO_RUN_PATH, assetUrl, currentMode } from "./mode.ts";
import { ReplayTransport } from "./replay/transport.ts";
import { ProceduralSprites } from "./scene/textures.ts";
import { WorldView } from "./scene/world-view.ts";
import { LiveTransport } from "./transport.ts";
import type { Transport } from "./transport.ts";
import { createReplayBar } from "./ui/replay-bar.ts";
import { createHud } from "./ui/hud.ts";
import { createPanels } from "./ui/panels.ts";
import { createGuide } from "./ui/guide.ts";
import { MailboxState } from "./ui/mailbox-state.ts";
import { createTerminal } from "./ui/terminal.ts";
import { createTheme } from "./ui/theme.ts";
import { createTooltip } from "./ui/tooltip.ts";
import { createShell } from "./ui/shell.ts";
import { createStepper } from "./ui/stepper.ts";
import { createTeamBar } from "./ui/team-bar.ts";
import { createToasts } from "./ui/toast.ts";
import { reportVerdict } from "./ui/report-viewer.ts";

/**
 * True when the bundle was built with `VITE_MODE=demo`. Vite replaces the value at build time, so the live branch
 * below (LiveTransport, the world-server URL) is removed from a demo build (checked by `pnpm check:demo-build`).
 */
const DEMO_BUILD = import.meta.env.VITE_MODE === "demo";

/** Loads the recorded run (from the client's own static files, under any base path) and the room to play it in. */
async function loadDemo(): Promise<[RunExport, RoomDef]> {
  const res = await fetch(assetUrl(DEMO_RUN_PATH));
  if (!res.ok) throw new Error(`cannot load the recorded run (${res.status})`);
  const exp = RunExportSchema.parse(await res.json());
  const { default: officeJson } = await import("../../world-server/rooms/office.json");
  return [exp, validateRoom(officeJson)];
}

const theme = createTheme();
const shell = createShell({ getLineHeight: () => Math.round(theme.size * 1.5) });
const stageEl = shell.stage;

const app = new Application();
await app.init({
  width: Math.max(1, Math.floor(stageEl.clientWidth)),
  height: Math.max(1, Math.floor(stageEl.clientHeight)),
  background: PALETTE.background,
  antialias: false,
  resolution: window.devicePixelRatio || 1,
  autoDensity: true,
});
stageEl.appendChild(app.canvas);

/** The canvas follows the stage cell, not the window: the browser lays the cell out, we only read its size. */
function fitCanvasToStage(): void {
  const w = Math.max(1, Math.floor(stageEl.clientWidth));
  const h = Math.max(1, Math.floor(stageEl.clientHeight));
  if (w !== app.screen.width || h !== app.screen.height) app.renderer.resize(w, h);
}
new ResizeObserver(fitCanvasToStage).observe(stageEl);

const mode = currentMode();
/** Live connection (live mode only): the "Use here" button reconnects it. */
let live: LiveTransport | undefined;
/** Replay of the recorded run (demo mode only). In demo mode no `LiveTransport` is ever built. */
let replay: ReplayTransport | undefined;
let transport: Transport;
if (DEMO_BUILD || mode === "demo") {
  const [exp, room] = await loadDemo();
  replay = new ReplayTransport(exp, room);
  transport = replay;
  if (new URLSearchParams(location.search).has("autostart")) {
    // `?autostart` starts the recorded run as soon as the room is up (smoke test, screen recordings). Deferred so
    // every listener has seen the `welcome` first.
    const player = replay;
    const stop = player.onMessage((m) => {
      if (m.type !== "welcome") return;
      stop();
      setTimeout(() => player.send({ type: "start_job", repoId: player.recordedRepoId, goal: player.recordedGoal }), 0);
    });
  }
} else {
  live = new LiveTransport(import.meta.env.VITE_WORLD_URL ?? "ws://127.0.0.1:8787");
  transport = live;
}
const sprites = new ProceduralSprites(app.renderer);

const hud = createHud(
  { left: shell.topLeft, right: shell.topRight, banners: shell.banners, stage: stageEl },
  () => {
    hud.setZoomLabel(world.toggleZoom());
  },
  () => guide.open(),
  theme,
  () => live?.reconnect(),
);
const world = new WorldView(app, sprites, (msg) => transport.send(msg), {
  onError: (code, message) => hud.toast(code === "no_path" ? "Can't get there." : message),
  tooltip: createTooltip(stageEl),
  onZoomChange: (z) => hud.setZoomLabel(z),
});
hud.setZoomLabel(world.zoom);

const mailbox = new MailboxState();

/** Toasts follow the pending approvals, the unread reports and the open panel; call after any of them changes. */
function refreshToasts(): void {
  const id = mailbox.latestUnread();
  const report = id ? panels.state.data.reports.find((r) => r.reportId === id) : undefined;
  toasts.update({
    pending: mailbox.pendingCount,
    openPanel: panels.state.open,
    unreadReport: report ? { reportId: report.reportId, verdict: reportVerdict(report) } : undefined,
  });
}

const panels = createPanels((msg) => transport.send(msg), refreshToasts, stageEl, {
  unreadReports: () => mailbox.unreadIds(),
  onReportOpened: (id) => void mailbox.markRead(id),
  ...(replay
    ? {
        lockedGoal: replay.recordedGoal,
        projectsLocked: "This is a recorded run, so the Reception is read-only here. On your computer you can register your own projects.",
      }
    : {}),
});
const replayBar = replay ? createReplayBar(shell.banners, replay, replay.recordedAt) : undefined;
const guide = createGuide(undefined, stageEl);
const terminal = createTerminal(shell);
theme.onChange(() => shell.refresh());
const teamBar = createTeamBar((id) => world.focusAgent(id), shell);

/** Clears the mailbox dot: the user is looking at the mailbox now. */
function seeMailbox(): void {
  if (mailbox.apply({ type: "open_panel", panel: "mailbox" }, panels.state.open)) {
    world.setMailboxBadge(mailbox.pendingCount, mailbox.unseenReport);
  }
}

/** Opens the mailbox from the toast or the stepper: no walking, the client already holds the data. */
function openMailbox(): void {
  seeMailbox();
  panels.open("mailbox");
}
const stepper = createStepper(openMailbox, shell.topCentre, () => panels.open("board"));
theme.onChange(() => stepper.refresh());
const toasts = createToasts(
  {
    openMailbox,
    openReport: (id) => {
      seeMailbox();
      panels.openReport(id);
    },
  },
  shell.banners,
);

transport.onStatus((s) => hud.setStatus(s));
transport.onMessage((msg) => {
  // Before the mailbox state sees it: a report that arrives now is news, a re-sent one is not.
  const delivered = msg.type === "report" && mailbox.isFresh(msg);
  world.handle(msg);
  if (mailbox.apply(msg, panels.state.open)) {
    world.setMailboxBadge(mailbox.pendingCount, mailbox.unseenReport);
  }
  panels.handle(msg);
  teamBar.handle(msg);
  replayBar?.handle(msg);
  if (delivered) world.notifyReportDelivered();
  refreshToasts();
  if (msg.type === "welcome") {
    hud.setZoomLabel(world.zoom);
    terminal.seed(msg.activity ?? []);
    stepper.update(null);
  } else if (msg.type === "activity") {
    terminal.push(msg.line);
  } else if (msg.type === "job_update") {
    stepper.update(msg.job);
  }
});

app.ticker.add(() => world.tick(Date.now()));
