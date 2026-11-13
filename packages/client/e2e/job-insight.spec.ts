import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/** The world-server of the Playwright config (fake engine). */
const WORLD_URL = /ws:\/\/127\.0\.0\.1:8795/;

interface JobCase {
  name: string;
  state: string;
  timeline: [string, number, string?][];
}

const T0 = 1_700_000_000_000;
const CASES: JobCase[] = [
  { name: "plan waits for the user", state: "awaiting_plan_approval", timeline: [["created", 0], ["analyzing", 1_000], ["awaiting_plan_approval", 26_000]] },
  {
    name: "review running, long durations",
    state: "reviewing",
    timeline: [["created", 0], ["analyzing", 1_000], ["awaiting_plan_approval", 3_725_000], ["developing", 3_900_000], ["testing", 4_000_000], ["reviewing", 4_100_000]],
  },
  { name: "plan rejected", state: "cancelled", timeline: [["created", 0], ["analyzing", 1_000], ["awaiting_plan_approval", 26_000], ["cancelled", 40_000, "Plan rejected"]] },
  {
    name: "delivered",
    state: "delivered",
    timeline: [["created", 0], ["analyzing", 1_000], ["awaiting_plan_approval", 26_000], ["developing", 30_000], ["testing", 52_000], ["reviewing", 58_000], ["report_ready", 77_000], ["delivered", 78_000]],
  },
  { name: "failed in the middle", state: "failed", timeline: [["created", 0], ["analyzing", 1_000], ["awaiting_plan_approval", 26_000], ["developing", 30_000], ["failed", 45_000, "boom"]] },
];

function jobMessage(c: JobCase): string {
  return JSON.stringify({
    type: "job_update",
    job: {
      taskId: "task-d232d369",
      repoId: "haunted-todo",
      goal: "Validate todo titles in addTodo",
      state: c.state,
      timeline: c.timeline.map(([state, offset, text]) => ({ ts: T0 + offset, state, ...(text ? { text } : {}) })),
    },
  });
}

/**
 * Opens the page with the real world-server behind a proxy that adds messages after the welcome. The world-server
 * serves one fake engine; the proxy lets a test show states (a job in any step, busy ghosts) without driving a whole job.
 * The page starts on the haunted-todo floor (the client goes back to the floor it remembers), so the messages are
 * injected after the welcome of that floor, not the lobby's.
 */
async function openWith(page: Page, width: number, height: number, inject: string[]): Promise<void> {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("agentlife-guide-seen", "1");
    sessionStorage.setItem("agentlife-floor", "project:haunted-todo");
  });
  await page.routeWebSocket(WORLD_URL, (ws) => {
    const server = ws.connectToServer();
    let injected = false;
    server.onMessage((message) => {
      ws.send(message);
      if (!injected && typeof message === "string" && message.includes('"type":"welcome"') && message.includes('"roomId":"project:haunted-todo"')) {
        injected = true;
        for (const m of inject) ws.send(m);
      }
    });
    ws.onMessage((message) => server.send(message));
  });
  await page.setViewportSize({ width, height });
  await page.goto("/");
  await expect(page.locator(".al-status")).toBeHidden();
  await expect(page.locator(".al-stage > canvas")).toBeVisible();
  await expect(page.locator(".al-floor-label")).toHaveText("haunted-todo");
}

for (const size of [
  { width: 1366, height: 768 },
  { width: 800, height: 600 },
]) {
  test.describe(`stepper at ${size.width}x${size.height}`, () => {
    for (const c of CASES) {
      test(`has no scroll bars: ${c.name}`, async ({ page }) => {
        await openWith(page, size.width, size.height, [jobMessage(c)]);
        const stepper = page.locator(".al-stepper");
        await expect(stepper).toBeVisible();
        const m = await stepper.evaluate((el) => ({
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
          scrollHeight: el.scrollHeight,
          clientHeight: el.clientHeight,
          overflowX: getComputedStyle(el).overflowX,
          overflowY: getComputedStyle(el).overflowY,
        }));
        // Nothing sticks out of the box, and the box does not scroll (hidden, never auto or scroll).
        expect(m.scrollWidth).toBe(m.clientWidth);
        expect(m.scrollHeight).toBe(m.clientHeight);
        expect(m.overflowX).toBe("hidden");
        expect(m.overflowY).toBe("hidden");
        // Every step lies inside the strip, and the strip inside the top bar.
        const strip = await stepper.boundingBox();
        const bar = await page.locator(".al-top").boundingBox();
        expect(strip).not.toBeNull();
        expect(bar).not.toBeNull();
        expect(strip!.x).toBeGreaterThanOrEqual(bar!.x - 0.5);
        expect(strip!.x + strip!.width).toBeLessThanOrEqual(bar!.x + bar!.width + 0.5);
        expect(strip!.y + strip!.height).toBeLessThanOrEqual(bar!.y + bar!.height + 0.5);
        for (const box of await page.locator(".al-step").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()))) {
          expect(box.x).toBeGreaterThanOrEqual(strip!.x - 0.5);
          expect(box.x + box.width).toBeLessThanOrEqual(strip!.x + strip!.width + 0.5);
        }
        const top = await page.locator(".al-top").evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
        expect(top.sw).toBe(top.cw);
      });
    }

    test("labels when there is room, icons when there is not", async ({ page }) => {
      await openWith(page, size.width, size.height, [jobMessage(CASES[3]!)]);
      const wide = size.width >= 1200;
      await expect(page.locator(".al-stepper")).toHaveAttribute("data-icons", String(!wide));
      await expect(page.locator(".al-step-label").first()).toBeVisible({ visible: wide });
      // The full name stays reachable: every step has a tooltip with its name, its agent and its status.
      await expect(page.locator(".al-step").nth(2)).toHaveAttribute("title", /Build \(Developer\): done in/);
    });
  });
}

test("a click on a step opens the job card", async ({ page }) => {
  await openWith(page, 1366, 768, [jobMessage(CASES[3]!)]);
  await page.locator(".al-step").nth(2).click();
  await expect(page.getByRole("dialog", { name: "Job" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Job" })).toContainText("Validate todo titles in addTodo");
  await expect(page.getByRole("dialog", { name: "Job" })).toContainText("Credits: not reported by kiro-cli headless; see the Kiro usage panel");
});

test("ghosts show what they do, and the team bar shows the work", async ({ page }, testInfo) => {
  const work = (agentId: string, step: string, title: string, extra: Record<string, unknown> = {}) =>
    JSON.stringify({
      type: "work",
      agentId,
      work: { taskId: "task-d232d369", step, title, model: "claude-test", contextPct: 24.4, filesRead: 2, filesEdited: 1, startedAt: Date.now() - 12_000, ...extra },
    });
  const state = (agentId: string, s: string, text: string) => JSON.stringify({ type: "agent_state", agentId, state: s, text });
  await openWith(page, 1366, 768, [
    state("architect", "thinking", "Reading the repo"),
    work("architect", "analyze", "Analysing haunted-todo", { filesEdited: 0 }),
    state("developer", "working", "Editing files"),
    work("developer", "develop", "Reject empty titles in addTodo"),
    state("qa", "waiting_approval", "Plan ready"),
    state("builder", "error", "Failed"),
  ]);
  // The team bar block of a busy agent: title, step, elapsed time, context meter and file counts.
  const dev = page.locator(".al-team-row").nth(1);
  await expect(dev.locator(".al-team-work")).toBeVisible();
  await expect(dev.locator(".al-work-title")).toHaveText("Reject empty titles in addTodo");
  await expect(dev.locator(".al-work-step")).toContainText("develop");
  await expect(dev.locator(".al-work-ctx")).toContainText("ctx 24%");
  await expect(dev.locator(".al-meter")).toHaveAttribute("aria-valuenow", "24");
  await expect(dev).toContainText("2 read · 1 edited");
  // An agent that waits for the user shows no work block.
  await expect(page.locator(".al-team-row").nth(2).locator(".al-team-work")).toBeHidden();
  // The ghosts: a picture for the maintainer to look at; the checks above are the assertions.
  await page.waitForTimeout(600);
  await page.screenshot({ path: testInfo.outputPath("ghost-signs.png") });
});

test("the repository is a line when only one is allowed", async ({ page }) => {
  const repos = (list: { id: string; name: string }[]) => JSON.stringify({ type: "repos", repos: list });
  const open = JSON.stringify({ type: "open_panel", panel: "computer" });
  await openWith(page, 1366, 768, [repos([{ id: "haunted-todo", name: "haunted-todo" }]), open]);
  const panel = page.getByRole("dialog", { name: "Computer" });
  await expect(panel).toContainText("Allowed repositories: 1 (haunted-todo)");
  await expect(panel.getByRole("combobox")).toHaveCount(0);
  await expect(panel.locator("select")).toHaveCount(0);
});

test("the repository dropdown has the colours of the theme and works with the keyboard", async ({ page }) => {
  const repos = JSON.stringify({ type: "repos", repos: [{ id: "a", name: "alpha" }, { id: "b", name: "beta" }] });
  const open = JSON.stringify({ type: "open_panel", panel: "computer" });
  await openWith(page, 1366, 768, [repos, open]);
  const panel = page.getByRole("dialog", { name: "Computer" });
  const box = panel.getByRole("combobox", { name: "Repository" });
  await expect(box).toContainText("alpha");
  await box.click();
  const list = panel.getByRole("listbox");
  await expect(list).toBeVisible();
  // Not the white popup of the browser: the list and the button use the theme's dark background and light text.
  const colours = await list.evaluate((el) => {
    const s = getComputedStyle(el);
    const o = getComputedStyle(el.querySelector("[role=option][aria-selected=false]")!);
    return { bg: s.backgroundColor, text: o.color };
  });
  expect(colours.bg).toBe("rgb(11, 10, 18)");
  expect(colours.text).toBe("rgb(232, 224, 255)");
  // Keyboard: arrow down, Enter chooses beta; Escape closes the list but not the panel.
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(box).toContainText("beta");
  await expect(list).toBeHidden();
  await box.press("ArrowDown");
  await expect(list).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(list).toBeHidden();
  await expect(panel).toBeVisible();
});
