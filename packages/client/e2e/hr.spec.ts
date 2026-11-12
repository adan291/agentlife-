import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/** Starts in the HR office (the floor the client remembers) with no guide card in the way. */
async function openHrOffice(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    // The dev server has no favicon: that 404 is not ours.
    if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) errors.push(m.text());
  });
  await page.addInitScript(() => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    localStorage.clear();
    localStorage.setItem("agentlife-guide-seen", "1");
    localStorage.setItem("agentlife-floor", "hr");
  });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/");
  return errors;
}

test("the HR office draws its desk and its ghost without errors, and has no agents in the team bar", async ({ page }) => {
  const errors = await openHrOffice(page);
  await expect(page.locator(".al-floor-label")).toHaveText("HR Office");
  await expect(page.locator(".al-stage > canvas")).toBeVisible();
  await expect(page.locator(".al-doors")).toHaveAttribute("data-phase", "open");
  // The HR ghost is scenery: the team bar lists the agents of the simulation only.
  await expect(page.locator(".al-team-row:not([hidden])")).toHaveCount(0);
  // Let a few frames draw the new furniture and the ghost.
  await page.evaluate(() => new Promise<void>((resolve) => setTimeout(resolve, 500)));
  // For a look by eye: set E2E_SHOT_DIR to a folder and the picture is written there.
  const shotDir = process.env["E2E_SHOT_DIR"];
  if (shotDir) await page.screenshot({ path: `${shotDir}/hr-office.png` });
  expect(errors).toEqual([]);
});

test("the elevator of the HR office takes the user back to the lobby", async ({ page }) => {
  await openHrOffice(page);
  await expect(page.locator(".al-floor-label")).toHaveText("HR Office");
  await page.getByRole("button", { name: /Take the elevator/ }).click();
  const panel = page.getByRole("dialog", { name: "Elevator" });
  await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: "Go to Lobby" }).click();
  await expect(page.locator(".al-floor-label")).toHaveText("Lobby");
});
