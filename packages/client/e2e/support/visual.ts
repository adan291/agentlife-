import { expect } from "@playwright/test";
import type { Locator, Page, TestInfo } from "@playwright/test";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import type { Size } from "./world.ts";

/**
 * Visual comparisons (regression-suite, requirement 3). A screenshot is only worth comparing when two runs of the same
 * screen give the same pixels, so everything that moves or tells the time is frozen before the page loads.
 */

/**
 * What the page believes the time is. Far in the future on purpose: the server stamps walks, bubbles and wisps with the real
 * time, so a page whose clock is later than all of them sees every walk finished and every bubble gone, whichever day the
 * test runs. The year is also what makes a clock text in the page the same on every run.
 */
export const FROZEN_AT = new Date("2030-01-01T12:00:00Z");

/**
 * Freezes what moves, before the first load of the page:
 * - `prefers-reduced-motion: reduce` turns off by itself the motes, the pulse of the glow, the bounce of the mailbox, the
 *   flicker of the lamps and candles, the bob of the ghosts and the door animation (the client reads it for exactly this);
 * - `Date.now()` and `new Date()` are fixed, and the scene is drawn from `Date.now()` (`world.tick`), so nothing that is
 *   still timed (an emote loop, a blink, the elapsed times of the team bar) can differ between two runs.
 * The seeds need no freezing: the client has no `Math.random`, its wisps come from a sine hash of the index.
 */
export async function freezeForScreenshots(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.setFixedTime(FROZEN_AT);
}

/** The folder of the baselines of this platform (`snapshotPathTemplate` of `playwright.config.ts`). */
export function baselineDir(testInfo: TestInfo): string {
  return dirname(testInfo.snapshotPath("probe.png"));
}

/** Why the visual step cannot run on this platform, or undefined when it can (or when baselines are being written on purpose). */
export function missingBaselines(testInfo: TestInfo): string | undefined {
  const writing = testInfo.config.updateSnapshots === "all" || testInfo.config.updateSnapshots === "changed";
  if (writing || existsSync(baselineDir(testInfo))) return undefined;
  return `No visual baselines for ${process.platform}. Run \`pnpm --filter @agentlife/client e2e:update-visuals\` on this platform to write them.`;
}

/**
 * Compares the page with the baseline `<screen>-<size>.png`. The mouse goes to a corner first so no hover state is left, and
 * the screenshot waits until two takes in a row are the same. On a failure Playwright keeps the expected, actual and diff
 * images in the report. `mask` lists what the server stamps with the real time (clock times, durations): it is painted over in
 * both images, so the rest of the screen is still compared.
 */
export async function expectLooksLike(page: Page, screen: string, size: Size, mask: readonly Locator[] = []): Promise<void> {
  await page.mouse.move(0, 0);
  await expect(page).toHaveScreenshot(`${screen}-${size.name}.png`, { mask: [...mask] });
}

/**
 * What a job's panels show that depends on the real time or the date: the clock times of the activity lines, the report rows
 * and the timeline, the durations (steps table and progress strip), and the Ecto balance (the quests the date picks pay
 * different amounts). Everything else on those panels is the same on every run.
 */
export function timeMasks(page: Page): Locator[] {
  return [
    page.locator(".al-term-time"),
    page.locator(".al-report-item .al-muted"),
    page.locator(".al-report-head .al-muted"),
    page.locator(".al-timeline"),
    page.locator(".al-table td:nth-child(5)"),
    page.locator(".al-term-latest"),
    page.locator(".al-step-time"),
    page.locator(".al-balance"),
  ];
}
