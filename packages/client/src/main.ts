import { Application, Text } from "pixi.js";
import { PROTOCOL_VERSION } from "@agentlife/shared";

const app = new Application();
await app.init({ resizeTo: window, background: 0x0b0a12, antialias: false });
document.body.appendChild(app.canvas);

const label = new Text({
  text: `AGENT LIFE — protocol v${PROTOCOL_VERSION}`,
  style: { fill: 0xb8a8ff, fontFamily: "monospace", fontSize: 16 },
});
label.position.set(16, 16);
app.stage.addChild(label);
