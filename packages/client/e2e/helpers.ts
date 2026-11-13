import type { Page } from "@playwright/test";

/** The zoom in use (1 or 2). The top bar does not print it any more; it keeps it in `data-zoom` on the right group. */
export async function zoomOf(page: Page): Promise<number> {
  const value = await page.locator(".al-top-right").getAttribute("data-zoom");
  return Number.parseInt(value ?? "1", 10);
}

/** The hotel / list toggle of the top bar. */
export const viewToggle = (page: Page) => page.locator(".al-top-right .al-view-toggle");
