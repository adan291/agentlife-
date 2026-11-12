import { isGuestId } from "@agentlife/shared";
import type { GuestId, ServerMsg, StaffId, TeamViewGuest, TeamViewMember } from "@agentlife/shared";

/**
 * Who is on a project floor, as the world-server tells it (hr-desk requirement 4.3: every hired member is visible).
 * The three desks always have a ghost. The six standing spots (`guest1`..`guest6`) have an avatar in every room, but it
 * is shown only while `team_view` lists somebody there, and a ghost that was let go (`agent_presence` false) is hidden
 * once it has walked to the elevator. Pure: the world view only asks it what to show.
 */
export class FloorPeople {
  private members: TeamViewMember[] = [];
  private guests = new Map<GuestId, TeamViewGuest>();
  /** Ghosts told to leave by the elevator and not back yet. */
  private leaving = new Set<StaffId>();

  /** Follows the messages that change who is on the floor. Other messages are ignored. */
  apply(msg: ServerMsg): void {
    switch (msg.type) {
      case "welcome":
        this.members = [];
        this.guests.clear();
        this.leaving.clear();
        break;
      case "team_view":
        this.members = [...msg.members];
        this.guests = new Map((msg.guests ?? []).map((g) => [g.guestId, g]));
        break;
      case "agent_presence":
        if (msg.present) this.leaving.delete(msg.agentId);
        else this.leaving.add(msg.agentId);
        break;
      default:
        break;
    }
  }

  /** The member who stands at a guest spot, or undefined while the spot is empty. */
  guest(id: GuestId): TeamViewGuest | undefined {
    return this.guests.get(id);
  }

  /** Everybody who stands at a spot now, in spot order. */
  listedGuests(): TeamViewGuest[] {
    return [...this.guests.values()].sort((a, b) => a.guestId.localeCompare(b.guestId));
  }

  /** The member at a desk (`team_view` members). */
  member(id: StaffId): TeamViewMember | undefined {
    return this.members.find((m) => m.agentId === id);
  }

  /** Whether the avatar of this agent or spot is drawn now. `walking`: it is still on its way (to the elevator, for a ghost that left). */
  isShown(id: StaffId, walking: boolean): boolean {
    if (isGuestId(id) && !this.guests.has(id)) return false;
    return !(this.leaving.has(id) && !walking);
  }
}
