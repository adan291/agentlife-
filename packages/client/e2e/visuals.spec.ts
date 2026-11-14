import type { Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test as hotelTest } from "./support/fixtures.ts";
import type { Hotel, SeedPiece } from "./support/hotel.ts";
import { FROZEN_AT, expectLooksLike, freezeForScreenshots, missingBaselines, timeMasks } from "./support/visual.ts";
import { COMPUTER, FLOOR_NAME, SIZES, canvasHit, goTo, mailbox, openHotel, runCommand, tilePoint, useFurniture } from "./support/world.ts";
import type { Size } from "./support/world.ts";

/**
 * Visual comparisons (regression-suite, requirement 3): each room and each panel at the three window sizes, compared with the
 * baselines of this platform under `e2e/__visuals__/<platform>/`. Motion and time are frozen before the page loads
 * (`support/visual.ts`), so two runs give the same pixels. A platform with no baselines skips this file and says so.
 * `pnpm --filter @agentlife/client e2e:update-visuals` writes them on purpose.
 */

/** Skips the test, before its hotel starts, when this platform has no baselines. Fixtures marked `auto` are set up first. */
const test = hotelTest.extend<{ baselines: void }>({
  baselines: [
    async ({}, use, testInfo) => {
      const why = missingBaselines(testInfo);
      testInfo.skip(why !== undefined, why ?? "");
      await use();
    },
    { auto: true },
  ],
});

// The same words on every machine: dates and times the page writes follow the browser's time zone and language.
test.use({ timezoneId: "UTC", locale: "en-US" });

/** A floor with every kind of bought piece the shop sells in one place: plants, a rug, lights, seats, a table, a poster. */
const DECORATED: readonly SeedPiece[] = [
  { item: "fern", x: 2, y: 1, dir: 0 },
  { item: "palm", x: 8, y: 8, dir: 0 },
  { item: "cactus", x: 11, y: 6, dir: 0 },
  { item: "candelabra", x: 9, y: 0, dir: 0 },
  { item: "lava_lamp", x: 1, y: 5, dir: 0 },
  { item: "armchair", x: 7, y: 5, dir: 4 },
  { item: "round_table", x: 6, y: 7, dir: 0 },
  { item: "rune_rug", x: 2, y: 3, dir: 0 },
  { item: "moon_poster", x: 6, y: 0, dir: 4 },
];

const menuButton = (page: Page) => page.getByRole("button", { name: "Menu" });
const menu = (page: Page) => page.getByRole("menu", { name: "Menu" });

/** Edit room and Profile: a button of the top bar from 900 px up, an item of the Menu below (as the journeys do). */
async function topOrMenu(page: Page, size: Size, button: string, item: RegExp): Promise<void> {
  if (size.width >= 900) {
    await page.locator(button).click();
  } else {
    await menuButton(page).click();
    await menu(page).getByRole("menuitem", { name: item }).click();
  }
}

/** Opens the panel of a piece of furniture by clicking its drawing, when that point reaches the canvas at this window size. */
async function openByClick(page: Page, room: "lobby" | "hr" | "project", tile: { x: number; y: number }): Promise<boolean> {
  const p = await tilePoint(page, room, tile.x, tile.y);
  const point = { x: p.x, y: p.y - 12 };
  if (!(await canvasHit(page, point))) return false;
  await page.mouse.click(point.x, point.y);
  return true;
}

/**
 * Opens the panel of a piece of furniture the way a user does: by clicking its drawing. Where the piece lies outside the stage
 * at this window size, the message the list and the palette send for the same panel is sent instead (`show_panel`), and the
 * route goes into the annotations, as `useFurniture` does. The panels that message cannot open are left to the caller.
 */
async function openPiece(
  page: Page,
  hotel: Hotel,
  room: "lobby" | "project",
  piece: { name: string; tile: { x: number; y: number }; panel?: "mailbox" | "board" },
): Promise<boolean> {
  if (await openByClick(page, room, piece.tile)) {
    test.info().annotations.push({ type: "route", description: `${piece.name}: canvas` });
    return true;
  }
  if (piece.panel === undefined) {
    test.info().annotations.push({ type: "skipped screen", description: `${piece.name}: outside the stage at this size, and no message opens it` });
    return false;
  }
  test.info().annotations.push({ type: "route", description: `${piece.name}: show_panel` });
  hotel.inject({ type: "show_panel", panel: piece.panel });
  return true;
}

async function open(page: Page, size: Size, floor: "lobby" | "project" = "lobby"): Promise<void> {
  await freezeForScreenshots(page);
  await openHotel(page, size, floor);
}

for (const size of SIZES) {
  test.describe(`visuals at ${size.width}x${size.height}`, () => {
    test.setTimeout(90_000);

    test("rooms: lobby, HR office, project floor", async ({ page }) => {
      await open(page, size);
      await expectLooksLike(page, "lobby", size);
      await goTo(page, "HR Office");
      await expectLooksLike(page, "hr-office", size);
      await goTo(page, FLOOR_NAME);
      await expectLooksLike(page, "floor-default", size);
    });

    test("panels in the lobby", async ({ page }) => {
      await open(page, size);

      const shop = page.getByRole("dialog", { name: "Shop" });
      const counter = await tilePoint(page, "lobby", 4, 4);
      await page.mouse.click(counter.x, counter.y);
      await expect(shop).toBeVisible();
      await expectLooksLike(page, "shop-furniture", size);
      await shop.getByRole("tab", { name: "Outfits" }).click();
      await expectLooksLike(page, "shop-outfits", size);
      await shop.getByRole("button", { name: "Close panel" }).click();
      await expect(shop).toBeHidden();

      await page.getByRole("button", { name: /Take the elevator/ }).click();
      await expect(page.getByRole("dialog", { name: "Elevator" })).toBeVisible();
      await expectLooksLike(page, "elevator", size);
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog", { name: "Elevator" })).toBeHidden();

      await menuButton(page).click();
      await expect(menu(page)).toBeVisible();
      await expectLooksLike(page, "menu", size);
      await page.keyboard.press("Escape");
      await expect(menu(page)).toBeHidden();

      await page.getByRole("button", { name: /^Actions/ }).click();
      await expect(page.getByRole("menu", { name: "Actions" })).toBeVisible();
      await expectLooksLike(page, "actions-menu", size);
      await page.keyboard.press("Escape");

      await topOrMenu(page, size, ".al-level", /^Profile/);
      const profile = page.getByRole("dialog", { name: "Profile" });
      await expect(profile).toBeVisible();
      await expectLooksLike(page, "profile-badges", size);
      await profile.getByRole("tab", { name: "Look" }).click();
      await expectLooksLike(page, "profile-look", size);
      await page.keyboard.press("Escape");
      await expect(profile).toBeHidden();

      await topOrMenu(page, size, ".al-top .al-edit", /^Edit room/);
      await expect(page.locator(".al-arrange")).toBeVisible();
      await expectLooksLike(page, "lobby-editing", size);
      await topOrMenu(page, size, ".al-top .al-edit", /^Done editing/);
      await expect(page.locator(".al-arrange")).toBeHidden();

      await page.keyboard.press("Control+k");
      await expect(page.locator(".al-palette-input")).toBeFocused();
      await expectLooksLike(page, "palette", size);
      await page.keyboard.press("Escape");
      await expect(page.locator(".al-palette-wrap")).toBeHidden();

      await page.keyboard.press("l");
      await expect(page.locator(".al-list")).toBeVisible();
      await expectLooksLike(page, "list", size);
      await page.keyboard.press("l");
      await expect(page.locator(".al-list")).toBeHidden();

      await page.keyboard.press("?");
      const help = page.getByRole("dialog", { name: "How it works" });
      await expect(help).toBeVisible();
      await expectLooksLike(page, "help", size);
      await page.keyboard.press("Escape");
      await expect(help).toBeHidden();

      const reception = await tilePoint(page, "lobby", 1, 0);
      await page.mouse.click(reception.x, reception.y - 12);
      await expect(page.locator(".al-panel h3").first()).toHaveText(/Reception/);
      await expectLooksLike(page, "reception", size);
    });

    test.describe("a job running", () => {
      test.use({ hotelSeed: { noWisps: true } });

      test("panels of a job: activity, plan, job card, report", async ({ page }) => {
        test.setTimeout(150_000);
        await open(page, size, "project");
        const panel = page.locator(".al-panel");
        const masks = timeMasks(page);

        await useFurniture(page, COMPUTER);
        await expect(panel.locator("h3").first()).toHaveText("Computer");
        await panel.locator("textarea").fill("Add a title check to addTodo");
        await panel.getByRole("button", { name: "Start job" }).click();
        await page.keyboard.press("Escape");
        await expect(panel).toBeHidden();

        // The job stops at the plan and waits for the user: its lines in the activity terminal, then the plan in the mailbox.
        await expect(page.locator('.al-turn[data-kind="your-turn"]')).toBeVisible({ timeout: 30_000 });
        await expect(page.locator(".al-term-row").first()).toBeAttached();
        await expectLooksLike(page, "activity-lines", size, masks);
        await useFurniture(page, mailbox(`Approve plan in ${FLOOR_NAME}`));
        await expect(panel.locator("h3").first()).toHaveText("Mailbox");
        await expect(panel.getByRole("button", { name: "Approve" })).toBeVisible();
        await expectLooksLike(page, "plan", size, masks);
        await panel.getByRole("button", { name: "Approve" }).click();
        await page.keyboard.press("Escape");
        await expect(panel).toBeHidden();

        // The job ends: the job card from the progress strip, then the report from the mailbox.
        await expect(page.locator('.al-turn[data-kind="report"]')).toBeVisible({ timeout: 60_000 });
        await page.locator(".al-step, .al-stepper-compact").locator("visible=true").first().click();
        const card = page.getByRole("dialog", { name: "Job" });
        await expect(card).toBeVisible();
        await expect(card.locator(".al-table tbody tr")).not.toHaveCount(0);
        await expectLooksLike(page, "job-card", size, masks);
        await page.keyboard.press("Escape");
        await expect(card).toBeHidden();

        const route = await useFurniture(page, mailbox(`Open report of ${FLOOR_NAME}`));
        if (route === "palette") await panel.getByRole("button", { name: /Back to the mailbox/ }).click();
        await expect(panel.locator(".al-report-item")).toHaveCount(1);
        await expectLooksLike(page, "mailbox-report", size, masks);
        await panel.locator(".al-report-item").click();
        await expect(panel.getByRole("button", { name: "Deliver as branch" })).toBeVisible();
        await expectLooksLike(page, "report", size, masks);
      });
    });

    test("panels on the HR office and a project floor", async ({ page, hotel }) => {
      await open(page, size);
      await goTo(page, "HR Office");
      const desk = await tilePoint(page, "hr", 4, 0);
      await page.mouse.click(desk.x, desk.y - 12);
      const hr = page.getByRole("dialog", { name: "HR desk" });
      await expect(hr).toBeVisible();
      await expectLooksLike(page, "hr-desk", size);
      await hr.locator('[data-tab="imports"]').click();
      await expect(hr.locator(".al-hr-import")).toHaveCount(2);
      await expectLooksLike(page, "hr-imports", size);
      await hr.getByRole("button", { name: "Close panel" }).click();
      await expect(hr).toBeHidden();

      await goTo(page, FLOOR_NAME);
      await useFurniture(page, COMPUTER);
      const panel = page.locator(".al-panel");
      await expect(panel.locator("h3").first()).toHaveText("Computer");
      await expectLooksLike(page, "computer", size);
      await page.keyboard.press("Escape");
      await expect(panel).toBeHidden();

      // The mailbox lies outside the stage at 360 px, and no palette command opens an empty mailbox: there the message
      // the list sends for it opens it (`show_panel`), which is all the furniture does too.
      expect(await openPiece(page, hotel, "project", { name: "mailbox", tile: { x: 0, y: 6 }, panel: "mailbox" })).toBe(true);
      await expect(panel.locator("h3").first()).toHaveText("Mailbox");
      await expectLooksLike(page, "mailbox-empty", size);
      await page.keyboard.press("Escape");
      await expect(panel).toBeHidden();
    });

    test("panels of the desks of a floor: review, tests, library, board", async ({ page, hotel }) => {
      await open(page, size, "project");
      const panel = page.locator(".al-panel");
      const title = panel.locator("h3").first();

      await runCommand(page, `New branch review job in ${FLOOR_NAME}`);
      await expect(title).toHaveText("Review desk");
      await expect(panel).toContainText("compared with main");
      await expectLooksLike(page, "review-desk", size);
      await page.keyboard.press("Escape");
      await expect(panel).toBeHidden();

      await runCommand(page, `New test-writing job in ${FLOOR_NAME}`);
      await expect(title).toHaveText("Test lab");
      await expect(panel.getByRole("button", { name: "Write tests" })).toBeVisible();
      await expectLooksLike(page, "test-lab", size);
      await page.keyboard.press("Escape");
      await expect(panel).toBeHidden();

      // The notes show the date and time they were written. The browser runs in UTC with the en-US locale (`test.use` above),
      // so those words are the same on every machine and are compared like the rest.
      await runCommand(page, `New documentation job in ${FLOOR_NAME}`);
      await expect(title).toHaveText("Library");
      await expect(panel).toContainText("Remembered (4)");
      await expectLooksLike(page, "library-memory", size);
      await panel.locator('[data-tab="docs"]').click();
      await expect(panel.getByRole("button", { name: "Write docs" })).toBeVisible();
      await expectLooksLike(page, "library-docs", size);
      await page.keyboard.press("Escape");
      await expect(panel).toBeHidden();

      // The board of a floor with no job yet: the pipeline editor on top of an empty job card.
      expect(await openPiece(page, hotel, "project", { name: "board", tile: { x: 0, y: 3 }, panel: "board" })).toBe(true);
      await expect(title).toHaveText("Job");
      await expect(panel.locator(".al-pipe-card")).toHaveCount(6);
      await expectLooksLike(page, "pipeline-editor", size);
      await page.keyboard.press("Escape");
      await expect(panel).toBeHidden();
    });

    test("directory and night board in the lobby", async ({ page, hotel }) => {
      await open(page, size);
      const panel = page.locator(".al-panel");
      const title = panel.locator("h3").first();

      // No palette command and no message opens the directory: it is compared where a user can click it.
      if (await openPiece(page, hotel, "lobby", { name: "directory", tile: { x: 5, y: 0 } })) {
        await expect(title).toHaveText("Floors");
        await expectLooksLike(page, "directory", size);
        await page.keyboard.press("Escape");
        await expect(panel).toBeHidden();
      }

      await runCommand(page, "Schedule night job");
      await expect(title).toHaveText("Night shift");
      await expect(panel).toContainText("Reject an empty title in addTodo");
      await expectLooksLike(page, "night-board", size);
      await panel.locator(".al-panel-body").evaluate((body) => {
        body.scrollTop = body.scrollHeight;
      });
      await expectLooksLike(page, "night-form", size);
      await page.keyboard.press("Escape");
      await expect(panel).toBeHidden();
    });

    test.describe("a frozen progress clock", () => {
      // The day that picks the quests comes from the progress clock, fixed here at the page's frozen time.
      test.use({ hotelSeed: { progressNow: FROZEN_AT.getTime() } });

      test("construction board, its report and the Profile's quests", async ({ page, hotel }) => {
        await open(page, size);
        const panel = page.locator(".al-panel");
        // The scripted engine shows fixed board data (`FAKE_PANELS=1`, `fakeBuildBoard`).
        if (await openPiece(page, hotel, "lobby", { name: "construction-board", tile: { x: 7, y: 0 } })) {
          await expect(panel.locator("h3").first()).toHaveText("Construction board");
          await expect(panel).toContainText("night-shift");
          await expectLooksLike(page, "construction-board", size);
          await panel.getByRole("button", { name: "Open the verification report of hotel-floors" }).click();
          await expect(panel).toContainText("Verification of hotel-floors");
          await expectLooksLike(page, "construction-board-report", size);
          await page.keyboard.press("Escape");
          await expect(panel).toBeHidden();
        }

        await topOrMenu(page, size, ".al-level", /^Profile/);
        const profile = page.getByRole("dialog", { name: "Profile" });
        await expect(profile).toBeVisible();
        await profile.getByRole("tab", { name: "Quests" }).click();
        await expect(profile.locator(".al-quest")).toHaveCount(3);
        await expectLooksLike(page, "profile-quests", size);
        await page.keyboard.press("Escape");
      });
    });

    test.describe("a floor with a coffee machine", () => {
      // The coffee machine has no panel: using it serves coffee to the most tired desk agent, or says nobody needs it, in a
      // speech bubble. What can be compared is the piece standing on a floor, which is the only part of it a user sees.
      test.use({ hotelSeed: { placed: { [FLOOR_NAME]: [{ item: "coffee_machine", x: 2, y: 1, dir: 4 }] } } });

      test("floor-coffee-machine", async ({ page, hotel }) => {
        await open(page, size, "project");
        // A piece the room could not take goes back to the stock; the screenshot would then show a floor without it.
        const inventory = JSON.parse(await readFile(join(hotel.dir, "inventory.json"), "utf8")) as { stock: Record<string, number>; placed: Record<string, unknown[]> };
        expect(inventory.placed[FLOOR_NAME]).toHaveLength(1);
        expect(inventory.stock).toEqual({});
        await expectLooksLike(page, "floor-coffee-machine", size);
      });
    });

    test.describe("a decorated floor", () => {
      test.use({ hotelSeed: { placed: { [FLOOR_NAME]: DECORATED } } });

      test("floor-decorated", async ({ page, hotel }) => {
        await open(page, size, "project");
        // A piece the room could not take goes back to the stock; the screenshot would then show a floor that is not decorated.
        const inventory = JSON.parse(await readFile(join(hotel.dir, "inventory.json"), "utf8")) as { stock: Record<string, number>; placed: Record<string, unknown[]> };
        expect(inventory.placed[FLOOR_NAME]).toHaveLength(DECORATED.length);
        expect(inventory.stock).toEqual({});
        await expectLooksLike(page, "floor-decorated", size);
      });
    });
  });
}
