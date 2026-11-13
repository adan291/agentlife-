import { LEVEL_MAX, levelText, projectIdOfRoom, xpForLevel } from "@agentlife/shared";
import type { EntityView, MemberView, ProgressView, ServerMsg, StaffId } from "@agentlife/shared";
import { formatDuration } from "./duration.ts";

/** "Lv 3 · 20 XP to Lv 4". At the last level: "Lv 50 · top level". */
export function levelLine(v: Pick<EntityView, "level" | "xp" | "next">): string {
  if (v.next === undefined) return `${levelText(v.level)} · top level`;
  return `${levelText(v.level)} · ${v.next - v.xp} XP to ${levelText(Math.min(LEVEL_MAX, v.level + 1))}`;
}

/** "4 jobs, 75% passed, avg step 42s". Parts that are not known yet are left out. */
export function statsLine(v: Pick<EntityView, "jobs" | "passRate" | "avgStepMs" | "steps">): string {
  const parts: string[] = [];
  if (v.jobs > 0) parts.push(`${v.jobs} ${v.jobs === 1 ? "job" : "jobs"}`);
  if (v.passRate !== undefined) parts.push(`${Math.round(v.passRate * 100)}% passed`);
  if (v.avgStepMs !== undefined) parts.push(`avg step ${formatDuration(v.avgStepMs)}`);
  if (parts.length === 0) return v.steps > 0 ? `${v.steps} ${v.steps === 1 ? "step" : "steps"} done` : "No work yet";
  return parts.join(", ");
}

/** The two lines of a tooltip or a card: where the level stands, and the stats. */
export function progressLines(v: EntityView): string[] {
  return [`${levelLine(v)} (${v.xp} XP)`, statsLine(v)];
}

/** Toast of a level-up: "Developer reached Lv 3", "You reached Lv 2". */
export function levelUpText(who: "user" | "member", name: string, level: number): string {
  return `${who === "user" ? "You" : name} reached ${levelText(level)}`;
}

/**
 * What the client knows of levels: the latest `progress`, the floor the user is on and who holds each spot of it
 * (`team_view`). A tooltip or the team bar asks it for the numbers of a ghost. Pure.
 */
export class ProgressModel {
  state: ProgressView | null = null;
  private roomId: string | undefined;
  /** Member id at each spot of the current floor, from `team_view`. */
  private readonly seats = new Map<StaffId, string>();

  /** Feed every server message. Returns true when something the level texts show changed. */
  apply(msg: ServerMsg): boolean {
    switch (msg.type) {
      case "welcome":
        this.roomId = msg.roomId ?? msg.room.id;
        this.seats.clear();
        return true;
      case "progress":
        this.state = msg.state;
        return true;
      case "team_view": {
        if (msg.roomId !== this.roomId) return false;
        this.seats.clear();
        for (const m of msg.members) if (m.memberId) this.seats.set(m.agentId, m.memberId);
        for (const g of msg.guests ?? []) if (g.memberId) this.seats.set(g.guestId, g.memberId);
        return true;
      }
      default:
        return false;
    }
  }

  /** The user, or undefined when the hotel has no progress (scripted engine, recorded demo). */
  user(): EntityView | undefined {
    return this.state?.user;
  }

  member(projectId: string, memberId: string): MemberView | undefined {
    return this.state?.members.find((m) => m.projectId === projectId && m.memberId === memberId);
  }

  /** A member with no record yet has done no work: level 0. Undefined when the hotel has no progress. */
  memberOrNew(projectId: string, memberId: string): MemberView | undefined {
    if (!this.state) return undefined;
    return this.member(projectId, memberId) ?? { projectId, memberId, xp: 0, level: 0, base: 0, next: xpForLevel(1), jobs: 0, passed: 0, steps: 0, badges: [] };
  }

  /**
   * The member who stands at a spot of the user's floor. Without a `team_view` (the scripted engine has no HR office) the
   * desks belong to the role's default member, whose id is the role name, as the server counts them.
   */
  ofSlot(slot: StaffId): MemberView | undefined {
    const projectId = this.roomId === undefined ? undefined : projectIdOfRoom(this.roomId);
    const memberId = this.seats.get(slot) ?? (isDesk(slot) ? slot : undefined);
    if (projectId === undefined || memberId === undefined) return undefined;
    return this.memberOrNew(projectId, memberId);
  }
}

function isDesk(slot: StaffId): slot is "architect" | "developer" | "qa" {
  return slot === "architect" || slot === "developer" || slot === "qa";
}
