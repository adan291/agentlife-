import type { BugOpenCount, PanelName, ServerMsg } from "@agentlife/shared";

/**
 * What the client knows about the Bug sack outside its panel: whether the server has one, how many groups are open, and
 * whether something new arrived since the user last looked (the dot in the top bar). Pure, like `MailboxState`.
 */
export class BugState {
  /** The server told us it has a Bug sack (it sends `bug_news` when a connection starts). False in the recorded demo. */
  available = false;
  open: BugOpenCount = { game: 0, code: 0 };
  /** A group arrived or came back since the panel was last open. */
  dot = false;

  get total(): number {
    return this.open.game + this.open.code;
  }

  /** Returns true when something the Menu or the top bar shows changed. */
  apply(msg: ServerMsg, openPanel: PanelName | null): boolean {
    const before = `${this.available}|${this.open.game}|${this.open.code}|${this.dot}`;
    if (msg.type === "bug_news") {
      this.available = true;
      this.open = msg.open;
      if ((msg.change === "new" || msg.change === "reopened") && openPanel !== "bugs") this.dot = true;
    } else if (msg.type === "bugs") {
      this.available = true;
      this.open = msg.open;
    } else if (msg.type === "open_panel" && msg.panel === "bugs") {
      this.dot = false;
    } else if (msg.type === "welcome") {
      // A new connection starts the server's own `bug_news`; until it comes, nothing is known.
      this.available = false;
    }
    return before !== `${this.available}|${this.open.game}|${this.open.code}|${this.dot}`;
  }

  /** The user is looking at the Bug sack. */
  see(): void {
    this.dot = false;
  }
}
