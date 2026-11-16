import type { Page } from "@playwright/test";
import { expect, expectScreen, test } from "./support/fixtures.ts";
import { COMPUTER, FLOOR_NAME, FLOOR_ROOM, SIZES, balance, clickPiece, goTo, looks, mailbox, openHotel, runCommand, tilePoint, useFurniture, waitForRoom } from "./support/world.ts";
import type { Size } from "./support/world.ts";

/** A free tile on the floor of the template, away from every piece, standing spot and path. */
const FERN_SPOT = { x: 2, y: 1 };

/**
 * User journeys (regression-suite, requirement 1). Each test starts a hotel of its own (`support/hotel.ts`: a scripted
 * engine, scratch files, the page connected to it) and walks through it as a user does. After each screen the layout and
 * interface rules of `support/rules.ts` are checked. Every journey runs at the three window sizes.
 */

const menuButton = (page: Page) => page.getByRole("button", { name: "Menu" });
const menu = (page: Page) => page.getByRole("menu", { name: "Menu" });
const editBar = (page: Page) => page.locator(".al-arrange");
const piece = (page: Page) => page.locator(".al-arrange-piece");
const status = (page: Page) => page.locator(".al-arrange-status");

/** Edit room: a button in the top bar from 900 px up, an item of the Menu below. */
async function startEditing(page: Page, size: Size): Promise<void> {
  if (size.width >= 900) {
    await page.locator(".al-top .al-edit").click();
  } else {
    await menuButton(page).click();
    await menu(page).getByRole("menuitem", { name: /^Edit room/ }).click();
  }
  await expect(editBar(page)).toBeVisible();
}

/** The Profile: the level button of the top bar from 900 px up, an item of the Menu below. */
async function openProfile(page: Page, size: Size): Promise<void> {
  if (size.width >= 900) {
    await page.locator(".al-level").click();
  } else {
    await menuButton(page).click();
    await menu(page).getByRole("menuitem", { name: /^Profile/ }).click();
  }
}

async function stopEditing(page: Page, size: Size): Promise<void> {
  if (size.width >= 900) {
    await page.locator(".al-top .al-edit").click();
  } else {
    await menuButton(page).click();
    await menu(page).getByRole("menuitem", { name: /^Done editing/ }).click();
  }
  await expect(editBar(page)).toBeHidden();
}

for (const size of SIZES) {
  test.describe(`at ${size.width}x${size.height}`, () => {
    test("lobby: edit the room, use the Menu with the keyboard, wave from the Actions menu", async ({ page, hotel }) => {
      await openHotel(page, size);
      await expectScreen(page, "lobby");

      // Edit room: the plant moves and turns, twice in a row, and can be picked again where it stands.
      await startEditing(page, size);
      await expectScreen(page, "lobby, editing");
      await clickPiece(page, "lobby", 0, 3);
      await expect(piece(page)).toHaveText("Potted plant: tile 0, 3, facing south");
      await page.keyboard.press("ArrowRight");
      await expect(piece(page)).toHaveText("Potted plant: tile 1, 3, facing south");
      await expect(status(page)).toHaveText("Saved.");
      await page.keyboard.press("r");
      await expect(piece(page)).toHaveText("Potted plant: tile 1, 3, facing west");
      await expect(status(page)).toHaveText("Saved.");
      await page.keyboard.press("ArrowRight");
      await expect(piece(page)).toHaveText("Potted plant: tile 2, 3, facing west");
      await page.keyboard.press("r");
      await expect(piece(page)).toHaveText("Potted plant: tile 2, 3, facing north");
      await expect(status(page)).toHaveText("Saved.");
      // Another piece, then the plant again: a moved piece can be selected where it is now.
      await clickPiece(page, "lobby", 6, 9);
      await expect(piece(page)).toContainText("Sofa");
      await clickPiece(page, "lobby", 2, 3);
      await expect(piece(page)).toHaveText("Potted plant: tile 2, 3, facing north");
      await stopEditing(page, size);
      await expectScreen(page, "lobby, edited");

      // The Menu opens with the keyboard, moves with the arrows and closes with Esc.
      await menuButton(page).focus();
      await page.keyboard.press("Enter");
      await expect(menu(page)).toBeVisible();
      await expectScreen(page, "menu");
      const items = menu(page).getByRole("menuitem");
      await expect(items.first()).toBeFocused();
      await page.keyboard.press("ArrowDown");
      await expect(items.nth(1)).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(menu(page)).toBeHidden();
      await expect(menuButton(page)).toBeFocused();

      // The Actions menu runs Wave, and the server is told.
      const actions = page.getByRole("button", { name: /^Actions/ });
      await actions.click();
      const list = page.getByRole("menu", { name: "Actions" });
      await expect(list).toBeVisible();
      await expectScreen(page, "actions menu");
      await list.getByRole("menuitem", { name: /^Wave/ }).click();
      await expect(list).toBeHidden();
      await expect.poll(() => hotel.sent.some((m) => m.includes('"type":"emote"') && m.includes('"emote":"wave"'))).toBe(true);
    });

    test("one run through the hotel: shop, HR office, a floor, a job to its delivered branch, the Profile", async ({ page }) => {
      test.setTimeout(150_000);
      await openHotel(page, size);
      const START = 500;
      const FERN = 14;
      const CAP = 40;
      // balance() reads from the DOM so it may still show the old value if the wallet update races the page render.
      await expect.poll(() => balance(page)).toBe(START);

      // The shop counter: buy a fern and the flat cap; the balance falls by the prices.
      const counter = await tilePoint(page, "lobby", 4, 4);
      await page.mouse.click(counter.x, counter.y);
      const shop = page.getByRole("dialog", { name: "Shop" });
      await expect(shop).toBeVisible();
      await expectScreen(page, "shop");
      await shop.getByRole("tab", { name: "Plants" }).click();
      const fern = shop.locator('.al-shop-item[data-item="fern"]');
      await fern.getByRole("button", { name: /^Buy Fern/ }).click();
      await expect(fern).toContainText("You own 1");
      await expect.poll(() => balance(page)).toBe(START - FERN);
      await shop.getByRole("tab", { name: "Outfits" }).click();
      await expectScreen(page, "shop, outfits");
      const cap = shop.locator('.al-shop-item[data-part="flat_cap"]');
      await cap.getByRole("button", { name: /^Buy Checked flat cap/ }).click();
      await expect(cap).toContainText("Owned");
      await expect.poll(() => balance(page)).toBe(START - FERN - CAP);
      await shop.getByRole("button", { name: "Close panel" }).click();
      await expect(shop).toBeHidden();

      // The HR office: the cap goes on the Developer, and the preview changes.
      await goTo(page, "HR Office");
      const desk = await tilePoint(page, "hr", 4, 0);
      await page.mouse.click(desk.x, desk.y - 12);
      const hr = page.getByRole("dialog", { name: "HR desk" });
      await expect(hr).toBeVisible();
      await expectScreen(page, "HR desk");
      const member = hr.locator('section[data-project="haunted-todo"] li[data-member="developer"]');
      const before = await member.locator(".al-look-preview img").getAttribute("src");
      await member.locator('select[data-slot="hat"]').selectOption("flat_cap");
      await expect(member.locator('select[data-slot="hat"]')).toHaveValue("flat_cap");
      await expect(member.locator(".al-look-preview img")).not.toHaveAttribute("src", before ?? "");
      await hr.getByRole("button", { name: "Close panel" }).click();
      await expect(hr).toBeHidden();

      // The project floor: the Developer wears the cap; the fern goes on the floor from the inventory tray.
      await goTo(page, FLOOR_NAME);
      await expect.poll(() => looks(page)).toEqual({ developer: "flat_cap||" });
      await expectScreen(page, "project floor");
      await startEditing(page, size);
      await expectScreen(page, "project floor, editing");
      const tray = page.locator(".al-tray");
      await expect(tray).toBeVisible();
      await tray.locator('button[data-item="fern"]').click();
      const spot = await tilePoint(page, "project", FERN_SPOT.x, FERN_SPOT.y);
      await page.mouse.move(spot.x, spot.y, { steps: 6 });
      await expect(status(page)).toHaveText("Click to place it here.");
      await page.mouse.click(spot.x, spot.y);
      await expect(status(page)).toHaveText("Placed.");
      await expect(piece(page)).toHaveText(`Fern: tile ${FERN_SPOT.x}, ${FERN_SPOT.y}, facing south`);
      await stopEditing(page, size);

      // The computer: start a job. The plan arrives and waits for the user.
      await useFurniture(page, COMPUTER);
      const panel = page.locator(".al-panel");
      await expect(panel.locator("h3").first()).toHaveText("Computer");
      await expectScreen(page, "computer");
      await panel.locator("textarea").fill("Add a title check to addTodo");
      await panel.getByRole("button", { name: "Start job" }).click();
      await page.keyboard.press("Escape");
      await expect(panel).toBeHidden();

      // A wisp shows up while the job runs; catching it pays 1 Ecto.
      const wisp = page.locator(".al-wisp:not([hidden])");
      await expect(wisp).toBeVisible({ timeout: 20_000 });
      await expectScreen(page, "floor with a wisp");
      const beforeWisp = await balance(page);
      await wisp.click({ force: true });
      await expect.poll(() => balance(page)).toBe(beforeWisp + 1);

      // The mailbox: approve the plan.
      await expect(page.locator('.al-turn[data-kind="your-turn"]')).toBeVisible({ timeout: 30_000 });
      await useFurniture(page, mailbox(`Approve plan in ${FLOOR_NAME}`));
      await expect(panel.locator("h3").first()).toHaveText("Mailbox");
      await expectScreen(page, "mailbox with a plan");
      await panel.getByRole("button", { name: "Approve" }).click();
      await page.keyboard.press("Escape");
      await expect(panel).toBeHidden();

      // The job runs to its end. The report row says a branch is ready; the row opens the report; Deliver; the branch shows.
      await expect(page.locator('.al-turn[data-kind="report"]')).toBeVisible({ timeout: 60_000 });
      const route = await useFurniture(page, mailbox(`Open report of ${FLOOR_NAME}`));
      if (route === "palette") await panel.getByRole("button", { name: /Back to the mailbox/ }).click();
      await expect(panel.locator("h3").first()).toHaveText("Mailbox");
      const row = panel.locator(".al-report-item");
      await expect(row).toHaveCount(1);
      await expect(row).toContainText("Branch ready");
      await expectScreen(page, "mailbox with a report");
      await row.click();
      await expectScreen(page, "report, branch ready");
      await panel.getByRole("button", { name: "Deliver as branch" }).click();
      const delivered = panel.locator('.al-delivery[data-delivery="done"]');
      await expect(delivered).toContainText(/Delivered as branch agentlife\/task-\d+ \(commit 3f2a9c1\)/);
      await expectScreen(page, "report, delivered");
      await panel.getByRole("button", { name: /Back to the mailbox/ }).click();
      await expect(row).not.toContainText("Branch ready");
      await page.keyboard.press("Escape");
      await expect(panel).toBeHidden();

      // The Profile: level, XP, the badge for the approved plan and the quests of the run.
      await openProfile(page, size);
      const profile = page.getByRole("dialog", { name: "Profile" });
      await expect(profile).toBeVisible();
      await expectScreen(page, "profile");
      await expect(profile).toContainText(/Lv \d+/);
      await expect(profile).toContainText(/\d+ XP/);
      await expect(profile.locator('[data-badge="approver"][data-earned="true"]')).toBeVisible();
      await profile.getByRole("tab", { name: "Quests" }).click();
      await expect(profile.locator('[data-quest][data-done="true"]')).toHaveCount(3);
      await expectScreen(page, "profile, quests");
      await page.keyboard.press("Escape");
      await expect(profile).toBeHidden();

      // A reload keeps the floor: the Developer still wears the cap and the fern is still where it was put.
      await page.reload();
      await waitForRoom(page, FLOOR_NAME);
      await expect.poll(() => looks(page)).toEqual({ developer: "flat_cap||" });
      await startEditing(page, size);
      await clickPiece(page, "project", FERN_SPOT.x, FERN_SPOT.y);
      await expect(piece(page)).toHaveText(`Fern: tile ${FERN_SPOT.x}, ${FERN_SPOT.y}, facing south`);
      await stopEditing(page, size);
    });

    test("list view and the command palette: start a job from its row, approve the plan and open the report from Ctrl+K", async ({ page }) => {
      test.setTimeout(120_000);
      await openHotel(page, size);
      await page.keyboard.press("l");
      const list = page.locator(".al-list");
      await expect(list).toBeVisible();
      const row = page.locator(`.al-list-row[data-room="${FLOOR_ROOM}"]`);
      await expect(row).toBeVisible();
      await expectScreen(page, "list");

      await row.locator("button", { hasText: /^New change$/ }).click();
      const panel = page.locator(".al-panel");
      await expect(panel.locator("h3").first()).toHaveText("Computer");
      await panel.locator("textarea").fill("Add a title check to addTodo");
      await panel.getByRole("button", { name: "Start job" }).click();
      await page.keyboard.press("Escape");
      await expect(row).toContainText("Working");
      await expect(row.locator(".al-list-badge")).toHaveText(/Waiting for you/, { timeout: 30_000 });
      await expectScreen(page, "list, plan waiting");

      // The palette lists the command of this very job; Approve plan takes the user to the mailbox of the floor.
      await page.keyboard.press("Control+k");
      await expect(page.locator(".al-palette-input")).toBeFocused();
      await page.locator(".al-palette-input").fill("approve plan");
      await expect(page.locator(".al-palette-item").first()).toContainText(`Approve plan in ${FLOOR_NAME}`);
      await expectScreen(page, "palette");
      await page.keyboard.press("Enter");
      await expect(page.locator(".al-palette-wrap")).toBeHidden();
      await expect(panel.locator("h3").first()).toHaveText("Mailbox");
      await panel.getByRole("button", { name: "Approve" }).click();
      await page.keyboard.press("Escape");
      await expect(row).toContainText("Done", { timeout: 60_000 });
      await expect(row).toContainText("Last report:");
      await expectScreen(page, "list, job done");

      // Open report: the viewer opens on the report itself, not on the list of the mailbox.
      await runCommand(page, `open report of ${FLOOR_NAME}`);
      await expect(panel.locator("h3").first()).toHaveText("Mailbox");
      await expect(panel.getByRole("button", { name: "Deliver as branch" })).toBeVisible();
      await expectScreen(page, "report from the palette");
    });
  });
}
