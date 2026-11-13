import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { zoomOf } from "./helpers.ts";

/**
 * Every room can be edited (ui-tidy requirement 6.4): the lobby, the HR office and a project floor. The world-server of
 * these tests keeps its layouts in a scratch file (`playwright.config.ts`); each test leaves its room as it found it.
 */
const TILE_W = 64;
const TILE_H = 32;
/** Centre of a room in scene coordinates: ((W - H) * 16, (maxY - 128) / 2) for a floor of W x H tiles. */
const CENTRES = {
  lobby: { x: 32, y: 112 },
  hr: { x: 32, y: 80 },
  "project:haunted-todo": { x: 32, y: 112 },
} as const;
type RoomKey = keyof typeof CENTRES;

async function open(page: Page, room: RoomKey): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript((remembered) => {
    // The first load of the tab only: a reload must keep the floor it was on.
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    localStorage.clear();
    localStorage.setItem("agentlife-guide-seen", "1");
    sessionStorage.setItem("agentlife-floor", remembered);
  }, room);
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/");
  await expect(page.locator(".al-status")).toBeHidden();
  await expect(page.locator(".al-stage > canvas")).toBeVisible();
  await expect(page.locator(".al-floor-label")).toHaveText(room === "lobby" ? "Lobby" : room === "hr" ? "HR Office" : "haunted-todo");
  await expect(page.locator(".al-doors")).toHaveAttribute("data-phase", "open");
  return errors;
}

const edit = (page: Page) => page.locator(".al-top .al-edit");
const bar = (page: Page) => page.locator(".al-arrange");
const piece = (page: Page) => page.locator(".al-arrange-piece");
const status = (page: Page) => page.locator(".al-arrange-status");
const bt = (page: Page, name: string) => bar(page).getByRole("button", { name, exact: true });

async function tilePoint(page: Page, room: RoomKey, x: number, y: number): Promise<{ x: number; y: number }> {
  const canvas = await page.locator(".al-stage > canvas").boundingBox();
  if (!canvas) throw new Error("no canvas");
  const zoom = await zoomOf(page);
  const c = CENTRES[room];
  const rootX = Math.round(Math.floor(canvas.width) / 2 - c.x * zoom);
  const rootY = Math.round(Math.floor(canvas.height) / 2 - c.y * zoom);
  return { x: canvas.x + rootX + ((x - y) * TILE_W * zoom) / 2, y: canvas.y + rootY + ((x + y) * TILE_H * zoom) / 2 };
}

/** Click a little above the middle of a tile, on the drawing of a piece that stands there. */
async function clickPiece(page: Page, room: RoomKey, x: number, y: number): Promise<void> {
  const p = await tilePoint(page, room, x, y);
  await page.mouse.click(p.x, p.y - 12);
}

async function startEditing(page: Page): Promise<void> {
  await edit(page).click();
  await expect(bar(page)).toBeVisible();
  await expect(edit(page)).toHaveAttribute("aria-pressed", "true");
}

/** Back to the template, so the shared world-server is left as it was found (also after a test that failed halfway). */
async function resetRoom(page: Page): Promise<void> {
  if (!(await bar(page).isVisible())) await startEditing(page);
  await bt(page, "Reset layout").click();
  await bt(page, "Yes, reset").click();
  await expect(status(page)).toHaveText("Layout reset.");
  await edit(page).click();
  await expect(bar(page)).toBeHidden();
}

test.describe("the lobby", () => {
  test("move, turn and reset a plant, and the elevator stays", async ({ page }) => {
    const errors = await open(page, "lobby");
    await startEditing(page);
    await resetRoom(page);
    await startEditing(page);
    await expect(bar(page).locator(".al-arrange-help")).toContainText("Editing Lobby:");

    await clickPiece(page, "lobby", 0, 3);
    await expect(piece(page)).toHaveText("Potted plant: tile 0, 3, facing south");
    await page.keyboard.press("ArrowDown");
    await expect(piece(page)).toHaveText("Potted plant: tile 0, 4, facing south");
    await expect(status(page)).toHaveText("Saved.");
    await page.keyboard.press("r");
    await expect(piece(page)).toHaveText("Potted plant: tile 0, 4, facing west");
    await expect(status(page)).toHaveText("Saved.");

    // The elevator never moves.
    await clickPiece(page, "lobby", 0, 8);
    await expect(status(page)).toHaveText("The elevator stays where it is.");
    await expect(status(page)).toHaveAttribute("data-tone", "bad");

    await resetRoom(page);
    expect(errors).toEqual([]);
  });

  test("a move that would shut off the Reception desk says which path it blocks", async ({ page }) => {
    await open(page, "lobby");
    await startEditing(page);
    await resetRoom(page);
    await startEditing(page);
    // The Reception desk is at (1, 0) and is used from (1, 1): the plant walks up the west wall from (0, 3) to (0, 1), then right onto (1, 1).
    await clickPiece(page, "lobby", 0, 3);
    await page.keyboard.press("ArrowUp");
    await expect(piece(page)).toHaveText("Potted plant: tile 0, 2, facing south");
    await page.keyboard.press("ArrowUp");
    await expect(piece(page)).toHaveText("Potted plant: tile 0, 1, facing south");
    await page.keyboard.press("ArrowRight");
    await expect(status(page)).toHaveText("Blocks the path to the reception desk.");
    await expect(status(page)).toHaveAttribute("data-tone", "bad");
    await resetRoom(page);
  });
});

test.describe("the HR office", () => {
  test("a piece moves, and the arrangement is still there after a reload", async ({ page }) => {
    const errors = await open(page, "hr");
    await startEditing(page);
    await resetRoom(page);
    await startEditing(page);
    await expect(bar(page).locator(".al-arrange-help")).toContainText("Editing HR Office:");

    // The plant in the north-east corner.
    await clickPiece(page, "hr", 9, 0);
    await expect(piece(page)).toHaveText("Potted plant: tile 9, 0, facing south");
    await page.keyboard.press("ArrowDown");
    await expect(piece(page)).toHaveText("Potted plant: tile 9, 1, facing south");
    await expect(status(page)).toHaveText("Saved.");
    await edit(page).click();

    await page.reload();
    await expect(page.locator(".al-floor-label")).toHaveText("HR Office");
    await expect(page.locator(".al-doors")).toHaveAttribute("data-phase", "open");
    await startEditing(page);
    await clickPiece(page, "hr", 9, 1);
    await expect(piece(page)).toHaveText("Potted plant: tile 9, 1, facing south");

    // The HR agent's standing spot is free of furniture.
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await expect(piece(page)).toHaveText("Potted plant: tile 8, 1, facing south");
    await expect(status(page)).toHaveText("The HR agent's standing spot is on that tile.");
    await expect(status(page)).toHaveAttribute("data-tone", "bad");

    await resetRoom(page);
    expect(errors).toEqual([]);
  });
});

test.describe("a project floor", () => {
  test("the mailbox turns in place once it is away from the wall, and a refusal names the piece in the way", async ({ page }) => {
    const errors = await open(page, "project:haunted-todo");
    await startEditing(page);
    await resetRoom(page);
    await startEditing(page);

    // Against the west wall it faces the room, and says what to do.
    await clickPiece(page, "project:haunted-todo", 0, 6);
    await expect(piece(page)).toContainText("Mailbox: tile 0, 6, facing east");
    await page.keyboard.press("r");
    await expect(status(page)).toHaveText("Against a wall this piece faces the room. Move it away from the wall to turn it.");
    await expect(status(page)).toHaveAttribute("data-tone", "bad");
    await expect(piece(page)).toContainText("tile 0, 6, facing east");

    // One step into the room, and it turns all the way round on its own tile.
    await page.keyboard.press("ArrowRight");
    await expect(piece(page)).toContainText("Mailbox: tile 1, 6, facing east");
    for (const facing of ["south", "west", "north", "east"]) {
      await page.keyboard.press("r");
      await expect(piece(page)).toContainText(`Mailbox: tile 1, 6, facing ${facing}`);
      await expect(status(page)).toHaveText("Saved.");
    }

    // Back against the wall, facing the room again.
    await page.keyboard.press("ArrowLeft");
    await expect(piece(page)).toContainText("Mailbox: tile 0, 6, facing east");

    // A piece that stands in the way is named.
    await clickPiece(page, "project:haunted-todo", 9, 8);
    await expect(piece(page)).toContainText("Potted plant: tile 9, 8");
    for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowLeft");
    await expect(piece(page)).toContainText("Potted plant: tile 6, 8");
    await page.keyboard.press("ArrowDown");
    await expect(status(page)).toHaveText("That tile is taken by the sofa.");
    await expect(status(page)).toHaveAttribute("data-tone", "bad");

    await resetRoom(page);
    expect(errors).toEqual([]);
  });
});
