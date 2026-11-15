import type { Page } from "@playwright/test";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, expectScreen, test } from "./support/fixtures.ts";
import { SEEDED_BUGS } from "./support/bugs.ts";
import { SIZES, clickPiece, openHotel } from "./support/world.ts";

/**
 * The Bug sack (spec bug-sack, requirement 6.3): an error thrown in the page lands in the Game tab, F8 with a note saves a
 * manual bug with a screenshot, and Fixed and Copy for Kiro work. Each test has a hotel of its own with an empty Bug sack
 * (`support/hotel.ts`). The errors these tests throw are caused on purpose, so the fixture accepts them (`causedErrors`).
 */

test.use({ causedErrors: [/Bug sack test/] });

const menuButton = (page: Page) => page.getByRole("button", { name: "Menu" });
const menu = (page: Page) => page.getByRole("menu", { name: "Menu" });
const sack = (page: Page) => page.getByRole("dialog", { name: "Bug sack" });
const form = (page: Page) => page.getByRole("dialog", { name: "Report a bug" });

/** Throws an error nobody catches, from a timer, as a bug in the page would. */
async function throwInPage(page: Page, message: string): Promise<void> {
  await page.evaluate((m) => {
    setTimeout(() => {
      throw new Error(m);
    }, 0);
  }, message);
}

async function openSackFromMenu(page: Page, name: string | RegExp = /^Bugs/): Promise<void> {
  await menuButton(page).click();
  await menu(page).getByRole("menuitem", { name }).click();
  await expect(sack(page)).toBeVisible();
}

for (const size of SIZES) {
  test.describe(`at ${size.width}x${size.height}`, () => {
    test("an error thrown in the page appears in the Game tab, with a dot until it is read", async ({ page }) => {
      await openHotel(page, size);
      // The Menu lists the Bug sack as soon as the connection says there is one, and nothing is in it yet.
      await expect(menuButton(page)).toHaveAttribute("data-dot", "false");
      await menuButton(page).click();
      await expect(menu(page).getByRole("menuitem", { name: "Bugs", exact: true })).toBeVisible();
      await expect(menu(page).getByRole("menuitem", { name: /^Report a bug/ })).toBeVisible();
      await page.keyboard.press("Escape");

      await throwInPage(page, "Bug sack test: the jar tipped over");
      await expect(menuButton(page)).toHaveAttribute("data-dot", "true");
      await menuButton(page).click();
      await expect(menu(page).getByRole("menuitem", { name: "Bugs (1)" })).toBeVisible();
      await menu(page).getByRole("menuitem", { name: "Bugs (1)" }).click();

      const panel = sack(page);
      await expect(panel).toBeVisible();
      await expect(menuButton(page)).toHaveAttribute("data-dot", "false");
      await expect(panel.getByRole("tab", { name: "Game (1)" })).toBeVisible();
      const item = panel.locator("[data-bug]");
      await expect(item).toHaveCount(1);
      await expect(item).toContainText("Bug sack test: the jar tipped over");
      await expect(item).toContainText("uncaught");
      await expect(item).toContainText("floor lobby");
      await expectScreen(page, "bug sack, game tab");

      // Nothing was caught on the code side.
      await panel.getByRole("tab", { name: "Code" }).click();
      await expect(panel).toContainText("Nothing caught yet. The code side has been quiet.");
      await expectScreen(page, "bug sack, code tab");
    });

    test("F8 with a note saves a manual bug with a screenshot of the room", async ({ page, hotel }) => {
      await openHotel(page, size);
      await page.keyboard.press("F8");
      const dialog = form(page);
      await expect(dialog).toBeVisible();
      const attach = dialog.getByRole("checkbox", { name: "Attach a screenshot of the room" });
      // The picture is taken when the form opens; the box is on and can be changed once it is ready.
      await expect(attach).toBeEnabled();
      await expect(attach).toBeChecked();
      await expectScreen(page, "report a bug");
      await dialog.getByRole("textbox", { name: "What went wrong?" }).fill("The jar is empty after I bought a fern");
      await dialog.getByRole("button", { name: "Save bug" }).click();
      await expect(dialog).toBeHidden();
      await expect(page.locator(".al-toast")).toHaveText("Bug saved. Open the Bug sack to see it.");

      // The picture reached the server in pieces and is a PNG on disk.
      const shots = join(hotel.dir, "bugs");
      await expect.poll(async () => (await readdir(shots).catch(() => [])).filter((f) => f.endsWith(".png")).length, { timeout: 10_000 }).toBe(1);
      const [file] = (await readdir(shots)).filter((f) => f.endsWith(".png"));
      const bytes = await readFile(join(shots, file!));
      expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      expect(bytes.length).toBeGreaterThan(1000);
      expect(bytes.length).toBeLessThanOrEqual(1024 * 1024);

      await openSackFromMenu(page, "Bugs (1)");
      const panel = sack(page);
      const item = panel.locator("[data-bug]");
      await expect(item).toContainText("manual");
      await expect(item).toContainText("The jar is empty after I bought a fern");
      await expect(item).toContainText("screenshot");
      await item.click();
      await expect(panel.locator("[data-bug-detail]")).toBeVisible();
      await expect(panel).toContainText("Note: The jar is empty after I bought a fern");
      await panel.getByRole("button", { name: "Show screenshot" }).click();
      const picture = panel.getByRole("img", { name: /Screenshot of the room/ });
      await expect(picture).toBeVisible();
      await expect.poll(() => picture.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(100);
      await expectScreen(page, "bug sack, details with a screenshot");
    });

    test("a report without a screenshot is kept too, and Cancel keeps nothing", async ({ page, hotel }) => {
      await openHotel(page, size);
      await page.keyboard.press("F8");
      const dialog = form(page);
      const attach = dialog.getByRole("checkbox", { name: "Attach a screenshot of the room" });
      await expect(attach).toBeEnabled();
      await attach.uncheck();
      await dialog.getByRole("textbox", { name: "What went wrong?" }).fill("No picture please");
      await dialog.getByRole("button", { name: "Save bug" }).click();
      await expect(page.locator(".al-toast")).toHaveText("Bug saved. Open the Bug sack to see it.");
      await expect(menuButton(page)).toBeVisible();

      await page.keyboard.press("F8");
      await dialog.getByRole("textbox", { name: "What went wrong?" }).fill("Never mind");
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();

      await openSackFromMenu(page, "Bugs (1)");
      await expect(sack(page).locator("[data-bug]")).toHaveCount(1);
      await expect(sack(page).locator("[data-bug]")).toContainText("No picture please");
      expect(await readdir(join(hotel.dir, "bugs")).catch(() => [])).toEqual([]);
    });
  });
}

test.describe("at 1366x768", () => {
  const size = SIZES[2];

  test("Fixed and Copy for Kiro work", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await openHotel(page, size);
    await throwInPage(page, "Bug sack test: copy me");
    await expect(menuButton(page)).toHaveAttribute("data-dot", "true");
    await openSackFromMenu(page, "Bugs (1)");
    const panel = sack(page);

    // Copy for Kiro: one group, with what a chat needs.
    await panel.locator("[data-bug]").click();
    await panel.getByRole("button", { name: "Copy this bug for Kiro" }).click();
    await expect(panel.locator(".al-bug-notice")).toHaveText("Copied 1 bug for Kiro.");
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toContain("[game/client] uncaught: Error: Bug sack test: copy me");
    expect(copied).toContain("# Bug (1)");
    expect(copied).not.toContain("<img");

    // Mark it fixed: it leaves the open list and the count, and is found under Fixed.
    await panel.getByRole("button", { name: "Mark fixed" }).click();
    await expect(panel.locator("dl")).toContainText("Fixed");
    await panel.getByRole("button", { name: "Back to the list" }).click();
    await expect(panel.getByRole("button", { name: "Open (0)" })).toBeVisible();
    await expect(panel.getByRole("tab", { name: "Game", exact: true })).toBeVisible();
    await expect(panel.locator("[data-bug]")).toHaveCount(0);
    await panel.getByRole("button", { name: "Fixed (1)" }).click();
    await expect(panel.locator("[data-bug]")).toHaveCount(1);
    await expect(panel.locator("[data-bug]")).toContainText("Fixed");
    await page.keyboard.press("Escape");
    await menuButton(page).click();
    await expect(menu(page).getByRole("menuitem", { name: "Bugs", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");

    // Open again: it is back in the list and the count.
    await openSackFromMenu(page, "Bugs");
    await panel.getByRole("button", { name: "Fixed (1)" }).click();
    await panel.locator("[data-bug]").click();
    await panel.getByRole("button", { name: "Open again" }).click();
    await panel.getByRole("button", { name: "Back to the list" }).click();
    await panel.getByRole("button", { name: "Open (1)" }).click();
    await expect(panel.locator("[data-bug]")).toHaveCount(1);

    // Copy all open game bugs for Kiro, from the foot of the list.
    await panel.getByRole("button", { name: "Copy all open game bugs for Kiro" }).click();
    await expect(panel.locator(".al-bug-notice")).toHaveText("Copied 1 bug for Kiro.");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("# Open game bugs (1)");
  });

  test("a bug that arrives while the Bug sack is open shows up in it, and lights no dot", async ({ page }) => {
    await openHotel(page, size);
    await openSackFromMenu(page);
    const panel = sack(page);
    await expect(panel).toContainText("Nothing caught yet. The game side has been quiet.");
    await throwInPage(page, "Bug sack test: while the panel is open");
    await expect(panel.locator("[data-bug]")).toHaveCount(1);
    await expect(panel.getByRole("tab", { name: "Game (1)" })).toBeVisible();
    await expect(menuButton(page)).toHaveAttribute("data-dot", "false");
  });

  test("the same error again is not sent twice, and the search finds the other one", async ({ page }) => {
    await openHotel(page, size);
    await throwInPage(page, "Bug sack test: repeated 1");
    await expect(menuButton(page)).toHaveAttribute("data-dot", "true");
    await page.waitForTimeout(100);
    // The same error with another number is a duplicate inside ten seconds: the page counts it and does not send it.
    await throwInPage(page, "Bug sack test: repeated 2");
    await throwInPage(page, "Bug sack test: another failure");
    await openSackFromMenu(page, /^Bugs/);
    const panel = sack(page);
    await expect(panel.locator("[data-bug]")).toHaveCount(2);
    await panel.getByRole("searchbox", { name: "Search bugs" }).fill("another");
    await expect(panel.locator("[data-bug]")).toHaveCount(1);
    await expect(panel.locator("[data-bug]")).toContainText("another failure");
    await panel.getByRole("searchbox", { name: "Search bugs" }).fill("");
    await expect(panel.locator("[data-bug]")).toHaveCount(2);
  });

  test("the bug jar in the lobby opens the Bug sack", async ({ page }) => {
    await openHotel(page, size);
    await clickPiece(page, "lobby", 0, 5);
    await expect(sack(page)).toBeVisible();
    await expect(sack(page)).toContainText("Nothing caught yet");
  });
});

test.describe("what the server caught", () => {
  test.use({ hotelSeed: { bugs: SEEDED_BUGS } });
  const size = SIZES[2];

  test("the Code tab lists the engine's bugs with where they happened, and the filters and the details work", async ({ page }) => {
    await openHotel(page, size);
    await openSackFromMenu(page, /^Bugs \(4\)/);
    const panel = sack(page);
    await expect(panel.getByRole("tab", { name: "Game (2)" })).toBeVisible();
    await expect(panel.getByRole("tab", { name: "Code (2)" })).toBeVisible();
    await panel.getByRole("tab", { name: "Code (2)" }).click();
    const rows = panel.locator("[data-bug]");
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText("Developer step failed");
    await expect(rows.first()).toContainText("agent engine");
    await expect(rows.first()).toContainText("task task-0042, step developer");
    await expect(rows.first()).toContainText("x12");
    await expectScreen(page, "bug sack, code tab with bugs");

    await panel.getByRole("button", { name: "Ignored (1)" }).click();
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText("engine stream: fetch failed");
    await panel.getByRole("button", { name: "Open (2)" }).click();
    await rows.first().click();
    const details = panel.locator("[data-bug-detail]");
    await expect(details).toContainText("at runStep (runner.ts:211:11)");
    await expect(details).toContainText("First frame");
    await expect(details).toContainText("runStep@runner.ts");
    await expectScreen(page, "bug sack, details of a code bug");
    await panel.getByRole("button", { name: "Ignore", exact: true }).click();
    await panel.getByRole("button", { name: "Back to the list" }).click();
    await expect(panel.getByRole("tab", { name: "Code (1)" })).toBeVisible();
    await expect(menuButton(page)).toHaveAttribute("data-dot", "false");
  });
});
