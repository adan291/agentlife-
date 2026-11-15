import { BUG_MESSAGE_MAX, BUG_REPORT_BYTES, BUG_STACK_MAX, BUG_RATE_PER_MINUTE, firstBugFrame, normalizeBugMessage } from "@agentlife/shared";
import type { BugReportFields, GameBugKind } from "@agentlife/shared";

/** An identical report inside this window is counted, not sent again. */
export const BUG_DUPLICATE_MS = 10_000;
/** Reports kept while the connection is not open yet (an error while the page starts is the most useful one). */
export const BUG_PENDING_MAX = 20;
const DUPLICATE_KEYS_MAX = 200;

/** What the grabber listens to: a window, or a small stand-in in tests. */
export type GrabberTarget = Pick<EventTarget, "addEventListener" | "removeEventListener">;

export interface GrabberConsole {
  error: (...args: unknown[]) => void;
}

export interface Where {
  floor?: string;
  panel?: string;
  view?: "hotel" | "list";
}

export interface GrabberOptions {
  /** Sends one report to the world-server. Called only when `ready()` is true. */
  send(report: BugReportFields): void;
  /** True while the connection is open; reports made before that wait (up to `BUG_PENDING_MAX`). */
  ready?(): boolean;
  /** Where the user is: the floor, the open panel and the view. */
  where?(): Where;
  now?: () => number;
  target?: GrabberTarget;
  console?: GrabberConsole;
}

/** Errors a Pixi frame or a texture fails with: the stack or the message names the library. */
function isPixi(text: string): boolean {
  return /pixi/i.test(text);
}

/** A rejection that says a file or a request could not be fetched. */
function isAssetFailure(message: string): boolean {
  return /\b(failed to (load|fetch)|cannot load|could not load|load failed|networkerror)\b/i.test(message);
}

/** A readable line from whatever was passed to `console.error`. */
export function consoleText(args: readonly unknown[]): { message: string; stack?: string } {
  let stack: string | undefined;
  const parts = args.map((a) => {
    if (a instanceof Error) {
      stack ??= a.stack;
      return a.message || a.name;
    }
    if (typeof a === "string") return a;
    try {
      return JSON.stringify(a) ?? String(a);
    } catch {
      return String(a);
    }
  });
  return { message: parts.join(" "), ...(stack ? { stack } : {}) };
}

function trimTo(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) : text;
}

/** Bytes of a report as JSON, which is what the server measures. */
function sizeOf(report: BugReportFields): number {
  return new TextEncoder().encode(JSON.stringify({ type: "bug_report", ...report })).length;
}

/**
 * The Game component of the Bug sack's grabber (spec bug-sack). It catches what the browser sees go wrong and hands it to
 * `send` as a report, within limits: at most 20 reports a minute, 8 KB each, and an identical report inside 10 seconds is
 * counted, not sent. Nothing here throws at the code that failed: a grabber that crashed would be one more bug. The
 * recorded demo never builds one.
 */
export class BugGrabber {
  private readonly options: GrabberOptions;
  private readonly now: () => number;
  private readonly sent: number[] = [];
  private readonly seen = new Map<string, number>();
  private readonly pending: BugReportFields[] = [];
  private busy = false;
  /** Reports that were not sent: repeated inside the window, over the rate, or too big to cut. Shown by tests. */
  skipped = 0;

  // No parameter properties: node's type stripping does not support them.
  constructor(options: GrabberOptions) {
    this.options = options;
    this.now = options.now ?? Date.now;
  }

  /**
   * Records one error. `kind` says what it was. The text is cut to the limits; the stack gives way first when the report
   * is over 8 KB.
   */
  report(kind: GameBugKind, message: string, stack?: string): void {
    if (this.busy) return;
    this.busy = true;
    try {
      const text = trimTo(message.trim() || kind, BUG_MESSAGE_MAX);
      const key = `${kind}|${normalizeBugMessage(text)}|${firstBugFrame(stack)}`;
      const at = this.now();
      const last = this.seen.get(key);
      if (last !== undefined && at - last < BUG_DUPLICATE_MS) {
        this.skipped += 1;
        return;
      }
      this.seen.set(key, at);
      if (this.seen.size > DUPLICATE_KEYS_MAX) for (const [k, t] of this.seen) if (at - t >= BUG_DUPLICATE_MS) this.seen.delete(k);
      let where: Where = {};
      try {
        where = this.options.where?.() ?? {};
      } catch {
        // The page may not be ready to say where it is (an error while it starts): the report goes without.
      }
      let report: BugReportFields = {
        kind,
        message: text,
        ...(stack ? { stack: trimTo(stack, BUG_STACK_MAX) } : {}),
        ...(where.floor ? { floor: where.floor.slice(0, 100) } : {}),
        ...(where.panel ? { panel: where.panel.slice(0, 100) } : {}),
        ...(where.view ? { view: where.view } : {}),
        clientTime: at,
      };
      // Over 8 KB: the stack is cut in half until it fits, then dropped; a message that is still too big cannot happen (1000 characters).
      while (sizeOf(report) > BUG_REPORT_BYTES) {
        const { stack: s, ...rest } = report;
        if (!s || s.length < 40) {
          report = rest;
          if (sizeOf(report) > BUG_REPORT_BYTES) {
            this.skipped += 1;
            return;
          }
          break;
        }
        report = { ...rest, stack: s.slice(0, Math.floor(s.length / 2)) };
      }
      this.deliver(report);
    } catch {
      // Never make things worse.
    } finally {
      this.busy = false;
    }
  }

  /** The connection opened: send what waited. */
  flush(): void {
    if (this.options.ready && !this.options.ready()) return;
    for (const report of this.pending.splice(0)) this.deliver(report);
  }

  private deliver(report: BugReportFields): void {
    if (this.options.ready && !this.options.ready()) {
      if (this.pending.length < BUG_PENDING_MAX) this.pending.push(report);
      return;
    }
    const at = this.now();
    while (this.sent.length > 0 && at - this.sent[0]! >= 60_000) this.sent.shift();
    if (this.sent.length >= BUG_RATE_PER_MINUTE) {
      this.skipped += 1;
      return;
    }
    this.sent.push(at);
    try {
      this.options.send(report);
    } catch {
      // A report that cannot be sent is lost; the page goes on.
    }
  }

  /** A server message that failed the protocol schema (the transport drops it and says why). */
  protocol(issue: string): void {
    this.report("protocol", `The server sent a message the client does not understand: ${issue}`);
  }

  /** Listens to the page. Returns a function that stops it and puts `console.error` back. */
  install(): () => void {
    const target: GrabberTarget | undefined = this.options.target ?? (typeof window === "undefined" ? undefined : window);
    const con: GrabberConsole | undefined = this.options.console ?? (typeof console === "undefined" ? undefined : console);
    const undo: (() => void)[] = [];
    if (target) {
      // Capture: a failed image or script does not bubble, but it can be heard on the way down.
      const onError = (ev: { target?: unknown; message?: string; error?: unknown }): void => {
        const t = ev.target as { tagName?: string; src?: string; href?: string; currentSrc?: string } | null | undefined;
        if (t && typeof t.tagName === "string") {
          const url = t.currentSrc || t.src || t.href || "";
          this.report("asset-load", `Failed to load ${t.tagName.toLowerCase()} ${pathOf(url)}`.trim());
          return;
        }
        const err = ev.error instanceof Error ? ev.error : undefined;
        const message = err?.message || ev.message || "Uncaught error";
        const stack = err?.stack;
        this.report(isPixi(`${message}\n${stack ?? ""}`) ? "pixi" : "uncaught", err ? `${err.name}: ${message}` : message, stack);
      };
      const onRejection = (ev: { reason?: unknown }): void => {
        const r = ev.reason;
        const err = r instanceof Error ? r : undefined;
        const message = err ? `${err.name}: ${err.message}` : typeof r === "string" ? r : consoleText([r]).message;
        const text = `${message}\n${err?.stack ?? ""}`;
        this.report(isPixi(text) ? "pixi" : isAssetFailure(message) ? "asset-load" : "unhandled-rejection", message, err?.stack);
      };
      const onErrorListener = onError as unknown as EventListener;
      const onRejectionListener = onRejection as unknown as EventListener;
      target.addEventListener("error", onErrorListener, true);
      target.addEventListener("unhandledrejection", onRejectionListener);
      undo.push(() => target.removeEventListener("error", onErrorListener, true));
      undo.push(() => target.removeEventListener("unhandledrejection", onRejectionListener));
    }
    if (con) {
      const original = con.error;
      con.error = (...args: unknown[]): void => {
        original.apply(con, args);
        const { message, stack } = consoleText(args);
        this.report(isPixi(`${message}\n${stack ?? ""}`) ? "pixi" : "console-error", message, stack);
      };
      undo.push(() => {
        con.error = original;
      });
    }
    return () => {
      for (const u of undo.splice(0)) u();
    };
  }
}

/** The path of a URL, with no host and no query: what goes into a report about a file that did not load. */
function pathOf(url: string): string {
  return url.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, "").replace(/[?#].*$/, "").slice(0, 100);
}
