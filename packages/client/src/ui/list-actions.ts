import { LOBBY_ROOM } from "@agentlife/shared";
import type { ClientMsg } from "@agentlife/shared";
import { showPanelMessage } from "./actions.ts";
import type { Navigator } from "./actions.ts";
import type { ListActions } from "./list-view.ts";

export interface ListActionDeps {
  navigator: Navigator;
  send(msg: ClientMsg): void;
  /** Whether the client already holds this report of the floor it is on. */
  hasReport(reportId: string): boolean;
  /** Opens the report in the mailbox viewer. */
  openReport(reportId: string): void;
  /** Back to the isometric view (the user asked to go to a floor). */
  showHotel(): void;
}

/**
 * What the list and the command palette do. Each action is "move, then open the furniture's panel": the panel then
 * sends the same message as in the hotel (`start_job`, `approve`, `deliver`, `night_add`), built by the shared helpers
 * of `actions.ts`.
 */
export function createListActions(deps: ListActionDeps): ListActions {
  const { navigator, send } = deps;
  const show = (roomId: string, panel: Parameters<typeof showPanelMessage>[0]): void => navigator.act(roomId, () => send(showPanelMessage(panel)));
  return {
    newJob: (roomId, choice) => show(roomId, choice.panel),
    reviewPlan: (roomId) => show(roomId, "mailbox"),
    openReport: (roomId, reportId) =>
      navigator.act(roomId, () => {
        // The mailbox sends the floor's reports before it opens; the viewer opens once this one is here.
        send(showPanelMessage("mailbox"));
        navigator.act(roomId, () => deps.openReport(reportId), () => deps.hasReport(reportId));
      }),
    openJobCard: (roomId) => show(roomId, "board"),
    goTo: (roomId) => {
      deps.showHotel();
      navigator.act(roomId, () => undefined);
    },
    scheduleNight: () => show(LOBBY_ROOM, "night"),
  };
}
