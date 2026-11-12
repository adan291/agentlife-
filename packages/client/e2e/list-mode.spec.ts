import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

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

test.describe("list view and command palette", () => {
  test("switches between the hotel and the list with the button and with L, without reloading", async ({ page }) => {
    await open(page);
    await page.evaluate(() => ((window as unknown as { __kept: boolean }).__kept = true));
    await expect(page.locator(".al-list")).toBeHidden();

    await viewButton(page).click();
    await expect(page.locator(".al-list")).toBeVisible();
    await expect(row(page)).toBeVisible();
    await expect(page.locator(".al-shell")).toHaveAttribute("data-view", "list");
    await expect(viewButton(page)).toHaveText("Hotel");

    await page.keyboard.press("l");
    await expect(page.locator(".al-list")).toBeHidden();
    await page.keyboard.press("L");
    await expect(page.locator(".al-list")).toBeVisible();
    // The choice is remembered, and the page was never reloaded.
    expect(await page.evaluate(() => (window as unknown as { __kept?: boolean }).__kept)).toBe(true);
    expect(await page.evaluate(() => localStorage.getItem("agentlife-view"))).toBe("list");
  });

  test("L does nothing while typing in a field", async ({ page }) => {
    await open(page);
    await page.keyboard.press("Control+k");
    await page.locator(".al-palette-input").type("l");
    await expect(page.locator(".al-list")).toBeHidden();
    await page.keyboard.press("Escape");
    await expect(page.locator(".al-palette-wrap")).toBeHidden();
  });

  test("starts a job from the list, then approves the plan from the palette after going elsewhere", async ({ page }) => {
    test.setTimeout(90_000);
    await open(page);
    await viewButton(page).click();
    await expect(row(page)).toBeVisible();

    // New change job: the list moves to the floor and opens the Computer panel.
    await row(page).locator("button", { hasText: /^New change$/ }).click();
    const panel = page.locator(".al-panel");
    await expect(panel).toBeVisible();
    await expect(panel.locator("h3")).toHaveText("Computer");
    await panel.locator("textarea").fill("Add a title check to addTodo");
    await panel.getByRole("button", { name: "Start job" }).click();
    await page.keyboard.press("Escape");
    await expect(row(page)).toContainText("Working");

    // Leave the floor by the palette (it goes back to the hotel view in the lobby), then return to the list.
    await runCommand(page, "go to lobby");
    await expect(page.locator(".al-floor-label")).toHaveText(/lobby/i);
    await page.keyboard.press("l");
    await expect(page.locator(".al-list")).toBeVisible();

    // The plan arrives while the user is in the lobby: the row asks for the user.
    await expect(row(page).locator(".al-list-badge")).toHaveText(/Waiting for you/, { timeout: 30_000 });
    await expect(row(page)).toContainText("Your turn");

    // Approve plan: move to the floor, open the mailbox, press Approve.
    await runCommand(page, "approve plan");
    await expect(panel).toBeVisible();
    await expect(panel.locator("h3")).toHaveText("Mailbox");
    await expect(page.locator(".al-floor-label")).toHaveText("haunted-todo");
    await panel.getByRole("button", { name: "Approve" }).click();
    await page.keyboard.press("Escape");

    // The job leaves the approval step.
    await expect(row(page).locator(".al-list-badge")).toHaveCount(0);
    await expect(row(page)).not.toContainText("Your turn");
    await expect(row(page)).toContainText(/Build|Test|Review|Report|Done/);

    // It runs to the end; read the report from the palette, so the floor is left as it was found (the world-server is shared).
    await expect(row(page)).toContainText("Done", { timeout: 40_000 });
    await expect(row(page)).toContainText("Last report:");
    await runCommand(page, "open report");
    await expect(panel.locator("h3")).toHaveText("Mailbox");
    await expect(panel.locator(".al-report, .al-report-body, .al-card").first()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(row(page).locator(".al-list-chip")).toHaveText("Idle");
  });

  test("the palette is usable with the keyboard only", async ({ page }) => {
    await open(page);
    await page.keyboard.press("Control+k");
    await expect(page.locator(".al-palette")).toBeVisible();
    await expect(page.locator(".al-palette-item", { hasText: "Toggle view" })).toBeVisible();
    await expect(page.locator(".al-palette-key", { hasText: "L" })).toBeVisible();
    await page.keyboard.type("toggle");
    await expect(page.locator(".al-palette-item").first()).toHaveText(/Toggle view/);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowUp");
    await expect(page.locator(".al-palette-item").first()).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Enter");
    await expect(page.locator(".al-list")).toBeVisible();
    // Ctrl+K again closes it, and so does Esc.
    await page.keyboard.press("Control+k");
    await expect(page.locator(".al-palette")).toBeVisible();
    await page.keyboard.press("Control+k");
    await expect(page.locator(".al-palette-wrap")).toBeHidden();
  });
});
