import { Application } from "pixi.js";
import { PALETTE } from "./palette.ts";
import { ProceduralSprites } from "./scene/textures.ts";
import { WorldView } from "./scene/world-view.ts";
import { LiveTransport } from "./transport.ts";
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
import { createYourTurnToast } from "./ui/toast.ts";

const WORLD_URL = import.meta.env["VITE_WORLD_URL"] ?? "ws://127.0.0.1:8787";

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

const transport = new LiveTransport(WORLD_URL);
const sprites = new ProceduralSprites(app.renderer);

const hud = createHud(
  { left: shell.topLeft, right: shell.topRight, banners: shell.banners, stage: stageEl },
  () => {
    hud.setZoomLabel(world.toggleZoom());
  },
  () => guide.open(),
  theme,
  () => transport.reconnect(),
);
const world = new WorldView(app, sprites, (msg) => transport.send(msg), {
  onError: (code, message) => hud.toast(code === "no_path" ? "Can't get there." : message),
  tooltip: createTooltip(stageEl),
  onZoomChange: (z) => hud.setZoomLabel(z),
});
hud.setZoomLabel(world.zoom);

const mailbox = new MailboxState();

const panels = createPanels(
  (msg) => transport.send(msg),
  () => turn.update(mailbox.pendingCount, panels.state.open),
  stageEl,
);
const guide = createGuide(undefined, stageEl);
const terminal = createTerminal(shell);
theme.onChange(() => shell.refresh());
const teamBar = createTeamBar((id) => world.focusAgent(id), shell);

/** Opens the mailbox from the toast or the stepper: no walking, the client already holds the data. */
function openMailbox(): void {
  if (mailbox.apply({ type: "open_panel", panel: "mailbox" }, panels.state.open)) {
    world.setMailboxBadge(mailbox.pendingCount, mailbox.unseenReport);
  }
  panels.open("mailbox");
}
const stepper = createStepper(openMailbox, shell.topCentre, () => panels.open("board"));
const turn = createYourTurnToast(openMailbox, shell.banners);

transport.onStatus((s) => hud.setStatus(s));
transport.onMessage((msg) => {
  world.handle(msg);
  if (mailbox.apply(msg, panels.state.open)) {
    world.setMailboxBadge(mailbox.pendingCount, mailbox.unseenReport);
  }
  panels.handle(msg);
  teamBar.handle(msg);
  turn.update(mailbox.pendingCount, panels.state.open);
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
