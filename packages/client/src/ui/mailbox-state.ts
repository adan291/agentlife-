import type { PanelName, ServerMsg } from "@agentlife/shared";

/** What the mailbox badge and the HUD line show: pending approvals and whether a report is unread. */
export class MailboxState {
  /** approvalId -> taskId of approvals that wait for the user. */
  private readonly pending = new Map<string, string>();
  unseenReport = false;

  get pendingCount(): number {
    return this.pending.size;
  }

  /**
   * Feed every server message. `openPanel` is the panel that was open when the message arrived:
   * a report that arrives while the mailbox is open is read at once. Returns true when something changed.
   */
  apply(msg: ServerMsg, openPanel: PanelName | null): boolean {
    switch (msg.type) {
      case "welcome": {
        const changed = this.pending.size > 0 || this.unseenReport;
        this.pending.clear();
        this.unseenReport = false;
        return changed;
      }
      case "approval": {
        const a = msg.approval;
        if (a.status === "pending") {
          if (this.pending.get(a.approvalId) === a.taskId) return false;
          this.pending.set(a.approvalId, a.taskId);
          return true;
        }
        return this.pending.delete(a.approvalId);
      }
      case "job_update": {
        // The job ended, or another job started: its approvals can no longer be answered.
        const ended = msg.job.state === "delivered" || msg.job.state === "cancelled" || msg.job.state === "failed";
        let changed = false;
        for (const [id, taskId] of [...this.pending]) {
          if (ended ? taskId === msg.job.taskId : taskId !== msg.job.taskId) {
            this.pending.delete(id);
            changed = true;
          }
        }
        return changed;
      }
      case "report":
        if (openPanel === "mailbox" || this.unseenReport) return false;
        this.unseenReport = true;
        return true;
      case "open_panel":
        if (msg.panel === "mailbox" && this.unseenReport) {
          this.unseenReport = false;
          return true;
        }
        return false;
      default:
        return false;
    }
  }
}
