import { Application } from "pixi.js";
import { PALETTE } from "./palette.ts";
import { ProceduralSprites } from "./scene/textures.ts";
import { WorldView } from "./scene/world-view.ts";
import { LiveTransport } from "./transport.ts";
import { createHud } from "./ui/hud.ts";
import { createPanels } from "./ui/panels.ts";
import { MailboxState } from "./ui/mailbox-state.ts";
import { createTooltip } from "./ui/tooltip.ts";

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

const hud = createHud(() => {
  hud.setZoomLabel(world.toggleZoom());
});
const world = new WorldView(app, sprites, (msg) => transport.send(msg), {
  onError: (code, message) => hud.toast(code === "no_path" ? "Can't get there." : message),
  tooltip: createTooltip(),
});
hud.setZoomLabel(world.zoom);

const panels = createPanels((msg) => transport.send(msg));
const mailbox = new MailboxState();

transport.onStatus((s) => hud.setStatus(s));
transport.onMessage((msg) => {
  world.handle(msg);
  if (mailbox.apply(msg, panels.state.open)) {
    world.setMailboxBadge(mailbox.pendingCount, mailbox.unseenReport);
    hud.setNotice(mailbox.pendingCount > 0 ? "Plan waiting for your approval" : null);
  }
  panels.handle(msg);
  if (msg.type === "welcome") hud.setZoomLabel(world.zoom);
});

app.ticker.add(() => world.tick(Date.now()));
