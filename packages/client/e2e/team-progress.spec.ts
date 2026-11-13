import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

// This spec has a world-server of its own (see playwright.config.ts): its scratch progress file, wallet and quest pool.
test.use({ baseURL: "http://127.0.0.1:5198" });

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

async function runCommand(page: Page, query: string): Promise<void> {
  await page.keyboard.press("Control+k");
  const input = page.locator(".al-palette-input");
  await expect(input).toBeFocused();
  await input.fill(query);
  await expect(page.locator(".al-palette-item").first()).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator(".al-palette-wrap")).toBeHidden();
}

test.describe("levels, badges and quests", () => {
  test("a scripted job raises the Developer's XP in the team bar, earns a badge and completes the day's quests", async ({ page }) => {
    test.setTimeout(120_000);
    await open(page);
    // Nothing happened yet: the user is level 0 and the profile button says so.
    await expect(page.locator(".al-level")).toHaveText("Lv 0");

    // Run one job from the list: start it, approve the plan from the palette, wait for the end.
    await viewButton(page).click();
    await row(page).locator("button", { hasText: /^New change$/ }).click();
    const panel = page.locator(".al-panel");
    await panel.locator("textarea").fill("Add a title check to addTodo");
    await panel.getByRole("button", { name: "Start job" }).click();
    await page.keyboard.press("Escape");
    await expect(row(page).locator(".al-list-badge")).toHaveText(/Waiting for you/, { timeout: 30_000 });
    await runCommand(page, "approve plan");
    await expect(panel.locator("h3").first()).toHaveText("Mailbox");
    await panel.getByRole("button", { name: "Approve" }).click();
    await page.keyboard.press("Escape");
    await expect(row(page)).toContainText("Done", { timeout: 60_000 });

    // The hotel view: the Developer row of the team bar shows the XP of the steps and of the passed job (10 + 25).
    await page.keyboard.press("l");
    await expect(page.locator(".al-list")).toBeHidden();
    const developer = page.locator(".al-team-row", { hasText: "Developer" });
    await expect(developer.locator(".al-team-level")).toHaveText("Lv 0 · 15 XP to Lv 1");
    await expect(page.locator(".al-team-row", { hasText: "QA" }).locator(".al-team-level")).toHaveText("Lv 0 · 15 XP to Lv 1");

    // The user earned XP for the approved plan and the passed job, and Ecto for the job and for the three quests.
    await expect(page.locator(".al-level")).toHaveText("Lv 0");
    await expect(page.locator(".al-level")).toHaveAttribute("aria-label", /30 XP to Lv 1 \(20 XP\)/);
    const ecto = page.locator(".al-balance");
    await expect.poll(async () => Number.parseInt((await ecto.innerText()).replace(/\D/g, ""), 10)).toBeGreaterThanOrEqual(15 + 3 * 5);

    // The Profile panel: three quests, all done, and the badge for the approved plan.
    await page.locator(".al-level").click();
    await expect(panel.locator("h3").first()).toHaveText("Profile");
    await expect(panel.locator('[data-badge="approver"][data-earned="true"]')).toBeVisible();
    await expect(panel.locator('[data-badge="approver"] svg')).toHaveCount(1);
    await panel.getByRole("tab", { name: "Quests" }).click();
    const quests = panel.locator("[data-quest]");
    await expect(quests).toHaveCount(3);
    await expect(panel.locator('[data-quest][data-done="true"]')).toHaveCount(3);
    await expect(quests.first()).toContainText("Done");
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
  });

  test("after a reload the quests are still done and the profile button is still there", async ({ page }) => {
    await open(page);
    // The server kept everything: the same user level, the same quests, all done.
    await expect(page.locator(".al-level")).toBeVisible();
    await page.locator(".al-level").click();
    const panel = page.locator(".al-panel");
    await panel.getByRole("tab", { name: "Quests" }).click();
    await expect(panel.locator('[data-quest][data-done="true"]')).toHaveCount(3);
  });
});
