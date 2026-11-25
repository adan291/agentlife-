// The HR office and the people at the desks: who sits where on each project floor, ghosts walking in and out when the
// team changes, and the HR desk's actions.
import type { WebSocket } from "ws";
import { GUEST_IDS, HR_ROOM, KIRO_PROVIDER, SEATED_ROLES, projectIdOfRoom, projectRoomId, providerModelLabel } from "@agentlife/shared";
import type { GuestId, HrAction, ProjectRole, SeatedRole, ServerMsg, TeamMember, TeamRole } from "@agentlife/shared";
import { errorText } from "../context.ts";
import type { GatewayContext, Handlers } from "../context.ts";
import type { OutfitsFeature } from "./outfits.ts";

interface Seat {
  memberId: string;
  name: string;
  model?: string;
  role: TeamRole;
}
/** A desk of a role, or a standing spot (`guest1`..`guest6`). */
export type SlotId = SeatedRole | GuestId;
export const SLOTS: readonly SlotId[] = [...SEATED_ROLES, ...GUEST_IDS];
const isGuestSlot = (slot: SlotId): slot is GuestId => (GUEST_IDS as readonly string[]).includes(slot);
/** Desks always have an entry (the room label when nobody was hired); a spot has one only while somebody stands there. */
type Seats = Map<SlotId, Seat>;

/** The label the room uses for a desk nobody was hired for. */
const DEFAULT_SEAT_NAME: Record<SeatedRole, string> = { architect: "Architect", developer: "Developer", qa: "QA" };
/** Where a member who holds no desk likes to stand: near the desk of their own role, else by the middle of the room. */
const SPOT_PREFERENCE: Record<TeamRole, readonly GuestId[]> = {
  architect: ["guest1", "guest5", "guest6"],
  developer: ["guest2", "guest5", "guest6"],
  qa: ["guest3", "guest4", "guest6"],
  reviewer: ["guest5", "guest6", "guest4"],
  researcher: ["guest6", "guest5", "guest1"],
};

/** Time a ghost needs to walk to a place, from the `walk` message the sim answered with. */
const walkMs = (msgs: readonly ServerMsg[]): number => {
  const w = msgs.find((m) => m.type === "walk");
  return w && w.type === "walk" ? w.path.length * w.msPerTile : 0;
};

export function createTeam(ctx: GatewayContext, outfits: Pick<OutfitsFeature, "pruneTeam">) {
  const { hotel, engine, send, sendError } = ctx;
  /** Who works each desk according to the engine, and who the room shows (a ghost that is being replaced keeps its name until the new one walks in). */
  const seatsNow = new Map<string, Seats>();
  const seatsShown = new Map<string, Seats>();
  /** `<roomId>|<slot>` of the ghosts that have left by the elevator and are not back yet. */
  const absent = new Set<string>();
  const swapTimers = new Set<NodeJS.Timeout>();

  /** Labels of the AI providers (multi-runtime), learnt from the engine; a member's seat shows "model (Label)". */
  const providerLabels = new Map<string, string>();
  const learnProviders = (list: readonly { id: string; label: string }[] | undefined): void => {
    for (const p of list ?? []) providerLabels.set(p.id, p.label);
  };
  void engine?.hr?.providers?.().then(learnProviders, () => undefined);

  /** "qwen3.5:4b (Ollama)" for a member on another AI provider than Kiro (multi-runtime), the plain model otherwise. */
  const modelLabel = (m: TeamMember): string =>
    m.provider && m.provider !== KIRO_PROVIDER ? providerModelLabel(m.model, providerLabels.get(m.provider) ?? m.provider) : m.model;

  /**
   * The seats for a team: the first member of each seated role holds that role's desk, every other member stands at a
   * spot (hr-desk requirement 4.3: everybody hired is on the floor). A member keeps the spot they had (`previous`).
   */
  const seatsOf = (members: readonly TeamMember[], previous?: Seats): Seats => {
    const out: Seats = new Map();
    const seated = new Set<string>();
    for (const role of SEATED_ROLES) {
      const m = members.find((x) => x.role === role);
      if (m) seated.add(m.id);
      out.set(role, m ? { memberId: m.id, name: m.displayName, model: modelLabel(m), role } : { memberId: "", name: DEFAULT_SEAT_NAME[role], role });
    }
    const seatOf = (m: TeamMember): Seat => ({ memberId: m.id, name: m.displayName, model: modelLabel(m), role: m.role });
    const others = members.filter((m) => !seated.has(m.id));
    for (const spot of GUEST_IDS) {
      const kept = previous?.get(spot);
      const m = kept ? others.find((x) => x.id === kept.memberId) : undefined;
      if (m) out.set(spot, seatOf(m));
    }
    const placed = new Set([...out.values()].map((s) => s.memberId));
    for (const m of others) {
      if (placed.has(m.id)) continue;
      const spot = [...SPOT_PREFERENCE[m.role], ...GUEST_IDS].find((g) => !out.has(g));
      if (spot) out.set(spot, seatOf(m)); // a team has at most 8 members and 2 or more hold desks: there is always a spot
    }
    return out;
  };

  const teamViewMsg = (projectId: string): ServerMsg | undefined => {
    const shown = seatsShown.get(projectId);
    if (!shown) return undefined;
    return {
      type: "team_view",
      roomId: projectRoomId(projectId),
      members: SEATED_ROLES.map((role) => {
        const s = shown.get(role)!;
        return { agentId: role, name: s.name, ...(s.model ? { model: s.model } : {}), memberId: s.memberId || role };
      }),
      guests: GUEST_IDS.flatMap((guestId) => {
        const s = shown.get(guestId);
        return s ? [{ guestId, name: s.name, role: s.role, ...(s.model ? { model: s.model } : {}), memberId: s.memberId }] : [];
      }),
    };
  };

  /** Queued behind the walks and presence messages already waiting, so a ghost is told where it is before it is shown. */
  const pushTeamView = (projectId: string): void => {
    ctx.enqueue(() => {
      const msg = teamViewMsg(projectId);
      if (msg) ctx.toUser(projectRoomId(projectId), msg);
    });
  };

  /** Somebody new takes a spot (or comes back to a desk): they walk in from the elevator to their place. */
  const walkIn = (projectId: string, slot: SlotId): void => {
    const roomId = projectRoomId(projectId);
    const back = hotel.sim(roomId)?.sendAgentTo(slot, "home") ?? [];
    ctx.deliver(roomId, [{ type: "agent_presence", agentId: slot, present: true }, ...back]);
  };

  /**
   * The ghost at this desk or spot was let go (or replaced): it walks to the elevator and leaves; its successor, if
   * there is one, comes back through it. A spot nobody takes stays empty.
   */
  const startSwap = (projectId: string, slot: SlotId): void => {
    const roomId = projectRoomId(projectId);
    const key = `${roomId}|${slot}`;
    if (absent.has(key)) return; // the coming-back step reads the newest team
    absent.add(key);
    const out = hotel.sim(roomId)?.sendAgentTo(slot, "door") ?? [];
    ctx.deliver(roomId, [...out, { type: "agent_presence", agentId: slot, present: false }]);
    const timer = setTimeout(
      () => {
        swapTimers.delete(timer);
        ctx.enqueue(() => {
          absent.delete(key);
          const seat = seatsNow.get(projectId)?.get(slot);
          if (seat) {
            seatsShown.get(projectId)?.set(slot, seat);
            walkIn(projectId, slot);
          } else {
            seatsShown.get(projectId)?.delete(slot);
          }
          pushTeamView(projectId);
        });
      },
      walkMs(out) + 700,
    );
    timer.unref();
    swapTimers.add(timer);
  };

  /**
   * Reads a project's team and shows it in the room: names and models on the ghosts, and, when `announce` is set and
   * somebody else now sits at a desk, the old ghost leaves and the new one walks in. Members at the spots always walk
   * in and out (they have no job to keep still for). Never throws.
   */
  const refreshTeam = async (projectId: string, announce: boolean): Promise<void> => {
    const hr = engine?.hr;
    if (!hr || !hotel.has(projectRoomId(projectId))) return;
    let team;
    try {
      team = await hr.team(projectId);
    } catch {
      return;
    }
    const next = seatsOf(team.members, seatsNow.get(projectId));
    seatsNow.set(projectId, next);
    outfits.pruneTeam(projectId, new Set(team.members.map((m) => m.id)));
    const shown = seatsShown.get(projectId);
    if (!shown) {
      seatsShown.set(projectId, new Map(next));
      for (const slot of GUEST_IDS) if (next.has(slot)) walkIn(projectId, slot);
    } else {
      for (const slot of SLOTS) {
        const n = next.get(slot);
        const s = shown.get(slot);
        if (!isGuestSlot(slot)) {
          if (n!.memberId === s!.memberId || !announce) shown.set(slot, n!);
          else startSwap(projectId, slot);
        } else if (n && s && n.memberId === s.memberId) {
          shown.set(slot, n);
        } else if (n && s) {
          startSwap(projectId, slot); // somebody else takes the spot
        } else if (n) {
          if (!absent.has(`${projectRoomId(projectId)}|${slot}`)) {
            shown.set(slot, n);
            walkIn(projectId, slot);
          }
        } else if (s) {
          startSwap(projectId, slot); // let go
        }
      }
    }
    pushTeamView(projectId);
  };

  /** Every ghost that is on a floor now: the desk roles and the team members at the spots, not those who left by the elevator. */
  const ghostsOn = (roomId: string): SlotId[] => {
    const projectId = projectIdOfRoom(roomId);
    const shown = projectId === undefined ? undefined : seatsShown.get(projectId);
    const here = (slot: SlotId): boolean => !absent.has(`${roomId}|${slot}`);
    return [...SEATED_ROLES.filter(here), ...GUEST_IDS.filter((g) => shown?.has(g) === true && here(g))];
  };

  /** Who holds a role's desk in a project: the member's id (the role name when nobody was hired) and name. Never throws. */
  const seatOfRole = async (projectId: string, role: ProjectRole): Promise<{ id: string; name: string }> => {
    let seats = seatsNow.get(projectId);
    if (!seats && engine?.hr) {
      try {
        seats = seatsOf((await engine.hr.team(projectId)).members); // read once, not shown in the room
      } catch {
        seats = undefined;
      }
    }
    const seat = seats?.get(role);
    return { id: seat?.memberId || role, name: seat?.name ?? DEFAULT_SEAT_NAME[role as SeatedRole] };
  };

  /** The ghost a member stands as on the floor the user is on, so the level-up effect can play over it. */
  const slotOfMember = (projectId: string, memberId: string): SlotId | undefined => {
    if (ctx.userRoom() !== projectRoomId(projectId)) return undefined;
    for (const [slot, seat] of seatsShown.get(projectId) ?? []) if ((seat.memberId || seat.role) === memberId) return slot;
    return undefined;
  };

  /** A project floor shows who sits at each desk, and keeps the ghosts that have left by the elevator out of the room. */
  const welcome = (ws: WebSocket, roomId: string): void => {
    const projectId = projectIdOfRoom(roomId);
    if (projectId === undefined || !engine?.hr) return;
    for (const slot of SLOTS) if (absent.has(`${roomId}|${slot}`)) send(ws, { type: "agent_presence", agentId: slot, present: false });
    const view = teamViewMsg(projectId);
    if (view) send(ws, view);
    ctx.enqueue(() => refreshTeam(projectId, false));
  };

  const sendHr = async (ws: WebSocket): Promise<void> => {
    if (!engine?.hr) return sendError(ws, "engine_unavailable", "the HR office needs the real engine");
    try {
      const state = await engine.hr.state();
      learnProviders(state.providers);
      send(ws, { type: "hr", state });
    } catch (e) {
      sendError(ws, "engine_unavailable", errorText(e, "cannot read the HR desk"));
    }
  };

  /** Runs one HR action for the user in the HR office, then sends the desk's new state. */
  const hrAct = async (ws: WebSocket, act: HrAction): Promise<void> => {
    const hr = engine?.hr;
    if (!hr) return sendError(ws, "engine_unavailable", "the HR office needs the real engine");
    if (ctx.userRoom() !== HR_ROOM) return sendError(ws, "bad_message", "the HR desk is in the HR office");
    try {
      // Know who sits at the desks before the change, so a change of person can be shown.
      if (act.action === "hire" || act.action === "update" || act.action === "fire" || act.action === "apply") await refreshTeam(act.projectId, false);
      switch (act.action) {
        case "hire":
          await hr.hire(act.projectId, {
            templateId: act.templateId,
            displayName: act.displayName,
            ...(act.model ? { model: act.model } : {}),
            ...(act.provider ? { provider: act.provider } : {}),
          });
          await refreshTeam(act.projectId, true);
          break;
        case "update":
          await hr.update(act.projectId, act.memberId, {
            ...(act.displayName === undefined ? {} : { displayName: act.displayName }),
            ...(act.model === undefined ? {} : { model: act.model }),
            ...(act.provider === undefined ? {} : { provider: act.provider }),
          });
          await refreshTeam(act.projectId, true);
          break;
        case "fire":
          await hr.fire(act.projectId, act.memberId);
          await refreshTeam(act.projectId, true);
          break;
        case "import":
          await hr.importTemplate(act.url);
          break;
        case "approve_import":
          await hr.approveImport(act.id, act.hash);
          break;
        case "reject_import":
          await hr.rejectImport(act.id);
          break;
        case "suggest": {
          send(ws, { type: "hr_suggestion", suggestion: await hr.suggest(act.projectId) });
          return;
        }
        case "apply":
          // Each pick is a hire; the member it replaces leaves afterwards, so the team never lacks a role.
          try {
            for (const pick of act.picks) {
              await hr.hire(act.projectId, { templateId: pick.templateId, displayName: pick.displayName, model: pick.model });
              if (pick.replacesId) await hr.fire(act.projectId, pick.replacesId);
            }
          } finally {
            await refreshTeam(act.projectId, true);
          }
          break;
      }
    } catch (e) {
      sendError(ws, "hr_error", errorText(e, "the HR desk could not do that"));
    }
    await sendHr(ws);
  };

  const handlers: Handlers = {
    hr_state: (_msg, { ws }) => void sendHr(ws),
    hr_do: (msg, { ws }) => void hrAct(ws, msg.act),
  };

  return {
    sendHr,
    ghostsOn,
    seatOfRole,
    slotOfMember,
    welcome,
    handlers,
    close: () => {
      for (const t of swapTimers) clearTimeout(t);
    },
  };
}
export type TeamFeature = ReturnType<typeof createTeam>;
