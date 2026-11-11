import type { PanelName, ServerMsg } from "@agentlife/shared";

/** What the mailbox badge and the HUD line show: pending approvals, whether a report is unread, and which reports are new. */
export class MailboxState {
  /** approvalId -> taskId of approvals that wait for the user. */
  private readonly pending = new Map<string, string>();
  unseenReport = false;
  /** Reports the client has seen, so a re-sent one (opening the mailbox) is not announced again. */
  private readonly known = new Set<string>();
  /** Delivered reports not opened in the viewer yet, oldest first. */
  private unread: string[] = [];
  /** Job of the latest `job_update`. */
  private taskId: string | undefined;

  get pendingCount(): number {
    return this.pending.size;
  }

  get unreadCount(): number {
    return this.unread.length;
  }

  /** Ids of the reports that were delivered and not opened yet. */
  unreadIds(): ReadonlySet<string> {
    return new Set(this.unread);
  }

  /** The newest unread report id, for the toast. */
  latestUnread(): string | undefined {
    return this.unread[this.unread.length - 1];
  }

  /** True for a `report` message that announces a delivery: the first sight of a report that was not re-sent on opening the mailbox. */
  isFresh(msg: ServerMsg): boolean {
    return msg.type === "report" && msg.resend !== true && !this.known.has(msg.report.reportId);
  }

  /** The report was opened in the viewer. Returns true when it was unread. */
  markRead(reportId: string): boolean {
    const before = this.unread.length;
    this.unread = this.unread.filter((id) => id !== reportId);
    return this.unread.length !== before;
  }

  /**
   * Feed every server message. `openPanel` is the panel that was open when the message arrived:
   * a report that arrives while the mailbox is open is read at once. Returns true when the badge on the mailbox
   * (pending count or unread dot) changed.
   */
  apply(msg: ServerMsg, openPanel: PanelName | null): boolean {
    switch (msg.type) {
      case "welcome": {
        const changed = this.pending.size > 0 || this.unseenReport;
        this.pending.clear();
        this.unseenReport = false;
        this.known.clear();
        this.unread = [];
        this.taskId = undefined;
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
        if (this.taskId !== undefined && this.taskId !== msg.job.taskId) {
          // The server drops the reports of the previous job; so does the client.
          this.unread = [];
          this.known.clear();
        }
        this.taskId = msg.job.taskId;
        for (const [id, taskId] of [...this.pending]) {
          if (ended ? taskId === msg.job.taskId : taskId !== msg.job.taskId) {
            this.pending.delete(id);
            changed = true;
          }
        }
        return changed;
      }
      case "report": {
        const fresh = this.isFresh(msg);
        this.known.add(msg.report.reportId);
        if (fresh) this.unread = [...this.unread.filter((id) => id !== msg.report.reportId), msg.report.reportId];
        // The return value is about the badge on the 3D mailbox (count and dot); unread reports are read with `unreadIds`.
        if (openPanel === "mailbox" || this.unseenReport) return false;
        this.unseenReport = true;
        return true;
      }
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
