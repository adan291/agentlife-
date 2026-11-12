import { Container, Graphics, Text } from "pixi.js";
import { FURNI_CATALOG, HEIGHT_UNIT, projectIdOfRoom, tileToScreen } from "@agentlife/shared";
import type { RoomDef } from "@agentlife/shared";
import { PALETTE } from "../palette.ts";
import { labelStyle } from "./label-style.ts";

export interface SignSpec {
  itemId: string;
  /** Sanitised by the server (`signText`) and cut to a short length here as well. */
  text: string;
}

/** Longest name drawn on a sign, in characters. */
export const SIGN_MAX_CHARS = 16;

/** Drawn above every piece of furniture, so a bookshelf or the elevator's own top never hides the name. */
export const SIGN_LAYER_Z = 999_999_999;

/** Project names fit over a door: longer names are cut with an ellipsis. */
export function signLabel(name: string): string {
  const clean = name.trim();
  return clean.length <= SIGN_MAX_CHARS ? clean : `${clean.slice(0, SIGN_MAX_CHARS - 1)}…`;
}

/**
 * Where a project's name is written: one plaque over the elevator (the door of the floor). The board got a sign
 * too at first, but it sits behind the bookshelf and the name looked like loose text on the wall.
 * The lobby and the HR office have no project name; they get no signs.
 */
export function signsFor(room: RoomDef): SignSpec[] {
  if (projectIdOfRoom(room.id) === undefined) return [];
  const text = signLabel(room.name);
  if (text === "") return [];
  return room.furni
    .filter((p) => FURNI_CATALOG[p.defId]?.interaction === "elevator")
    .map((p) => ({ itemId: p.itemId, text }));
}

/** The signs as plaques above their furniture, in scene coordinates. `heightAt` gives the floor height of a tile. */
export function buildSigns(room: RoomDef, heightAt: (x: number, y: number) => number): Container {
  const layer = new Container();
  layer.zIndex = SIGN_LAYER_Z;
  for (const sign of signsFor(room)) {
    const placed = room.furni.find((p) => p.itemId === sign.itemId);
    const def = placed ? FURNI_CATALOG[placed.defId] : undefined;
    if (!placed || !def) continue;
    const p = tileToScreen({ x: placed.x, y: placed.y, z: heightAt(placed.x, placed.y) });
    const label = new Text({ text: sign.text, style: labelStyle(11, PALETTE.pumpkin), resolution: 2 });
    label.anchor.set(0.5, 0.5);
    const w = Math.ceil(label.width) + 12;
    const h = Math.ceil(label.height) + 4;
    const plaque = new Graphics()
      .roundRect(-w / 2, -h / 2, w, h, 3)
      .fill({ color: PALETTE.tagBg, alpha: 0.92 })
      .stroke({ color: PALETTE.tagBorder, width: 1 });
    const holder = new Container();
    holder.addChild(plaque, label);
    holder.position.set(p.sx, p.sy - def.height * HEIGHT_UNIT - h / 2 - 6);
    layer.addChild(holder);
  }
  return layer;
}
