import { OUTFIT_SLOTS, projectIdOfRoom, wornKey } from "@agentlife/shared";
import type { AvatarId, Outfit, OutfitPart, ServerMsg, StaffId, WardrobeState, WornState } from "@agentlife/shared";
import { lookPart } from "./outfit.ts";
import type { OutfitLook } from "./outfit.ts";

/** What the avatar `id` wears on the floor `roomId`: the user's own outfit, a team member's, or nothing (the Builder, the HR ghost, a spot nobody stands at). */
export function outfitOfAvatar(
  book: OutfitBook,
  people: { memberIdOf(id: StaffId): string | undefined },
  roomId: string | null,
  id: AvatarId,
): Outfit | undefined {
  if (typeof id === "number") return book.forUser();
  const project = roomId === null ? undefined : projectIdOfRoom(roomId);
  if (project === undefined) return undefined;
  const member = people.memberIdOf(id);
  return member === undefined ? undefined : book.forMember(project, member);
}

/**
 * What the client knows about outfits (ghost-skins): the parts and the ones the user owns (`wardrobe`) and what the user
 * and each team member wear (`outfits`). The scene and the panels read it; it never draws. Without the two messages (the
 * recorded demo, a hotel without a wardrobe) it is empty and everybody keeps the default look.
 */
export class OutfitBook {
  private state: WardrobeState | null = null;
  private worn: WornState | null = null;
  private readonly members = new Map<string, Outfit>();

  /** Follows the messages that carry outfits. Returns true when something it holds changed. Other messages are ignored. */
  apply(msg: ServerMsg): boolean {
    if (msg.type === "wardrobe") {
      this.state = msg.state;
      return true;
    }
    if (msg.type === "outfits") {
      this.worn = msg.state;
      this.members.clear();
      for (const m of msg.state.members) this.members.set(wornKey(m.project, m.member), m.outfit);
      return true;
    }
    return false;
  }

  /** The parts, the owned ids and the balance; null while the server has not sent a wardrobe. */
  get wardrobe(): WardrobeState | null {
    return this.state;
  }

  /** True when the hotel has a wardrobe: the Look sections work. */
  get available(): boolean {
    return this.state !== null;
  }

  get parts(): readonly OutfitPart[] {
    return this.state?.parts ?? [];
  }

  /** What the user wears. */
  forUser(): Outfit {
    return this.worn?.user ?? {};
  }

  /** What a member of a project's team wears. */
  forMember(project: string, member: string): Outfit {
    return this.members.get(wornKey(project, member)) ?? {};
  }

  /** The outfit as the renderer wants it: the part ids resolved to their palettes. A part the book does not know is left out. */
  look(outfit: Outfit): OutfitLook | undefined {
    const look: OutfitLook = {};
    for (const slot of OUTFIT_SLOTS) {
      const id = outfit[slot];
      const part = id === undefined ? undefined : this.parts.find((p) => p.id === id && p.slot === slot);
      if (part) look[slot] = lookPart(part);
    }
    return Object.keys(look).length > 0 ? look : undefined;
  }
}
