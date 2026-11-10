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
import { createStepper } from "./ui/stepper.ts";
import { createTeamBar } from "./ui/team-bar.ts";
import { createYourTurnToast } from "./ui/toast.ts";

const WORLD_URL = import.meta.env["VITE_WORLD_URL"] ?? "ws://127.0.0.1:8787";

const app = new Application();
await app.init({
  resizeTo: window,
  background: PALETTE.background,
  antialias: false,
  resolution: window.devicePixelRatio || 1,
  autoDensity: true,
});
document.body.appendChild(app.canvas);

const transport = new LiveTransport(WORLD_URL);
const sprites = new ProceduralSprites(app.renderer);

const theme = createTheme();
const hud = createHud(
  () => {
    hud.setZoomLabel(world.toggleZoom());
  },
  () => guide.open(),
  theme,
  () => transport.reconnect(),
);
const world = new WorldView(app, sprites, (msg) => transport.send(msg), {
  onError: (code, message) => hud.toast(code === "no_path" ? "Can't get there." : message),
  tooltip: createTooltip(),
});
hud.setZoomLabel(world.zoom);

const mailbox = new MailboxState();

const panels = createPanels(
  (msg) => transport.send(msg),
  () => turn.update(mailbox.pendingCount, panels.state.open),
);
const guide = createGuide();
const terminal = createTerminal();
theme.onChange(() => terminal.refresh());
const teamBar = createTeamBar((id) => world.focusAgent(id));

/** Opens the mailbox from the toast or the stepper: no walking, the client already holds the data. */
function openMailbox(): void {
  if (mailbox.apply({ type: "open_panel", panel: "mailbox" }, panels.state.open)) {
    world.setMailboxBadge(mailbox.pendingCount, mailbox.unseenReport);
  }
  panels.open("mailbox");
}
const stepper = createStepper(openMailbox);
const turn = createYourTurnToast(openMailbox);

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
