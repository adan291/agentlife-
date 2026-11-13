import { Application } from "pixi.js";
import { FURNI_CATALOG, RunExportSchema, levelText, validateRoom } from "@agentlife/shared";
import type { FloorStatus, OverviewFloor, RunExport, ServerMsg } from "@agentlife/shared";
import { PALETTE } from "./palette.ts";
import { DEMO_RUN_PATH, assetUrl, currentMode } from "./mode.ts";
import { ReplayTransport } from "./replay/transport.ts";
import type { ReplayRooms } from "./replay/transport.ts";
import { prefersReducedMotion } from "./scene/glow.ts";
import { ProceduralSprites } from "./scene/textures.ts";
import { createFurniPreviews } from "./scene/previews.ts";
import { WorldView } from "./scene/world-view.ts";
import { LiveTransport } from "./transport.ts";
import type { Transport } from "./transport.ts";
import { createReplayBar } from "./ui/replay-bar.ts";
import { createHud } from "./ui/hud.ts";
import { createPanels } from "./ui/panels.ts";
import { createNavigator } from "./ui/actions.ts";
import { buildCommands } from "./ui/commands.ts";
import { createCommandPalette } from "./ui/command-palette.ts";
import { createListActions } from "./ui/list-actions.ts";
import { createListView } from "./ui/list-view.ts";
import { loadView, otherView, saveView } from "./ui/view-mode.ts";
import type { ViewMode } from "./ui/view-mode.ts";
import { createGuide } from "./ui/guide.ts";
import { ArrangeModel, arrangeKey } from "./ui/arrange.ts";
import { createArrangeBar } from "./ui/arrange-bar.ts";
import { createArrangeTray } from "./ui/arrange-tray.ts";
import { MailboxState } from "./ui/mailbox-state.ts";
import { createTerminal } from "./ui/terminal.ts";
import { createTheme } from "./ui/theme.ts";
import { createTooltip } from "./ui/tooltip.ts";
import { createNightLook } from "./ui/night-look.ts";
import { createShell } from "./ui/shell.ts";
import { createStepper } from "./ui/stepper.ts";
import { createTeamBar } from "./ui/team-bar.ts";
import { createToasts } from "./ui/toast.ts";
import { createTransition } from "./ui/transition.ts";
import { elevatorLabel, floorTag, loadFloor, restoreTarget, saveFloor } from "./ui/floors.ts";
import { reportVerdict } from "./ui/report-viewer.ts";
import { GRANT_TOAST_MS, grantToastText } from "./ui/wallet.ts";
import { ProgressModel, levelUpText, progressLines } from "./ui/progress.ts";
import { createWispButton } from "./ui/wisp.ts";

/**
 * True when the bundle was built with `VITE_MODE=demo`. Vite replaces the value at build time, so the live branch
 * below (LiveTransport, the world-server URL) is removed from a demo build (checked by `pnpm check:demo-build`).
 */
const DEMO_BUILD = import.meta.env.VITE_MODE === "demo";

/** Loads the recorded run (from the client's own static files, under any base path) and the rooms of the hotel to play it in. */
async function loadDemo(): Promise<[RunExport, ReplayRooms]> {
  const res = await fetch(assetUrl(DEMO_RUN_PATH));
  if (!res.ok) throw new Error(`cannot load the recorded run (${res.status})`);
  const exp = RunExportSchema.parse(await res.json());
  const [{ default: lobby }, { default: hr }, { default: template }] = await Promise.all([
    import("../../world-server/rooms/lobby.json"),
    import("../../world-server/rooms/hr.json"),
    import("../../world-server/rooms/project-template.json"),
  ]);
  return [exp, { lobby: validateRoom(lobby), hr: validateRoom(hr), template: validateRoom(template) }];
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
  const [exp, rooms] = await loadDemo();
  replay = new ReplayTransport(exp, rooms);
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
/** Pictures of furniture for the shop panel and the inventory tray: the room's own sprites. */
const furniPreview = createFurniPreviews(sprites, app.renderer);

// ---- floors: where the user is, the floor list, the elevator and the remembered floor ----

/** Levels and stats of the user and the team (team-progress); empty in the recorded demo and with the scripted engine. */
const progressModel = new ProgressModel();

/** Room the user is in, from the latest `welcome`. */
let currentRoom: string | undefined;
let currentRoomName = "";
let floorList: FloorStatus[] = [];
/** Item id of the elevator in the current room: the HUD shortcut walks the avatar there. */
let elevatorItemId: string | undefined;
/**
 * Only a live connection remembers the floor; the demo always starts on the recorded floor.
 * sessionStorage: a reload of the same tab goes back to the floor, a new visit starts in the lobby.
 */
const floorStorage = live && typeof sessionStorage !== "undefined" ? sessionStorage : undefined;
// Older builds kept the floor in localStorage; drop it so it cannot linger.
try {
  if (typeof localStorage !== "undefined") localStorage.removeItem("agentlife-floor");
} catch {
  // Storage blocked: nothing to clean.
}
/** The floor the user was on before the page was loaded; they go back there once the floor list is known. */
let rememberedFloor: string | null = live ? loadFloor(floorStorage) : null;
let restored = !live;
let restoreTimer: ReturnType<typeof setTimeout> | undefined;
/** After this long the remembered floor is dropped (it was removed, or the engine never listed it). */
const RESTORE_GIVE_UP_MS = 3000;

const hud = createHud(
  { left: shell.topLeft, right: shell.topRight, banners: shell.banners, stage: stageEl },
  () => {
    hud.setZoomLabel(world.toggleZoom());
  },
  () => guide.open(),
  theme,
  () => live?.reconnect(),
  () => {
    // The elevator can be used only from its door: walk there, the panel opens on arrival.
    if (elevatorItemId) transport.send({ type: "use", itemId: elevatorItemId });
    else hud.toast("There is no elevator on this floor.");
  },
  () => toggleView(),
  () => openPalette(),
  () => toggleArrange(),
  () => panels.open("profile"),
);
const world = new WorldView(app, sprites, (msg) => transport.send(msg), {
  progressLines: (slot) => {
    const v = progressModel.ofSlot(slot);
    return v ? progressLines(v) : [];
  },
  // A refused move is explained in the arrange bar, with the red tiles; a toast on top would say it twice.
  onError: (code, message) => {
    // The inventory tray asks for the shop too; a closed shop is already said by the empty tray.
    if (code !== "layout_error" && !(code === "shop_error" && arranging)) hud.toast(code === "no_path" ? "Can't get there." : message);
  },
  tooltip: createTooltip(stageEl),
  onZoomChange: (z) => hud.setZoomLabel(z),
});
hud.setZoomLabel(world.zoom);

const transition = createTransition(stageEl, prefersReducedMotion);
const nightLook = createNightLook(stageEl, shell.topLeft);
/** The button over the wisp that the server made appear (waiting-fun); it follows the wisp every frame. */
const wispButton = createWispButton(document, stageEl, (wispId) => transport.send({ type: "wisp_catch", wispId }));

/** The user picked a floor in the elevator panel. */
function goTo(roomId: string): void {
  const target = floorList.find((f) => f.roomId === roomId);
  if (!target || roomId === currentRoom) return;
  panels.close();
  transition.begin(floorTag(floorList, roomId), target.name);
  transport.send({ type: "go_to", roomId });
}

function refreshElevator(): void {
  const label = elevatorLabel(floorList, currentRoom);
  hud.setElevatorLabel(label, label === "Elevator" ? undefined : "Other floors are waiting for you");
}

const mailbox = new MailboxState();

/** Toasts follow the pending approvals, the unread reports and the open panel; call after any of them changes. */
function refreshToasts(): void {
  const id = mailbox.latestUnread();
  const report = id ? panels.state.data.reports.find((r) => r.reportId === id) : undefined;
  toasts.update({
    pending: mailbox.pendingCount,
    openPanel: panels.state.open,
    unreadReport: report ? { reportId: report.reportId, verdict: reportVerdict(report), night: report.kind === "night" } : undefined,
  });
}

const panels = createPanels((msg) => transport.send(msg), refreshToasts, stageEl, {
  unreadReports: () => mailbox.unreadIds(),
  onReportOpened: (id) => void mailbox.markRead(id),
  goTo,
  hrThinking: () => world.setHrThinking(true),
  shopPreview: furniPreview,
  memberProgress: (projectId, memberId) => progressModel.memberOrNew(projectId, memberId),
  ...(replay
    ? {
        lockedGoal: replay.recordedGoal,
        projectsLocked: "This is a recorded run, so the Reception is read-only here. On your computer you can register your own projects.",
      }
    : {}),
});
const replayBar = replay ? createReplayBar(shell.banners, replay, replay.recordedAt) : undefined;
const guide = createGuide(undefined, stageEl);
const terminal = createTerminal(shell, {
  // "All floors" needs the other floors' lines: the server sends them only on request.
  onScope: (scope) => transport.send({ type: "activity_scope", scope }),
  floorName: (roomId) => floorList.find((f) => f.roomId === roomId)?.name,
});
theme.onChange(() => shell.refresh());
const teamBar = createTeamBar((id) => world.focusAgent(id), shell, (id) => progressModel.ofSlot(id));

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

// ---- list view and command palette (list-mode): the same hotel, without walking ----

const navigator = createNavigator({ send: (msg) => transport.send(msg), toast: (text) => hud.toast(text) });
const viewStorage = typeof localStorage !== "undefined" ? localStorage : undefined;
let view: ViewMode = loadView(viewStorage);
/** The latest overview of the project floors, or null before the first one (and always in the recorded demo). */
let overviewFloors: OverviewFloor[] | null = null;
const LIST_LOCKED = "The list view needs the live hotel. Run AGENT LIFE on your computer to use it.";

const listActions = createListActions({
  navigator,
  send: (msg) => transport.send(msg),
  hasReport: (reportId) => panels.state.data.reports.some((r) => r.reportId === reportId),
  openReport: (reportId) => panels.openReport(reportId),
  showHotel: () => setView("hotel"),
});
const listView = createListView(document, stageEl, listActions);
const palette = createCommandPalette(document, stageEl);
if (!live) listView.update({ locked: LIST_LOCKED });

function setView(next: ViewMode): void {
  view = next;
  shell.root.dataset["view"] = next;
  saveView(viewStorage, next);
  hud.setView(next);
  listView.setVisible(next === "list");
  if (next === "list") {
    panels.close();
    arrange.leave();
  }
}
function toggleView(): void {
  setView(otherView(view));
}
function openPalette(): void {
  palette.toggle(() =>
    buildCommands({ floors: overviewFloors, hotelFloors: floorList, live: live !== undefined, actions: listActions, toggleView }),
  );
}

// ---- arrange mode (furni-move): move and turn the furniture of a project floor ----

const arrange = new ArrangeModel((msg) => transport.send(msg));
const arrangeBar = createArrangeBar(document, stageEl, {
  rotate: () => arrange.rotate(),
  undo: () => arrange.undo(),
  pickUp: () => arrange.pickUp(),
  reset: () => arrange.resetLayout(),
  done: () => arrange.leave(),
});
const arrangeTray = createArrangeTray(document, stageEl, { carry: (itemId) => arrange.carry(itemId) }, { preview: furniPreview });
/** Whether the scene and the panels were last told that the user is arranging. */
let arranging = false;

/** The model changed: redraw the bar and the overlay, and switch the panels and the pointer when arranging starts or stops. */
function syncArrange(): void {
  const state = arrange.view();
  arrangeBar.update(state);
  arrangeTray.update(state);
  world.showArrange(arrange.overlay());
  // Only the live hotel can arrange; the recorded demo has no world-server to save a layout.
  hud.setArrange(live !== undefined && arrange.available, state.active);
  if (state.active === arranging) return;
  arranging = state.active;
  panels.lock(arranging);
  world.setArrangeInput(
    arranging
      ? { down: (itemId, tile) => arrange.pointerDown(itemId, tile), move: (tile) => arrange.pointerMove(tile), up: () => arrange.pointerUp(), leave: () => arrange.pointerLeave() }
      : null,
  );
}
arrange.subscribe(syncArrange);

function toggleArrange(): void {
  if (arrange.isActive) {
    arrange.leave();
    return;
  }
  if (live === undefined || !arrange.available) {
    hud.toast("You can arrange the furniture of a project floor.");
    return;
  }
  if (view === "list") setView("hotel");
  arrange.enter();
  // The inventory tray lists what the user bought: ask for the stock (the answer is the same `shop` message the panel uses).
  transport.send({ type: "shop_state" });
}

window.addEventListener("keydown", (e) => {
  if (!arrange.isActive) return;
  const key = arrangeKey(e);
  if (!key) return;
  e.preventDefault();
  if (key.kind === "step") arrange.step(key.dx, key.dy);
  else if (key.kind === "rotate") arrange.rotate();
  else if (key.kind === "undo") arrange.undo();
  else arrange.escape();
});
// The remembered view is applied only now: switching to the list leaves arrange mode, which must exist by then.
setView(view);

/** A new `welcome`: the user is in a (possibly other) room. */
function enteredRoom(msg: Extract<ServerMsg, { type: "welcome" }>): void {
  const previous = currentRoom;
  currentRoom = msg.roomId ?? msg.room.id;
  currentRoomName = msg.room.name;
  // A new room (or the same one after a reconnect): arrange mode stops, and the model learns the room's pieces.
  arrange.setRoom(msg.room);
  elevatorItemId = msg.room.furni.find((p) => FURNI_CATALOG[p.defId]?.interaction === "elevator")?.itemId;
  hud.setFloor(currentRoomName);
  refreshElevator();
  terminal.setRoom(currentRoom);
  // The doors show the floor's indicator and open; a floor change the user did not start (a door, a removed floor) closes them first.
  if (previous !== undefined && previous !== currentRoom && view === "hotel") transition.arrive(floorTag(floorList, currentRoom), currentRoomName);
  else transition.abort();
  if (restored && floorStorage) saveFloor(floorStorage, currentRoom);
  // The server forgets the terminal scope with every connection, and the terminal was reseeded with this floor only.
  if (terminal.model.scope === "all") transport.send({ type: "activity_scope", scope: "all" });
}

/** The floor list arrived or changed. The first one decides whether to go back to the floor remembered from last time. */
function floorsChanged(floors: FloorStatus[]): void {
  floorList = floors;
  refreshElevator();
  if (restored) return;
  const target = restoreTarget(rememberedFloor, currentRoom, floors);
  if (target) {
    restored = true;
    clearTimeout(restoreTimer);
    goTo(target);
  } else if (rememberedFloor === null || rememberedFloor === currentRoom) {
    restored = true;
    clearTimeout(restoreTimer);
    if (currentRoom) saveFloor(floorStorage, currentRoom);
  } else {
    // The remembered floor is not in the list (yet). The engine may still be listing projects; give it a moment.
    restoreTimer ??= setTimeout(() => {
      restored = true;
      if (currentRoom) saveFloor(floorStorage, currentRoom);
    }, RESTORE_GIVE_UP_MS);
  }
}

transport.onStatus((s) => {
  hud.setStatus(s);
  // A new connection starts without the overview: ask for it for the whole session, so the palette has its data at once.
  if (s === "open" && live) transport.send({ type: "overview_watch", on: true });
  // A new connection starts in the lobby again: go back to the floor the user was on.
  if (s === "open" && live && currentRoom !== undefined) {
    rememberedFloor = loadFloor(floorStorage);
    restored = false;
    clearTimeout(restoreTimer);
    restoreTimer = undefined;
  }
});
transport.onMessage((msg) => {
  // Before the mailbox state sees it: a report that arrives now is news, a re-sent one is not.
  const delivered = msg.type === "report" && mailbox.isFresh(msg);
  world.handle(msg);
  // Before the team bar and the panels: they read the levels through the model.
  progressModel.apply(msg);
  // Arranging: a panel the server opens stays shut, so the mailbox must not count it as seen either.
  const blocked = arranging && msg.type === "open_panel";
  if (!blocked && mailbox.apply(msg, panels.state.open)) {
    world.setMailboxBadge(mailbox.pendingCount, mailbox.unseenReport);
  }
  panels.handle(msg);
  teamBar.handle(msg);
  replayBar?.handle(msg);
  if (delivered) world.notifyReportDelivered();
  refreshToasts();
  navigator.handle(msg);
  if (msg.type === "welcome") {
    hud.setZoomLabel(world.zoom);
    terminal.seed(msg.activity ?? []);
    stepper.update(null);
    enteredRoom(msg);
  } else if (msg.type === "floors") {
    floorsChanged(msg.floors);
  } else if (msg.type === "overview") {
    overviewFloors = msg.floors;
    listView.update({ floors: msg.floors });
  } else if (msg.type === "night_clock") {
    nightLook.set(msg);
    world.setNight(msg.open);
  } else if (msg.type === "wallet") {
    hud.setBalance(msg.balance);
    if (msg.grant) hud.toast(grantToastText(msg.grant), GRANT_TOAST_MS);
  } else if (msg.type === "progress") {
    hud.setLevel(levelText(msg.state.user.level), progressLines(msg.state.user).join(" · "));
  } else if (msg.type === "level_up") {
    hud.toast(levelUpText(msg.who, msg.name, msg.level), GRANT_TOAST_MS);
    if (msg.slot) world.levelUp(msg.slot);
  } else if (msg.type === "badge_earned") {
    hud.toast(msg.who === "user" ? `Badge earned: ${msg.badge}` : `${msg.owner} earned a badge: ${msg.badge}`, GRANT_TOAST_MS);
  } else if (msg.type === "activity") {
    terminal.push(msg.line);
  } else if (msg.type === "job_update") {
    stepper.update(msg.job);
  } else if (msg.type === "error" && msg.code === "layout_error") {
    arrange.onRefused(msg.message);
  } else if (msg.type === "room_layout") {
    if (msg.roomId === currentRoom) arrange.onLayout(msg.furni, msg.anchors);
  } else if (msg.type === "shop") {
    arrange.onShop(msg.state);
  } else if (msg.type === "error" && msg.code === "bad_message") {
    // A refused floor change (not at the elevator, floor gone): the doors open again on the same floor.
    transition.abort();
  }
});

app.ticker.add(() => {
  world.tick(Date.now());
  wispButton.sync(world.wispPoint());
});
