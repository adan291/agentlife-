import { Container, Text } from "pixi.js";
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

/** Project names fit over a door: longer names are cut with an ellipsis. */
export function signLabel(name: string): string {
  const clean = name.trim();
  return clean.length <= SIGN_MAX_CHARS ? clean : `${clean.slice(0, SIGN_MAX_CHARS - 1)}…`;
}

/**
 * Where a project's name is written: over the elevator (the door of the floor) and over the board.
 * The lobby and the HR office have no project name; they get no signs.
 */
export function signsFor(room: RoomDef): SignSpec[] {
  if (projectIdOfRoom(room.id) === undefined) return [];
  const text = signLabel(room.name);
  if (text === "") return [];
  return room.furni
    .filter((p) => {
      const interaction = FURNI_CATALOG[p.defId]?.interaction;
      return interaction === "elevator" || interaction === "board";
    })
    .map((p) => ({ itemId: p.itemId, text }));
}

/** The signs as text objects above their furniture, in scene coordinates. `heightAt` gives the floor height of a tile. */
export function buildSigns(room: RoomDef, heightAt: (x: number, y: number) => number): Container {
  const layer = new Container();
  for (const sign of signsFor(room)) {
    const placed = room.furni.find((p) => p.itemId === sign.itemId);
    const def = placed ? FURNI_CATALOG[placed.defId] : undefined;
    if (!placed || !def) continue;
    const p = tileToScreen({ x: placed.x, y: placed.y, z: heightAt(placed.x, placed.y) });
    const label = new Text({ text: sign.text, style: labelStyle(12, PALETTE.text), resolution: 2 });
    label.anchor.set(0.5, 1);
    label.position.set(p.sx, p.sy - def.height * HEIGHT_UNIT - 4);
    label.zIndex = 1_000_000;
    layer.addChild(label);
  }
  layer.sortableChildren = true;
  return layer;
}
