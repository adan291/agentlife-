import { Container, Graphics, Text } from "pixi.js";
import { PALETTE } from "../palette.ts";
import { attentionLift, bounceOffset } from "./glow.ts";

/** Round badge above the mailbox: pending approvals as a number, an unread report as a dot. */
export class MailboxBadge {
  readonly container = new Container();
  private readonly bg = new Graphics();
  private readonly text = new Text({
    text: "",
    style: { fontFamily: "monospace", fontSize: 12, fill: PALETTE.tagBg, fontWeight: "bold" },
    resolution: 2,
  });
  private readonly dotGfx = new Graphics();
  private count = 0;
  private dot = false;
  private readonly baseY: number;

  /** `x`,`y`: screen position just above the top of the mailbox. */
  constructor(x: number, y: number) {
    this.baseY = y;
    this.container.position.set(x, y);
    this.container.zIndex = 1_000_000;
    this.text.anchor.set(0.5);
    this.container.addChild(this.bg, this.text, this.dotGfx);
    this.container.visible = false;
  }

  set(count: number, dot: boolean): void {
    if (count === this.count && dot === this.dot) return;
    this.count = count;
    this.dot = dot;
    this.bg.clear();
    this.dotGfx.clear();
    this.text.visible = count > 0;
    if (count > 0) {
      this.text.text = count > 9 ? "9+" : String(count);
      this.bg.circle(0, 0, 10).fill(PALETTE.pumpkin).stroke({ color: PALETTE.tagBg, width: 2 });
      // Unread report next to a count: small dot on the corner.
      if (dot) this.dotGfx.circle(9, -9, 5).fill(PALETTE.purple).stroke({ color: PALETTE.tagBg, width: 1.5 });
    } else if (dot) {
      this.dotGfx.circle(0, 0, 6).fill(PALETTE.purple).stroke({ color: PALETTE.tagBg, width: 2 });
    }
    this.container.visible = count > 0 || dot;
  }

  update(now: number, reduced: boolean, attentionSince: number | null = null): void {
    if (!this.container.visible) return;
    this.container.y = this.baseY + (this.count > 0 ? bounceOffset(now, reduced) : 0) + attentionLift(now, attentionSince, reduced);
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
