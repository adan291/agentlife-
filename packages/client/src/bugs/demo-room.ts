import { FURNI_CATALOG } from "@agentlife/shared";
import type { RoomDef } from "@agentlife/shared";

/**
 * The room without the bug jar. The jar opens the Bug sack, which needs the live hotel, so the recorded demo draws its lobby
 * without one (spec bug-sack, requirement 6.4).
 */
export function withoutBugJar(room: RoomDef): RoomDef {
  return { ...room, furni: room.furni.filter((p) => FURNI_CATALOG[p.defId]?.interaction !== "bugs") };
}
