import type { ApprovalDecision, ClientMsg, JobKind, ServerMsg, ShowablePanel } from "@agentlife/shared";

/**
 * The messages the hotel furniture sends, built in one place. The panels, the list view and the command palette all use
 * these builders, so "a command sends the same message as its hotel equivalent" holds by construction (list-mode, 3.1).
 */

/** `start_job`. A plain change has no `kind` and no `target`, as the Computer panel sends it. */
export function startJobMessage(repoId: string, goal: string, kind?: JobKind, target?: string): ClientMsg {
  if (kind === undefined || kind === "change") return { type: "start_job", repoId, goal };
  return { type: "start_job", repoId, goal, kind, ...(target === undefined ? {} : { target }) };
}

export function approveMessage(approvalId: string, decision: ApprovalDecision): ClientMsg {
  return { type: "approve", approvalId, decision };
}

export function deliverMessage(taskId: string): ClientMsg {
  return { type: "deliver", taskId };
}

/** The elevator's `go_to` is the default; the list and the palette pass `"list"`. */
export function goToMessage(roomId: string, via?: "list"): ClientMsg {
  return via ? { type: "go_to", roomId, via } : { type: "go_to", roomId };
}

export function showPanelMessage(panel: ShowablePanel): ClientMsg {
  return { type: "show_panel", panel };
}

/** How long a move may take before the user is told it failed. */
export const MOVE_TIMEOUT_MS = 5000;

export interface NavigatorDeps {
  send(msg: ClientMsg): void;
  toast(text: string): void;
}

/** Move-then-act (D13): run something on a floor, going there first when the user is elsewhere. */
export interface Navigator {
  /**
   * Runs `run` once the user is on `roomId` and `ready()` (data that arrives right after the `welcome`, such as the
   * pending approvals) is true. At once when both already hold. Otherwise sends `go_to` with `via: "list"` and waits for
   * the `welcome` of that floor, up to `MOVE_TIMEOUT_MS`. A new request replaces the one that waits.
   */
  act(roomId: string, run: () => void, ready?: () => boolean): void;
  /** Feed every server message. */
  handle(msg: ServerMsg): void;
  /** Room of the latest `welcome`. */
  readonly room: string | undefined;
  readonly pending: boolean;
  cancel(): void;
}

interface Pending {
  roomId: string;
  run: () => void;
  ready: () => boolean;
  timer: ReturnType<typeof setTimeout>;
}

export function createNavigator(deps: NavigatorDeps): Navigator {
  let room: string | undefined;
  let pending: Pending | undefined;

  const clear = (): void => {
    if (pending) clearTimeout(pending.timer);
    pending = undefined;
  };
  const settle = (): void => {
    if (!pending || room !== pending.roomId || !pending.ready()) return;
    const { run } = pending;
    clear();
    run();
  };

  return {
    get room() {
      return room;
    },
    get pending() {
      return pending !== undefined;
    },
    cancel: clear,
    act(roomId, run, ready = () => true) {
      clear();
      if (room === roomId && ready()) return run();
      const timer = setTimeout(() => {
        pending = undefined;
        deps.toast("That took too long. Try again.");
      }, MOVE_TIMEOUT_MS);
      pending = { roomId, run, ready, timer };
      if (room !== roomId) deps.send(goToMessage(roomId, "list"));
    },
    handle(msg) {
      if (msg.type === "welcome") {
        room = msg.roomId ?? msg.room.id;
      } else if (msg.type === "error" && msg.code === "bad_message" && pending) {
        // The move was refused (the floor is gone): the toast of the error says why.
        clear();
        return;
      }
      settle();
    },
  };
}
