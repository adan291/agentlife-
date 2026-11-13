import type { BadgeDef, ProgressView, QuestView } from "@agentlife/shared";
import type { PanelContent } from "./computer.ts";
import { badgeIcon } from "./badge-icons.ts";
import { levelLine, progressLines } from "./progress.ts";
import { balanceText } from "./wallet.ts";

export type ProfileTab = "badges" | "quests";

export interface ProfileView {
  /** The latest `progress`; null while the server has not sent one. */
  progress: ProgressView | null;
}

const TAB_LABEL: Record<ProfileTab, string> = { badges: "Badges", quests: "Quests" };

/** What a badge rule counts, as "one" and "many" phrases. */
const COUNTER_PHRASE: Readonly<Record<string, readonly [string, string]>> = {
  branch_delivered: ["branch delivered", "branches delivered"],
  review_finished: ["branch review finished", "branch reviews finished"],
  review_passed: ["branch review passed", "branch reviews passed"],
  memory_accepted: ["note kept in the Library", "notes kept in the Library"],
  night_summary: ["morning report with a finished job", "morning reports with a finished job"],
  night_scheduled: ["night job scheduled", "night jobs scheduled"],
  plan_approved: ["plan approved", "plans approved"],
  job_passed: ["job passed", "jobs passed"],
  job_not_passed: ["job that did not pass", "jobs that did not pass"],
  step_done: ["step finished", "steps finished"],
  late_job: ["job passed after midnight", "jobs passed after midnight"],
  best_streak: ["job passed in a row", "jobs passed in a row"],
};

/** What it takes to earn a badge, in words: "10 branches delivered", "Reach level 5". */
export function ruleText(rule: BadgeDef["rule"]): string {
  if (rule.counter === "level") return `Reach level ${rule.atLeast}`;
  const phrase = COUNTER_PHRASE[rule.counter];
  return `${rule.atLeast} ${phrase ? phrase[rule.atLeast === 1 ? 0 : 1] : rule.counter}`;
}

/** The user's badges first (the ones earned, newest first), then the ones still locked in file order. */
export function userBadges(p: ProgressView): { def: BadgeDef; earnedAt?: number }[] {
  const mine = p.badgeDefs.filter((d) => d.scope === "user");
  const at = new Map(p.user.badges.map((b) => [b.id, b.at]));
  const earned = mine.filter((d) => at.has(d.id)).sort((a, b) => at.get(b.id)! - at.get(a.id)!);
  return [...earned.map((def) => ({ def, earnedAt: at.get(def.id)! })), ...mine.filter((d) => !at.has(d.id)).map((def) => ({ def }))];
}

/** "Done", or "1 / 3". */
export function questProgressText(q: Pick<QuestView, "progress" | "target" | "done">): string {
  return q.done ? "Done" : `${q.progress} / ${q.target}`;
}

function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = doc.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** `YYYY-MM-DD` from the epoch ms, in local time. */
function dateText(ts: number): string {
  const d = new Date(ts);
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * The Profile panel: the user's level and stats, their badges (earned first, the others greyed with what they ask for)
 * and today's three quests with their progress. It only shows; the numbers come from the server. The open tab survives
 * re-renders.
 */
export function createProfilePanel(doc: Document) {
  let tab: ProfileTab = "badges";

  function badgeCard(def: BadgeDef, earnedAt: number | undefined): HTMLElement {
    const li = el(doc, "li", "al-badge-card");
    li.dataset["badge"] = def.id;
    li.dataset["earned"] = String(earnedAt !== undefined);
    const pic = el(doc, "span", "al-badge-pic");
    pic.appendChild(badgeIcon(doc, def.icon.shape, def.icon.colour, 32));
    const text = el(doc, "span", "al-badge-text");
    text.append(el(doc, "strong", undefined, def.name), el(doc, "br"), el(doc, "span", "al-muted", def.description), el(doc, "br"));
    text.appendChild(el(doc, "span", earnedAt === undefined ? "al-muted" : "al-badge-when", earnedAt === undefined ? `Locked: ${ruleText(def.rule)}` : `Earned ${dateText(earnedAt)}`));
    li.append(pic, text);
    return li;
  }

  function badgesTab(p: ProgressView): HTMLElement {
    const list = el(doc, "ul", "al-badge-list");
    const badges = userBadges(p);
    if (badges.length === 0) return el(doc, "p", "al-muted", "There are no badges yet.");
    for (const b of badges) list.appendChild(badgeCard(b.def, b.earnedAt));
    return list;
  }

  function questCard(q: QuestView): HTMLElement {
    const li = el(doc, "li", "al-quest");
    li.dataset["quest"] = q.id;
    li.dataset["done"] = String(q.done);
    const head = el(doc, "div", "al-row al-wrap");
    head.append(el(doc, "strong", undefined, q.title), el(doc, "span", "al-badge", questProgressText(q)), el(doc, "span", "al-muted", `Reward: ${balanceText(q.reward)}`));
    const bar = el(doc, "div", "al-build-bar");
    bar.setAttribute("role", "progressbar");
    bar.setAttribute("aria-label", q.title);
    bar.setAttribute("aria-valuemin", "0");
    bar.setAttribute("aria-valuemax", String(q.target));
    bar.setAttribute("aria-valuenow", String(q.progress));
    const fill = el(doc, "div", "al-build-fill");
    fill.style.setProperty("width", `${Math.round((q.progress / q.target) * 100)}%`);
    bar.appendChild(fill);
    li.append(head, bar);
    return li;
  }

  function questsTab(p: ProgressView): HTMLElement {
    const root = el(doc, "div");
    if (p.quests.items.length === 0) {
      root.appendChild(el(doc, "p", "al-muted", "There are no quests today."));
      return root;
    }
    root.appendChild(el(doc, "p", "al-muted", `Today's quests (${p.quests.day}). Each one pays Ecto once. They come from real work, so the team's results count.`));
    const list = el(doc, "ul", "al-quest-list");
    for (const q of p.quests.items) list.appendChild(questCard(q));
    root.appendChild(list);
    return root;
  }

  return function render(view: ProfileView, rerender: () => void): PanelContent {
    const root = el(doc, "div", "al-profile");
    const p = view.progress;
    if (!p) {
      root.appendChild(el(doc, "p", "al-muted", "No progress yet. Levels, badges and quests come from real, verified work."));
      return { body: root };
    }
    const head = el(doc, "div", "al-profile-head");
    head.append(el(doc, "strong", "al-shop-head", levelLine(p.user)), el(doc, "p", "al-muted", progressLines(p.user).join(" · ")));
    root.appendChild(head);

    const tabs = el(doc, "div", "al-row al-wrap");
    tabs.setAttribute("role", "tablist");
    for (const t of Object.keys(TAB_LABEL) as ProfileTab[]) {
      const b = el(doc, "button", "al-btn", TAB_LABEL[t]);
      b.type = "button";
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", String(t === tab));
      b.dataset["tab"] = t;
      if (t === tab) b.disabled = true;
      b.addEventListener("click", () => {
        tab = t;
        rerender();
      });
      tabs.appendChild(b);
    }
    root.appendChild(tabs);
    root.appendChild(tab === "badges" ? badgesTab(p) : questsTab(p));
    return { body: root };
  };
}
