import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

async function open(page: Page, width = 1366, height = 768): Promise<void> {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("agentlife-guide-seen", "1");
  });
  await page.setViewportSize({ width, height });
  await page.goto("/");
  await expect(page.locator(".al-status")).toBeHidden();
  await expect(page.locator(".al-stage > canvas")).toBeVisible();
}

/** The world-server of these tests has a scratch wallet (`AGENTLIFE_WALLET_FILE` in `playwright.config.ts`). */
const balance = (page: Page) => page.locator(".al-balance");

test.describe("Ecto balance", () => {
  for (const [width, height] of [
    [1366, 768],
    [375, 667],
  ] as const) {
    test(`is visible on the stage at ${width}x${height}, away from the job stepper`, async ({ page }) => {
      await open(page, width, height);
      await expect(balance(page)).toBeVisible();
      await expect(balance(page)).toHaveText(/^\d+ Ecto$/);
      await expect(balance(page)).toHaveAttribute("aria-label", /^\d+ Ecto$/);
      const chip = await balance(page).boundingBox();
      const stage = await page.locator(".al-stage").boundingBox();
      expect(chip).not.toBeNull();
      expect(stage).not.toBeNull();
      // Inside the stage, in its top left corner.
      expect(chip!.x).toBeGreaterThanOrEqual(stage!.x);
      expect(chip!.y).toBeGreaterThanOrEqual(stage!.y);
      expect(chip!.x + chip!.width).toBeLessThanOrEqual(stage!.x + stage!.width);
      // It takes no room from the top bar: the stepper keeps its labels at 1366 px.
      if (width >= 1200) {
        const top = await page.locator(".al-top").boundingBox();
        expect(chip!.y).toBeGreaterThanOrEqual(top!.y + top!.height);
      }
    });
  }

  test("does not overflow the top bar at 1366 px (the job-insight tests check the stepper's labels with the chip on)", async ({ page }) => {
    await open(page);
    await expect(balance(page)).toBeVisible();
    const overflow = await page.locator(".al-top").evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
