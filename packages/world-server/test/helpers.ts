import { Hotel } from "@agentlife/shared";
import type { RoomId } from "@agentlife/shared";
import { loadHotelRooms } from "../src/load-room.ts";
import type { LayoutStore } from "../src/layout-store.ts";

export interface TestHotelOptions {
  /** Room where the user starts. Default: the lobby. */
  start?: RoomId;
  /** Ids of the projects that already have a floor (named after their id). */
  projects?: string[];
  /** Saved layouts the floors are built with. */
  layouts?: Pick<LayoutStore, "get">;
}

/** The real room files with fast walking. */
export function testHotel(opts: TestHotelOptions = {}): Hotel {
  const layouts = opts.layouts;
  const hotel = new Hotel({
    ...loadHotelRooms(),
    clock: Date.now,
    sim: { msPerTile: 5 },
    ...(opts.start ? { startRoom: opts.start } : {}),
    ...(layouts ? { layoutOf: (id: string) => layouts.get(id) } : {}),
  });
  for (const id of opts.projects ?? []) hotel.addProject({ id, name: id });
  return hotel;
}
