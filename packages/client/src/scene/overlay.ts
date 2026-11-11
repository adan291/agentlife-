import { Container, Graphics, Sprite, Text } from "pixi.js";
import type { AgentState } from "@agentlife/shared";
import { PALETTE } from "../palette.ts";
import { bubbleTextStyle, labelStyle } from "./label-style.ts";
import type { SpriteProvider } from "./textures.ts";
import { bubbleDurationMs, shortStatus } from "./timing.ts";
import { prefersReducedMotion } from "./glow.ts";
import { WorkingFx } from "./working-fx.ts";

function label(text: string, size: number, fill: number): Text {
  return new Text({ text, style: labelStyle(size, fill), resolution: 2 });
}

/** Name tag, status badge and speech bubble that float above one avatar. */
export class AvatarOverlay {
  readonly container = new Container();
  private readonly badgeRow = new Container();
  private readonly badgeSprite = new Sprite();
  private readonly badgeText = label("", 11, PALETTE.text);
  private readonly badgeBg = new Graphics();
  private readonly bubble = new Container();
  private readonly tag = new Container();
  private bubbleUntil = 0;
  private state: AgentState | null = null;
  /** Sign of the state above the ghost (thought cloud, candle, envelope, ...). Only agents have one. */
  private readonly fx: WorkingFx | null;
  private readonly reducedMotion = prefersReducedMotion();

  constructor(
    private name: string,
    private readonly colour: number,
    private readonly sprites: SpriteProvider,
    hasStatus: boolean,
  ) {
    this.container.addChild(this.tag);
    this.drawTag();
    this.fx = hasStatus ? new WorkingFx() : null;
    if (this.fx) this.container.addChild(this.fx.container);

    if (hasStatus) {
      this.badgeRow.position.set(0, -84);
      this.badgeText.position.set(10, -7);
      this.badgeRow.addChild(this.badgeBg, this.badgeSprite, this.badgeText);
      this.badgeRow.visible = false;
      this.container.addChild(this.badgeRow);
    }
    this.bubble.visible = false;
    this.container.addChild(this.bubble);
  }

  private drawTag(): void {
    for (const c of this.tag.removeChildren()) c.destroy({ children: true });
    const text = label(this.name, 11, this.colour);
    const padX = 6;
    const padY = 2;
    const bg = new Graphics()
      .roundRect(0, 0, text.width + padX * 2, text.height + padY * 2, 4)
      .fill({ color: PALETTE.tagBg, alpha: 0.9 })
      .stroke({ color: this.colour, width: 1, alpha: 0.8 });
    text.position.set(padX, padY);
    this.tag.addChild(bg, text);
    this.tag.position.set(-bg.width / 2, -66 - bg.height / 2);
  }

  /** Change the name tag text (the Builder shows its session label). */
  setName(name: string): void {
    if (name === this.name) return;
    this.name = name;
    this.drawTag();
  }

  /** Update the badge icon and short text. Takes effect on the next frame at the latest. */
  setState(state: AgentState, text?: string): void {
    this.state = state;
    this.fx?.setState(state, Date.now());
    const frame = this.sprites.badge(state);
    this.badgeSprite.texture = frame.texture;
    this.badgeSprite.anchor.set(frame.anchor.x, frame.anchor.y);
    const short = text ? shortStatus(text) : state.replace("_", " ");
    this.badgeText.text = short;
    const w = 20 + this.badgeText.width + 4;
    this.badgeBg.clear().roundRect(-10, -10, w, 20, 10).fill({ color: PALETTE.tagBg, alpha: 0.85 });
    // Centre the whole row over the avatar.
    this.badgeRow.pivot.x = (w - 20) / 2;
    this.badgeRow.visible = true;
  }

  get currentState(): AgentState | null {
    return this.state;
  }

  say(text: string, now: number): void {
    this.bubble.removeChildren().forEach((c) => c.destroy({ children: true }));
    const t = new Text({ text, style: bubbleTextStyle(11, 170), resolution: 2 });
    const padX = 8;
    const padY = 5;
    const w = t.width + padX * 2;
    const h = t.height + padY * 2;
    const bg = new Graphics()
      .roundRect(0, 0, w, h, 6)
      .fill({ color: PALETTE.bubbleBg, alpha: 0.97 })
      .stroke({ color: PALETTE.purple, width: 1 });
    const tail = new Graphics().poly([w / 2 - 5, h - 0.5, w / 2 + 5, h - 0.5, w / 2, h + 6]).fill(PALETTE.bubbleBg);
    t.position.set(padX, padY);
    this.bubble.addChild(bg, tail, t);
    // Bottom of the bubble (tail tip) sits above the badge row.
    this.bubble.position.set(-w / 2, -96 - h - 6);
    this.bubble.visible = true;
    this.bubbleUntil = now + bubbleDurationMs(text);
  }

  get bubbleVisible(): boolean {
    return this.bubble.visible;
  }

  update(now: number, feetX: number, feetY: number): void {
    this.container.position.set(Math.round(feetX), Math.round(feetY));
    this.fx?.update(now, this.reducedMotion);
    if (this.bubble.visible && now >= this.bubbleUntil) this.bubble.visible = false;
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
