import { Hotel } from "@agentlife/shared";
import type { RoomId } from "@agentlife/shared";
import { loadHotelRooms } from "../src/load-room.ts";

export interface TestHotelOptions {
  /** Room where the user starts. Default: the lobby. */
  start?: RoomId;
  /** Ids of the projects that already have a floor (named after their id). */
  projects?: string[];
}

/** The real room files with fast walking. */
export function testHotel(opts: TestHotelOptions = {}): Hotel {
  const hotel = new Hotel({ ...loadHotelRooms(), clock: Date.now, sim: { msPerTile: 5 }, ...(opts.start ? { startRoom: opts.start } : {}) });
  for (const id of opts.projects ?? []) hotel.addProject({ id, name: id });
  return hotel;
}
