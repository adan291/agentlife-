import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

// This spec has a world-server of its own (see playwright.config.ts): scratch wallet, and wisps every 300 to 500 ms.
test.use({ baseURL: "http://127.0.0.1:5197" });
test.describe.configure({ mode: "serial" });

/** The one project of the scripted engine. */
const ROOM = "project:haunted-todo";

async function open(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("agentlife-guide-seen", "1");
  });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/");
  await expect(page.locator(".al-status")).toBeHidden();
  await expect(page.locator(".al-stage > canvas")).toBeVisible();
}

const viewButton = (page: Page) => page.locator(".al-top-right .al-btn", { hasText: /^(List|Hotel)$/ });
const row = (page: Page) => page.locator(`.al-list-row[data-room="${ROOM}"]`);
const balance = async (page: Page): Promise<number> => Number.parseInt((await page.locator(".al-balance").innerText()).replace(/\D/g, ""), 10);

async function runCommand(page: Page, query: string): Promise<void> {
  await page.keyboard.press("Control+k");
  const input = page.locator(".al-palette-input");
  await expect(input).toBeFocused();
  await input.fill(query);
  await expect(page.locator(".al-palette-item").first()).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator(".al-palette-wrap")).toBeHidden();
}

test.describe("wisps", () => {
  test("a wisp appears during a job, and catching it adds 1 Ecto", async ({ page }) => {
    test.setTimeout(60_000);
    await open(page);
    await expect(page.locator(".al-balance")).toHaveText("0 Ecto");
    // No job, no wisp.
    await expect(page.locator(".al-wisp:not([hidden])")).toHaveCount(0);

    // Start a job from the list; it waits for the plan to be approved, so it stays active.
    await viewButton(page).click();
    await row(page).locator("button", { hasText: /^New change$/ }).click();
    const panel = page.locator(".al-panel");
    await panel.locator("textarea").fill("Add a title check to addTodo");
    await panel.getByRole("button", { name: "Start job" }).click();
    await page.keyboard.press("Escape");
    await expect(row(page)).toContainText("Working");
    await page.keyboard.press("l");
    await expect(page.locator(".al-list")).toBeHidden();

    // A wisp shows up over the floor. The button follows it, so the click is forced: the position moves from frame to frame.
    const wisp = page.locator(".al-wisp:not([hidden])");
    await expect(wisp).toBeVisible({ timeout: 15_000 });
    await expect(wisp).toHaveAccessibleName("Catch the wisp");
    const before = await balance(page);
    await wisp.click({ force: true });
    await expect.poll(() => balance(page)).toBe(before + 1);
    await expect(page.locator(".al-toast")).toHaveText("+1 Ecto: wisp caught");
  });
});

test.describe("wisps with reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("the wisp does not move, and the job ends cleanly", async ({ page }) => {
    test.setTimeout(90_000);
    await open(page);
    // The job from the first test still runs on its floor.
    await runCommand(page, "go to haunted-todo");
    await expect(page.locator(".al-floor-label")).toHaveText("haunted-todo");
    const wisp = page.locator(".al-wisp:not([hidden])");
    await expect(wisp).toBeVisible({ timeout: 15_000 });
    const read = () => wisp.evaluate((el: HTMLElement) => ({ id: el.dataset["wisp"], left: el.style.left, top: el.style.top }));
    const first = await read();
    await page.waitForTimeout(500);
    const second = await read();
    // The same wisp stays where it is (a new one may have come in between, on another tile).
    if (first.id === second.id) expect(second).toEqual(first);

    // Approve the plan so that the job runs to its end and the scripted world is left clean for the next run.
    await viewButton(page).click();
    await expect(row(page).locator(".al-list-badge")).toHaveText(/Waiting for you/, { timeout: 30_000 });
    await runCommand(page, "approve plan");
    const panel = page.locator(".al-panel");
    await panel.getByRole("button", { name: "Approve" }).click();
    await page.keyboard.press("Escape");
    await expect(row(page)).toContainText("Done", { timeout: 60_000 });
    // Once the job is over no wisp comes any more.
    await page.keyboard.press("l");
    await expect(page.locator(".al-wisp:not([hidden])")).toHaveCount(0, { timeout: 15_000 });
  });
});
