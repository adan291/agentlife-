import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/** The one project of the scripted engine; its floor is built from `rooms/project-template.json` (12 x 10 tiles). */
const FLOOR = "project:haunted-todo";
const TILE_W = 64;
const TILE_H = 32;
/** Centre of the 12 x 10 room in scene coordinates (floor and back walls), as `roomBounds` computes it. */
const CENTRE = { x: 32, y: 112 };
/** A free tile on the floor of the template, away from every piece, standing spot and path. */
const SPOT = { x: 2, y: 1 };

/**
 * The world-server of these tests has a scratch wallet with Ecto and an empty inventory (`playwright.config.ts`), and
 * the fake engine, so the floor is the template of `haunted-todo`. The tests leave the floor as they found it.
 */
async function open(page: Page, floor: string | null = null): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript((remembered) => {
    localStorage.clear();
    localStorage.setItem("agentlife-guide-seen", "1");
    if (remembered) sessionStorage.setItem("agentlife-floor", remembered);
  }, floor);
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/");
  await expect(page.locator(".al-status")).toBeHidden();
  await expect(page.locator(".al-stage > canvas")).toBeVisible();
  await expect(page.locator(".al-floor-label")).toHaveText(floor ? "haunted-todo" : "Lobby");
  await expect(page.locator(".al-doors")).toHaveAttribute("data-phase", "open");
  return errors;
}

/** Where a floor tile is on the page, from the canvas size and the zoom (the room is centred in the stage). */
async function tileCentre(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const canvas = await page.locator(".al-stage > canvas").boundingBox();
  if (!canvas) throw new Error("no canvas");
  const zoomText = await page.locator(".al-top-right .al-btn", { hasText: /^[12]×$/ }).textContent();
  const zoom = Number.parseInt(zoomText ?? "1", 10);
  const rootX = Math.round(Math.floor(canvas.width) / 2 - CENTRE.x * zoom);
  const rootY = Math.round(Math.floor(canvas.height) / 2 - CENTRE.y * zoom);
  return {
    x: canvas.x + rootX + ((x - y) * TILE_W * zoom) / 2,
    y: canvas.y + rootY + ((x + y) * TILE_H * zoom) / 2,
  };
}

const arrangeButton = (page: Page) => page.locator(".al-arrange-open");
const bar = (page: Page) => page.locator(".al-arrange");
const piece = (page: Page) => page.locator(".al-arrange-piece");
const status = (page: Page) => page.locator(".al-arrange-status");
const tray = (page: Page) => page.locator(".al-tray");
const bt = (page: Page, name: string) => bar(page).getByRole("button", { name, exact: true });
const trayItem = (page: Page, itemId: string) => tray(page).locator(`button[data-item="${itemId}"]`);

async function startArranging(page: Page): Promise<void> {
  await arrangeButton(page).click();
  await expect(bar(page)).toBeVisible();
  await expect(tray(page)).toBeVisible();
}

/** The tray lists an item with its count, and does not list it at all when none is left. */
async function expectOwned(page: Page, itemId: string, name: string, count: number): Promise<void> {
  if (count === 0) await expect(trayItem(page, itemId)).toHaveCount(0);
  else await expect(trayItem(page, itemId)).toHaveAccessibleName(`${name}, you have ${count}`);
}

/** Buys one fern at the shop counter of the lobby. Returns how many ferns the user owns afterwards. */
async function buyFern(page: Page): Promise<number> {
  const counter = await tileCentre(page, 4, 4);
  await page.mouse.click(counter.x, counter.y);
  const panel = page.getByRole("dialog", { name: "Shop" });
  await expect(panel).toBeVisible();
  await panel.getByRole("tab", { name: "Plants" }).click();
  const card = panel.locator('.al-shop-item[data-item="fern"]');
  const before = Number((await card.textContent())?.match(/You own (\d+)/)?.[1] ?? "0");
  await card.getByRole("button", { name: /^Buy Fern/ }).click();
  await expect(card).toContainText(`You own ${before + 1}`);
  await panel.getByRole("button", { name: "Close panel" }).click();
  await expect(panel).toBeHidden();
  return before + 1;
}

test.describe("place bought furniture on a floor", () => {
  test("buy a fern, drag it from the tray onto the floor, reload: it is still there; pick it up", async ({ page }) => {
    const errors = await open(page);
    const owned = await buyFern(page);

    // Go to the project floor (the client goes back to the floor it remembers).
    await page.evaluate((floor) => sessionStorage.setItem("agentlife-floor", floor), FLOOR);
    await page.reload();
    await expect(page.locator(".al-floor-label")).toHaveText("haunted-todo");
    await expect(page.locator(".al-doors")).toHaveAttribute("data-phase", "open");

    await startArranging(page);
    await expectOwned(page, "fern", "Fern", owned);

    // Take it from the tray and drag it over the floor: a green preview, then release.
    const from = await trayItem(page, "fern").boundingBox();
    expect(from).not.toBeNull();
    await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
    await page.mouse.down();
    await expect(trayItem(page, "fern")).toHaveAttribute("aria-pressed", "true");
    const to = await tileCentre(page, SPOT.x, SPOT.y);
    await page.mouse.move(to.x, to.y, { steps: 10 });
    await expect(status(page)).toHaveText("Click to place it here.");
    await expect(piece(page)).toHaveText(`Fern: tile ${SPOT.x}, ${SPOT.y}, facing south`);
    await page.mouse.up();

    await expect(status(page)).toHaveText("Placed.");
    await expect(status(page)).toHaveAttribute("data-tone", "ok");
    await expect(piece(page)).toHaveText(`Fern: tile ${SPOT.x}, ${SPOT.y}, facing south`);
    await expectOwned(page, "fern", "Fern", owned - 1);
    await expect(bt(page, "Pick up")).toBeEnabled();

    // Reload: the piece is on the floor and the tray shows one fern less.
    await page.keyboard.press("Escape");
    await expect(bar(page)).toBeHidden();
    await page.reload();
    await expect(page.locator(".al-floor-label")).toHaveText("haunted-todo");
    await expect(page.locator(".al-doors")).toHaveAttribute("data-phase", "open");
    await startArranging(page);
    await expectOwned(page, "fern", "Fern", owned - 1);
    const there = await tileCentre(page, SPOT.x, SPOT.y);
    await page.mouse.click(there.x, there.y);
    await expect(piece(page)).toHaveText(`Fern: tile ${SPOT.x}, ${SPOT.y}, facing south`);

    // Pick it up again: the floor is as it was and the fern is back in the tray.
    await bt(page, "Pick up").click();
    await expect(status(page)).toHaveText("Back in your inventory.");
    await expectOwned(page, "fern", "Fern", owned);
    await expect(piece(page)).toHaveText("Nothing selected");
    await bt(page, "Done").click();
    await expect(bar(page)).toBeHidden();
    expect(errors).toEqual([]);
  });

  test("click the item, then click the floor; a piece of the template cannot be picked up; Esc puts the item back", async ({ page }) => {
    const errors = await open(page);
    await buyFern(page);
    await page.evaluate((floor) => sessionStorage.setItem("agentlife-floor", floor), FLOOR);
    await page.reload();
    await expect(page.locator(".al-floor-label")).toHaveText("haunted-todo");
    await expect(page.locator(".al-doors")).toHaveAttribute("data-phase", "open");
    await startArranging(page);

    // The plant of the template can be moved but not picked up.
    const plant = await tileCentre(page, 9, 8);
    await page.mouse.click(plant.x, plant.y);
    await expect(piece(page)).toContainText("Potted plant: tile 9, 8");
    await expect(bt(page, "Pick up")).toBeDisabled();

    // Esc puts a carried item back before it leaves arrange mode.
    await trayItem(page, "fern").click();
    await expect(trayItem(page, "fern")).toHaveAttribute("aria-pressed", "true");
    await expect(status(page)).toContainText("Esc puts it back");
    await page.keyboard.press("Escape");
    await expect(trayItem(page, "fern")).toHaveAttribute("aria-pressed", "false");
    await expect(bar(page)).toBeVisible();

    // A taken tile is red with the reason, and nothing is sent.
    await trayItem(page, "fern").click();
    await page.mouse.move(plant.x, plant.y, { steps: 6 });
    await expect(status(page)).toHaveText("That tile is taken.");
    await expect(status(page)).toHaveAttribute("data-tone", "bad");

    // Then a free tile: click to place.
    const spot = await tileCentre(page, SPOT.x, SPOT.y);
    await page.mouse.move(spot.x, spot.y, { steps: 6 });
    await expect(status(page)).toHaveText("Click to place it here.");
    await page.mouse.click(spot.x, spot.y);
    await expect(status(page)).toHaveText("Placed.");
    await expect(piece(page)).toHaveText(`Fern: tile ${SPOT.x}, ${SPOT.y}, facing south`);

    // It moves with the arrow keys like any piece, and the fern, unlike the plant, can be picked up.
    await page.keyboard.press("ArrowRight");
    await expect(piece(page)).toHaveText(`Fern: tile ${SPOT.x + 1}, ${SPOT.y}, facing south`);
    await expect(status(page)).toHaveText("Saved.");
    await bt(page, "Pick up").click();
    await expect(status(page)).toHaveText("Back in your inventory.");
    await bt(page, "Done").click();
    expect(errors).toEqual([]);
  });

  test("the lobby cannot be arranged, so nothing can be placed there", async ({ page }) => {
    await open(page);
    await expect(arrangeButton(page)).toBeHidden();
    await expect(tray(page)).toBeHidden();
  });
});
