import type { Page } from "@playwright/test";
import { ACCEPTED_PROBLEMS } from "./allowlist.ts";

/**
 * Layout and interface rules (regression-suite, requirement 2). Each rule is measured in the page; `design.md` says how.
 * `screenProblems` returns what is wrong on the screen as it is now, `expectScreen` (fixtures.ts) fails on it.
 */

export interface Problem {
  rule: string;
  /** `tag.class "name"`: enough to find the element. */
  element: string;
  detail: string;
}

/**
 * Runs in the page before any script: remembers which elements got a click-like listener, because nothing else tells
 * from outside what reacts to a click. Elements only; `document` and `window` listeners are not interface.
 */
export function installClickProbe(): void {
  const w = window as unknown as { __alClickable?: WeakSet<object> };
  if (w.__alClickable) return;
  const seen = new WeakSet<object>();
  w.__alClickable = seen;
  const types = new Set(["click", "mousedown", "pointerdown", "pointerup", "mouseup", "touchstart"]);
  const original = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (this: EventTarget, type: string, ...rest: unknown[]): void {
    if (types.has(type) && this instanceof Element) seen.add(this);
    (original as (...args: unknown[]) => void).call(this, type, ...rest);
  } as typeof EventTarget.prototype.addEventListener;
}

/** The static rules. Runs in the page; leaves the list of elements the Tab walk must reach in `window.__alExpected`. */
function scanInPage(): { problems: Problem[]; expected: number } {
  const problems: Problem[] = [];
  const w = window as unknown as { __alClickable?: WeakSet<object>; __alExpected?: Element[] };
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const SLACK = 0.5;

  const NATIVE = "button, a[href], input:not([type=hidden]), select, textarea, summary";
  const ROLES = ["button", "link", "tab", "menuitem", "switch", "checkbox", "radio", "slider", "option", "combobox"];
  // A separator is a control (a splitter) only when it can take the focus; otherwise it is a divider line.
  const ROLE_SELECTOR = [...ROLES.map((r) => `[role="${r}"]`), '[role="separator"][tabindex]'].join(", ");
  const CONTROL = `${NATIVE}, ${ROLE_SELECTOR}, [tabindex]:not([tabindex="-1"])`;
  const BUTTON_LIKE = 'button, a[href], summary, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="switch"], [role="checkbox"], [role="radio"], [role="option"], input[type="button"], input[type="submit"], input[type="checkbox"], input[type="radio"]';

  const text = (el: Element): string => (el.textContent ?? "").replace(/\s+/g, " ").trim();
  const describe = (el: Element): string => {
    const cls = typeof el.className === "string" ? el.className.split(/\s+/).filter(Boolean).slice(0, 2).join(".") : "";
    const label = el.getAttribute("aria-label") ?? el.getAttribute("title") ?? text(el);
    return `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ""}${label ? ` "${label.slice(0, 40)}"` : ""}`;
  };
  const add = (rule: string, el: Element, detail: string): void => {
    problems.push({ rule, element: describe(el), detail });
  };

  /** Visible to a user: rendered, not transparent, at least 1 px each way. */
  const rendered = (el: Element): boolean => {
    if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    const r = el.getBoundingClientRect();
    return r.width >= 1 && r.height >= 1;
  };

  interface Box {
    left: number;
    top: number;
    right: number;
    bottom: number;
    /** Part of the element is hidden by an ancestor with `overflow: hidden` or `clip` (not by one that scrolls). */
    cutByHidden: boolean;
  }
  /** The element's box clipped by the ancestors that clip it; null when nothing of it can be seen. */
  const visibleBox = (el: Element, ignoreScrollers = false): Box | null => {
    const own = el.getBoundingClientRect();
    let left = own.left;
    let top = own.top;
    let right = own.right;
    let bottom = own.bottom;
    let cutByHidden = false;
    let waitingForContainingBlock = false;
    let node: Element | null = el;
    while (node) {
      const position = getComputedStyle(node).position;
      if (position === "fixed") break;
      if (position === "absolute") waitingForContainingBlock = true;
      const ancestor: Element | null = node.parentElement;
      if (!ancestor || ancestor === document.documentElement) break;
      const cs = getComputedStyle(ancestor);
      let clips = true;
      if (waitingForContainingBlock) {
        if (cs.position === "static" && cs.transform === "none") clips = false;
        else waitingForContainingBlock = false;
      }
      if (clips && (cs.overflowX !== "visible" || cs.overflowY !== "visible")) {
        const a = ancestor.getBoundingClientRect();
        const hiddenX = cs.overflowX === "hidden" || cs.overflowX === "clip";
        const hiddenY = cs.overflowY === "hidden" || cs.overflowY === "clip";
        // A control scrolled out of a list is still a Tab stop: when asked, only the clips that never scroll count.
        const scrollsX = cs.overflowX === "auto" || cs.overflowX === "scroll";
        const scrollsY = cs.overflowY === "auto" || cs.overflowY === "scroll";
        if (cs.overflowX !== "visible" && !(ignoreScrollers && scrollsX)) {
          if (hiddenX && (left < a.left - SLACK || right > a.right + SLACK)) cutByHidden = true;
          left = Math.max(left, a.left);
          right = Math.min(right, a.right);
        } else if (ignoreScrollers && scrollsX) {
          // Scrolled into view it would sit somewhere in the scroller: the clips further out apply to the scroller's box.
          left = a.left;
          right = a.right;
        }
        if (cs.overflowY !== "visible" && !(ignoreScrollers && scrollsY)) {
          if (hiddenY && (top < a.top - SLACK || bottom > a.bottom + SLACK)) cutByHidden = true;
          top = Math.max(top, a.top);
          bottom = Math.min(bottom, a.bottom);
        } else if (ignoreScrollers && scrollsY) {
          top = a.top;
          bottom = a.bottom;
        }
      }
      node = ancestor;
    }
    if (right - left < 1 || bottom - top < 1) return null;
    return { left, top, right, bottom, cutByHidden };
  };

  const inViewport = (b: Box): boolean => b.left >= -SLACK && b.top >= -SLACK && b.right <= vw + SLACK && b.bottom <= vh + SLACK;
  const isModalOpen = (): Element | null => {
    for (const m of document.querySelectorAll('[aria-modal="true"]')) if (rendered(m)) return m;
    return null;
  };
  const menuOpen = Array.from(document.querySelectorAll('[role="menu"]')).some((m) => rendered(m));
  const modal = isModalOpen();
  const behindModal = (el: Element): boolean => modal !== null && !modal.contains(el);

  const isProper = (el: Element): boolean => el.matches(NATIVE) || el.matches(ROLE_SELECTOR);
  const isDisabled = (el: Element): boolean => el.matches(":disabled") || el.getAttribute("aria-disabled") === "true";

  /** Accessible name, close to the spec: labelledby, aria-label, labels, content, title, placeholder. */
  const contentName = (el: Node): string => {
    if (el.nodeType === Node.TEXT_NODE) return el.textContent ?? "";
    if (!(el instanceof Element)) return "";
    if (el.getAttribute("aria-hidden") === "true") return "";
    const label = el.getAttribute("aria-label");
    if (label) return label;
    if (el instanceof HTMLImageElement) return el.alt;
    if (el instanceof SVGElement) return el.querySelector("title")?.textContent ?? "";
    let out = "";
    for (const child of el.childNodes) out += ` ${contentName(child)}`;
    return out;
  };
  const accessibleName = (el: Element): string => {
    const by = el.getAttribute("aria-labelledby");
    if (by) {
      const named = by.split(/\s+/).map((id) => document.getElementById(id)).filter((n): n is HTMLElement => n !== null);
      const joined = named.map((n) => contentName(n)).join(" ").replace(/\s+/g, " ").trim();
      if (joined) return joined;
    }
    const aria = el.getAttribute("aria-label")?.trim();
    if (aria) return aria;
    if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
      const labels = el.labels ? Array.from(el.labels).map((l) => contentName(l)).join(" ").replace(/\s+/g, " ").trim() : "";
      if (labels) return labels;
      if (el instanceof HTMLInputElement && (el.type === "button" || el.type === "submit") && el.value) return el.value;
    }
    if (!el.matches('[role="slider"], [role="separator"]')) {
      const content = contentName(el).replace(/\s+/g, " ").trim();
      if (content) return content;
    }
    return (el.getAttribute("title") ?? (el as HTMLInputElement).placeholder ?? "").trim();
  };

  // ---- page-scroll ----
  const root = document.documentElement;
  if (root.scrollWidth > root.clientWidth) add("page-scroll", root, `the page scrolls sideways: ${root.scrollWidth} px of content in ${root.clientWidth} px`);
  if (document.body.scrollWidth > root.clientWidth) add("page-scroll", document.body, `the body is wider than the window: ${document.body.scrollWidth} px in ${root.clientWidth} px`);
  if (root.scrollHeight > root.clientHeight) add("page-scroll", root, `the page scrolls down: ${root.scrollHeight} px of content in ${root.clientHeight} px`);

  const all = Array.from(document.body.querySelectorAll("*")).filter((el) => !el.closest("head, script, style, option, optgroup, canvas") && rendered(el));

  // ---- viewport, for the regions and the containers a user reads from ----
  for (const el of all) {
    if (!el.matches('[role="dialog"], [role="menu"], [role="listbox"], [role="toolbar"], .al-top, .al-side, .al-stage, .al-dock')) continue;
    const r = el.getBoundingClientRect();
    if (r.left < -SLACK || r.top < -SLACK || r.right > vw + SLACK || r.bottom > vh + SLACK) {
      add("viewport", el, `box ${Math.round(r.left)},${Math.round(r.top)} to ${Math.round(r.right)},${Math.round(r.bottom)} leaves the ${vw}x${vh} window`);
    }
  }

  // ---- viewport, covered and text-cut, element by element ----
  const hasOwnText = (el: Element): boolean => Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim() !== "");
  for (const el of all) {
    const control = el.matches(CONTROL);
    const label = hasOwnText(el);
    const cs = getComputedStyle(el);
    if (control || label) {
      const box = visibleBox(el);
      if (box && !inViewport(box)) {
        add("viewport", el, `${control ? "control" : "label"} at ${Math.round(box.left)},${Math.round(box.top)} to ${Math.round(box.right)},${Math.round(box.bottom)} leaves the ${vw}x${vh} window`);
      }
      if (box && control && box.cutByHidden) add("viewport", el, "control cut by an ancestor with overflow hidden");
      if (box && control && cs.pointerEvents !== "none" && !behindModal(el) && inViewport(box)) {
        const x = (box.left + box.right) / 2;
        const y = (box.top + box.bottom) / 2;
        const top = document.elementFromPoint(x, y);
        const sameLabel = top !== null && el.closest("label") !== null && el.closest("label") === top.closest("label");
        // A panel opened over the stage hides the stage's own controls (Actions, wisps) while it is open; that is what a panel does.
        // The top bar, the side bar and the dock must never be under one.
        const underPanel = top !== null && top.closest('[role="dialog"]') !== null && el.closest('[role="dialog"]') === null && el.closest(".al-stage") !== null;
        if (top === null || !(top === el || el.contains(top) || sameLabel || underPanel)) {
          add("covered", el, `its centre (${Math.round(x)},${Math.round(y)}) is covered by ${top ? describe(top) : "nothing"}`);
        }
      }
    }
    const hidesX = cs.overflowX === "hidden" || cs.overflowX === "clip";
    const hidesY = cs.overflowY === "hidden" || cs.overflowY === "clip";
    if ((hidesX || hidesY) && el.clientWidth > 0 && text(el) !== "") {
      const ellipsis = cs.textOverflow === "ellipsis";
      const clamped = cs.getPropertyValue("-webkit-line-clamp") !== "none" && cs.getPropertyValue("-webkit-line-clamp") !== "";
      const cutX = hidesX && el.scrollWidth > el.clientWidth + 1 && !ellipsis;
      const cutY = hidesY && el.scrollHeight > el.clientHeight + 1 && !clamped;
      if (cutX || cutY) {
        add("text-cut", el, `content ${el.scrollWidth}x${el.scrollHeight} in a box of ${el.clientWidth}x${el.clientHeight}`);
      }
    }
  }

  // ---- what reacts to a click is a control ----
  const clickable = w.__alClickable;
  for (const el of all) {
    const cs = getComputedStyle(el);
    const parentCursor = el.parentElement ? getComputedStyle(el.parentElement).cursor : "";
    const listens = clickable?.has(el) === true || typeof (el as HTMLElement).onclick === "function";
    const looksClickable = cs.cursor === "pointer" && parentCursor !== "pointer";
    if (!listens && !looksClickable) continue;
    if (isProper(el)) continue;
    // A part of a control (the icon in a button) belongs to the control.
    if (el.closest(`${NATIVE}, ${ROLE_SELECTOR}`)) continue;
    add("clickable-role", el, `reacts to a click (${listens ? "listener" : "pointer cursor"}) but is not a button, link or control with a role`);
  }

  // ---- names, cursors and the controls the Tab walk must reach ----
  const expected: Element[] = [];
  for (const el of all) {
    if (!isProper(el)) continue;
    const box = visibleBox(el, true);
    if (!box) continue;
    if (!accessibleName(el)) add("name", el, "no accessible name");
    const disabled = isDisabled(el);
    const isOption = el.matches('[role="option"]');
    if (!disabled && el.matches(BUTTON_LIKE) && getComputedStyle(el).cursor !== "pointer") {
      add("cursor", el, `cursor is ${getComputedStyle(el).cursor}, not pointer`);
    }
    if (el.matches('[role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="switch"], [role="checkbox"], [role="radio"], [role="slider"], [role="separator"]') && !el.matches(NATIVE) && (el as HTMLElement).tabIndex < 0) {
      add("clickable-role", el, "has a role of a control but cannot be focused (no tabindex)");
    }
    if (disabled || isOption || behindModal(el)) continue;
    // Menu items move with the arrow keys and Tab closes the menu: they are not Tab stops by design.
    if (el.matches('[role="menuitem"]') && el.closest('[role="menu"]')) continue;
    if ((el as HTMLElement).tabIndex >= 0 && !el.closest("[inert]")) expected.push(el);
    else if (!el.matches('[role="separator"]')) add("tab", el, "is a control but cannot be reached with Tab (tabindex -1)");
  }
  w.__alExpected = expected;
  return { problems, expected: menuOpen ? -1 : expected.length };
}

interface Stop {
  /** Index in the list of expected controls, -1 for an element the scan did not list. */
  index: number;
  element: string;
  ring: string | null;
  scroller: boolean;
  repeated: boolean;
}

/** Runs in the page after each Tab press: what has the focus, and does it show it. */
function readFocus(): Stop | null {
  const w = window as unknown as { __alExpected?: Element[]; __alSeen?: Set<Element> };
  const el = document.activeElement;
  if (!el || el === document.body || el === document.documentElement) return null;
  const seen = (w.__alSeen ??= new Set<Element>());
  const repeated = seen.has(el);
  seen.add(el);
  const cs = getComputedStyle(el);
  const outlined = cs.outlineStyle !== "none" && Number.parseFloat(cs.outlineWidth) > 0;
  const shadowed = cs.boxShadow !== "none";
  let ring: string | null = null;
  if (!el.matches(":focus-visible")) ring = "does not match :focus-visible after a key press";
  else if (!outlined && !shadowed) ring = "has no outline and no shadow when focused";
  const cls = typeof el.className === "string" ? el.className.split(/\s+/).filter(Boolean).slice(0, 2).join(".") : "";
  const label = el.getAttribute("aria-label") ?? el.getAttribute("title") ?? (el.textContent ?? "").replace(/\s+/g, " ").trim();
  return {
    index: (w.__alExpected ?? []).indexOf(el),
    element: `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ""}${label ? ` "${label.slice(0, 40)}"` : ""}`,
    ring,
    scroller: el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1,
    repeated,
  };
}

/** Roles whose line in an aria snapshot must carry a name. */
const NAMED_ROLES = ["button", "link", "tab", "menuitem", "checkbox", "radio", "switch", "textbox", "combobox", "slider", "searchbox"];

/** Presses Tab through the page and compares what it reaches with what the scan expects. */
async function tabWalk(page: Page, expected: number): Promise<Problem[]> {
  const problems: Problem[] = [];
  await page.evaluate(() => {
    (window as unknown as { __alSeen?: Set<Element> }).__alSeen = new Set();
    // Inside a modal the walk starts where the focus is; elsewhere it starts from the top of the page.
    const active = document.activeElement as HTMLElement | null;
    (window as unknown as { __alStart?: Element | null }).__alStart = active && active !== document.body ? active : null;
    if (!active?.closest('[aria-modal="true"]')) active?.blur?.();
  });
  const reached = new Set<number>();
  let wraps = 0;
  for (let i = 0; i < expected + 4; i += 1) {
    await page.keyboard.press("Tab");
    const stop = await page.evaluate(readFocus);
    if (!stop) {
      // The focus left the page. The walk starts where the last click was, so one wrap brings the first elements.
      wraps += 1;
      if (wraps > 1) break;
      continue;
    }
    if (stop.repeated) break;
    if (stop.index >= 0) reached.add(stop.index);
    else if (!stop.scroller) problems.push({ rule: "tab", element: stop.element, detail: "has the focus after Tab but is not a control the scan listed" });
    if (stop.ring) problems.push({ rule: "focus-ring", element: stop.element, detail: stop.ring });
  }
  const missing = await page.evaluate((reachedIndexes) => {
    const w = window as unknown as { __alExpected?: Element[] };
    const seen = new Set(reachedIndexes);
    return (w.__alExpected ?? []).flatMap((el, i) => {
      if (seen.has(i)) return [];
      const cls = typeof el.className === "string" ? el.className.split(/\s+/).filter(Boolean).slice(0, 2).join(".") : "";
      const label = el.getAttribute("aria-label") ?? el.getAttribute("title") ?? (el.textContent ?? "").replace(/\s+/g, " ").trim();
      return [`${el.tagName.toLowerCase()}${cls ? `.${cls}` : ""}${label ? ` "${label.slice(0, 40)}"` : ""}`];
    });
  }, [...reached]);
  for (const element of missing) problems.push({ rule: "tab", element, detail: "was not reached by pressing Tab through the page" });
  // The page is left as the user had it: the focus goes back to where it was.
  await page.evaluate(() => {
    const start = (window as unknown as { __alStart?: HTMLElement | null }).__alStart;
    if (start?.isConnected) start.focus();
    else (document.activeElement as HTMLElement | null)?.blur?.();
  });
  return problems;
}

/** The second net for names: Chromium's own accessibility tree, as `ariaSnapshot` writes it. */
async function unnamedInSnapshot(page: Page): Promise<Problem[]> {
  const snapshot = await page.locator("body").ariaSnapshot();
  const out: Problem[] = [];
  for (const line of snapshot.split("\n")) {
    const m = /^\s*- (\w+)(?: "([^"]*)")?/.exec(line);
    if (!m || !NAMED_ROLES.includes(m[1]!)) continue;
    if (!m[2] || m[2].trim() === "") out.push({ rule: "name", element: m[1]!, detail: `the accessibility tree has a ${m[1]} without a name: ${line.trim()}` });
  }
  return out;
}

/** What is wrong on the screen as it is now, minus what `allowlist.ts` accepts. */
export async function screenProblems(page: Page): Promise<Problem[]> {
  const scan = await page.evaluate(scanInPage);
  const found = [...scan.problems, ...(scan.expected >= 0 ? await tabWalk(page, scan.expected) : []), ...(await unnamedInSnapshot(page))];
  const seen = new Set<string>();
  return found.filter((p) => {
    const key = `${p.rule}|${p.element}|${p.detail}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return !ACCEPTED_PROBLEMS.some((a) => a.rule === p.rule && a.element.test(p.element));
  });
}
