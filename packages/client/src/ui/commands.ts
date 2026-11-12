import type { FloorStatus, OverviewFloor } from "@agentlife/shared";
import { JOB_CHOICES, sortFloors } from "./list-model.ts";
import type { ListActions } from "./list-view.ts";

export interface Command {
  id: string;
  /** What the palette searches and shows. */
  title: string;
  /** Key shown on the right when the command has one. */
  shortcut?: string;
  run(): void;
}

export interface CommandContext {
  /** The overview of the project floors; null before the first one arrived or when the list is unavailable (demo). */
  floors: readonly OverviewFloor[] | null;
  /** Every floor of the hotel (lobby and HR office included), for "Go to". */
  hotelFloors: readonly FloorStatus[];
  /** False in the recorded demo: only "Go to" and "Toggle view" work there. */
  live: boolean;
  actions: ListActions;
  toggleView(): void;
}

export const TOGGLE_VIEW_SHORTCUT = "L";

/**
 * The commands of the palette, from what the hotel looks like now. Every command that does work calls the same
 * `ListActions` as the buttons of the list, which send the messages of the hotel furniture (list-mode, 3.1).
 */
export function buildCommands(ctx: CommandContext): Command[] {
  const out: Command[] = [];
  const rows = ctx.live && ctx.floors ? sortFloors(ctx.floors) : [];

  for (const f of rows) {
    if (f.waiting > 0) out.push({ id: `approve:${f.roomId}`, title: `Approve plan in ${f.name}`, run: () => ctx.actions.reviewPlan(f.roomId) });
  }
  for (const f of rows) {
    for (const choice of JOB_CHOICES) {
      out.push({ id: `new:${choice.kind}:${f.roomId}`, title: `New ${choice.name} job in ${f.name}`, run: () => ctx.actions.newJob(f.roomId, choice) });
    }
  }
  for (const f of rows) {
    const last = f.lastReport;
    if (last) out.push({ id: `report:${f.roomId}`, title: `Open report of ${f.name}`, run: () => ctx.actions.openReport(f.roomId, last.reportId) });
  }
  for (const f of ctx.hotelFloors) {
    out.push({ id: `go:${f.roomId}`, title: `Go to ${f.name}`, run: () => ctx.actions.goTo(f.roomId) });
  }
  if (ctx.live) out.push({ id: "night", title: "Schedule night job", run: () => ctx.actions.scheduleNight() });
  out.push({ id: "toggle-view", title: "Toggle view", shortcut: TOGGLE_VIEW_SHORTCUT, run: ctx.toggleView });
  return out;
}
