import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { zoomOf } from "./helpers.ts";

/** The one project of the scripted engine; its floor is built from `rooms/project-template.json` (12 x 10 tiles). */
const FLOOR = "project:haunted-todo";
const TILE_W = 64;
const TILE_H = 32;
/** Centre of the 12 x 10 room in scene coordinates (floor and back walls), as `roomBounds` computes it. */
const CENTRE = { x: 32, y: 112 };

/** Opens the haunted-todo floor (the client goes back to the floor it remembers). Returns the page errors seen so far. */
async function open(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("agentlife-guide-seen", "1");
    sessionStorage.setItem("agentlife-floor", "project:haunted-todo");
  });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/");
  await expect(page.locator(".al-status")).toBeHidden();
  await expect(page.locator(".al-stage > canvas")).toBeVisible();
  await expect(page.locator(".al-floor-label")).toHaveText("haunted-todo");
  await expect(page.locator(".al-doors")).toHaveAttribute("data-phase", "open");
  return errors;
}

const arrangeButton = (page: Page) => page.locator(".al-edit");
const bar = (page: Page) => page.locator(".al-arrange");
const piece = (page: Page) => page.locator(".al-arrange-piece");
const status = (page: Page) => page.locator(".al-arrange-status");
const bt = (page: Page, name: string) => bar(page).getByRole("button", { name, exact: true });

/** Where the middle of a tile is on the page, from the canvas size and the zoom (the room is centred in the stage). */
async function tilePoint(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const canvas = await page.locator(".al-stage > canvas").boundingBox();
  if (!canvas) throw new Error("no canvas");
  const zoom = await zoomOf(page);
  const rootX = Math.round(Math.floor(canvas.width) / 2 - CENTRE.x * zoom);
  const rootY = Math.round(Math.floor(canvas.height) / 2 - CENTRE.y * zoom);
  return {
    x: canvas.x + rootX + ((x - y) * TILE_W * zoom) / 2,
    y: canvas.y + rootY + ((x + y) * TILE_H * zoom) / 2,
  };
}

async function clickTile(page: Page, x: number, y: number): Promise<void> {
  const p = await tilePoint(page, x, y);
  await page.mouse.click(p.x, p.y);
}

async function startArranging(page: Page): Promise<void> {
  await arrangeButton(page).click();
  await expect(bar(page)).toBeVisible();
  await expect(arrangeButton(page)).toHaveAttribute("aria-pressed", "true");
}

/** Back to the template, so the shared world-server is left as it was found (also after a test that failed halfway). */
async function resetFloor(page: Page): Promise<void> {
  if (!(await bar(page).isVisible())) await startArranging(page);
  await bt(page, "Reset layout").click();
  await bt(page, "Yes, reset").click();
  await expect(status(page)).toHaveText("Layout reset.");
  await arrangeButton(page).click();
  await expect(bar(page)).toBeHidden();
}

test.describe("arrange the furniture of a project floor", () => {
  test("move the plant with the arrow keys, turn it, leave, reload: it is still there", async ({ page }) => {
    const errors = await open(page);
    await startArranging(page);
    await resetFloor(page);
    await startArranging(page);
    await expect(status(page)).toContainText("Click a piece");

    await clickTile(page, 9, 8);
    await expect(piece(page)).toHaveText("Potted plant: tile 9, 8, facing south");

    await page.keyboard.press("ArrowLeft");
    await expect(piece(page)).toHaveText("Potted plant: tile 8, 8, facing south");
    await expect(status(page)).toHaveText("Saved.");
    await expect(status(page)).toHaveAttribute("data-tone", "ok");

    await page.keyboard.press("r");
    await expect(piece(page)).toHaveText("Potted plant: tile 8, 8, facing west");

    // Leave with Esc; the tool bar goes away and the button is not pressed any more.
    await page.keyboard.press("Escape");
    await expect(bar(page)).toBeHidden();
    await expect(arrangeButton(page)).toHaveAttribute("aria-pressed", "false");

    await page.reload();
    await expect(page.locator(".al-floor-label")).toHaveText("haunted-todo");
    await expect(page.locator(".al-doors")).toHaveAttribute("data-phase", "open");
    await startArranging(page);
    await clickTile(page, 8, 8);
    await expect(piece(page)).toHaveText("Potted plant: tile 8, 8, facing west");

    await resetFloor(page);
    expect(errors).toEqual([]);
  });

  test("a move that blocks the way is refused in red, with the reason, and nothing moves", async ({ page }) => {
    const errors = await open(page);
    await startArranging(page);
    await resetFloor(page);
    await startArranging(page);

    // The Developer's desk stands in front of the way to the computer desk.
    await clickTile(page, 4, 5);
    await expect(piece(page)).toContainText("Agent desk: tile 4, 5");
    await page.keyboard.press("ArrowDown");
    await expect(status(page)).toHaveText("Blocks the path to the computer desk.");
    await expect(status(page)).toHaveAttribute("data-tone", "bad");
    await expect(piece(page)).toContainText("Agent desk: tile 4, 5");
    await expect(bt(page, "Undo")).toBeDisabled();

    // The elevator never moves.
    await clickTile(page, 0, 8);
    await expect(status(page)).toHaveText("The elevator stays where it is.");
    await expect(status(page)).toHaveAttribute("data-tone", "bad");

    await arrangeButton(page).click();
    expect(errors).toEqual([]);
  });

  test("drag a piece with the mouse, then undo", async ({ page }) => {
    const errors = await open(page);
    await startArranging(page);
    await resetFloor(page);
    await startArranging(page);

    const from = await tilePoint(page, 9, 8);
    const to = await tilePoint(page, 7, 8);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await expect(status(page)).toHaveText("Release to put it here.");
    await page.mouse.up();
    await expect(piece(page)).toHaveText("Potted plant: tile 7, 8, facing south");
    await expect(status(page)).toHaveText("Saved.");

    await bt(page, "Undo").click();
    await expect(piece(page)).toHaveText("Potted plant: tile 9, 8, facing south");
    await expect(status(page)).toHaveText("Undone.");
    await expect(bt(page, "Undo")).toBeDisabled();

    await arrangeButton(page).click();
    expect(errors).toEqual([]);
  });

  test("Reset layout asks first, and no panel opens while arranging", async ({ page }) => {
    const errors = await open(page);
    await startArranging(page);

    await bt(page, "Reset layout").click();
    await expect(bar(page).getByRole("alertdialog")).toBeVisible();
    await bt(page, "Keep my layout").click();
    await expect(bar(page).getByRole("alertdialog")).toBeHidden();
    await expect(bt(page, "Reset layout")).toBeVisible();

    // Clicking the mailbox selects it. It does not open the mailbox.
    await clickTile(page, 0, 6);
    await expect(piece(page)).toContainText("Mailbox: tile 0, 6");
    await expect(page.locator(".al-panel")).toBeHidden();

    // After leaving, the same click opens the panel again.
    await page.keyboard.press("Escape");
    await expect(bar(page)).toBeHidden();
    await clickTile(page, 0, 6);
    await expect(page.getByRole("dialog", { name: "Mailbox" })).toBeVisible({ timeout: 20_000 });
    await page.keyboard.press("Escape");
    expect(errors).toEqual([]);
  });

  test("Edit room works on a project floor and is disabled in the lobby", async ({ page }) => {
    await open(page);
    await expect(arrangeButton(page)).toBeEnabled();
    await expect(arrangeButton(page)).toHaveText("Edit room");
    await page.getByRole("button", { name: /Take the elevator/ }).click();
    const panel = page.getByRole("dialog", { name: "Elevator" });
    await expect(panel).toBeVisible();
    await panel.getByRole("button", { name: /^Go to Lobby$/i }).click();
    await expect(page.locator(".al-floor-label")).toHaveText(/lobby/i);
    await expect(arrangeButton(page)).toBeDisabled();
  });
});
