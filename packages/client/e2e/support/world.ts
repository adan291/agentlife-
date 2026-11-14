import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/** What a user does in the hotel, for the journeys. */

export const SIZES = [
  { name: "phone", width: 360, height: 640 },
  { name: "laptop", width: 800, height: 600 },
  { name: "desktop", width: 1366, height: 768 },
] as const;
export type Size = (typeof SIZES)[number];

const TILE_W = 64;
const TILE_H = 32;
/** Centre of each room in scene coordinates, as `roomBounds` computes it. */
const CENTRES = {
  lobby: { x: 32, y: 112 },
  hr: { x: 32, y: 80 },
  project: { x: 32, y: 112 },
} as const;
export type Room = keyof typeof CENTRES;

export const FLOOR_NAME = "haunted-todo";
export const FLOOR_ROOM = "project:haunted-todo";

/** Opens the hotel at a window size, in the lobby or on a floor. The remembered choices are cleared on the first load only. */
export async function openHotel(page: Page, size: Size, floor: "lobby" | "project" = "lobby"): Promise<void> {
  await page.addInitScript((remembered) => {
    // A reload must keep the floor it was on, so seed the tab once.
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    localStorage.clear();
    localStorage.setItem("agentlife-guide-seen", "1");
    sessionStorage.setItem("agentlife-floor", remembered);
  }, floor === "lobby" ? "lobby" : FLOOR_ROOM);
  await page.setViewportSize({ width: size.width, height: size.height });
  await page.goto("/");
  await waitForRoom(page, floor === "lobby" ? "Lobby" : FLOOR_NAME);
}

/** The floor label says where the user is, and the elevator doors are open. */
export async function waitForRoom(page: Page, label: string): Promise<void> {
  await expect(page.locator(".al-status")).toBeHidden();
  await expect(page.locator(".al-stage > canvas")).toBeVisible();
  await expect(page.locator(".al-floor-label")).toHaveText(label);
  await expect(page.locator(".al-doors")).toHaveAttribute("data-phase", "open");
}

async function zoomOf(page: Page): Promise<number> {
  return Number.parseInt((await page.locator(".al-top-right").getAttribute("data-zoom")) ?? "1", 10);
}

/** Where the middle of a tile is on the page, from the canvas size and the zoom (the room is centred in the stage). */
export async function tilePoint(page: Page, room: Room, x: number, y: number): Promise<{ x: number; y: number }> {
  const canvas = await page.locator(".al-stage > canvas").boundingBox();
  if (!canvas) throw new Error("no canvas");
  const zoom = await zoomOf(page);
  const c = CENTRES[room];
  const rootX = Math.round(Math.floor(canvas.width) / 2 - c.x * zoom);
  const rootY = Math.round(Math.floor(canvas.height) / 2 - c.y * zoom);
  return { x: canvas.x + rootX + ((x - y) * TILE_W * zoom) / 2, y: canvas.y + rootY + ((x + y) * TILE_H * zoom) / 2 };
}

/** True when a mouse click at this point would reach the canvas: inside the stage and not under a control. */
export async function canvasHit(page: Page, point: { x: number; y: number }): Promise<boolean> {
  return page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName === "CANVAS", point);
}

/** Click a little above the middle of a tile, on the drawing of a piece that stands there. */
export async function clickPiece(page: Page, room: Room, x: number, y: number): Promise<void> {
  const p = await tilePoint(page, room, x, y);
  await page.mouse.click(p.x, p.y - 12);
}

/** Takes the elevator to a floor and waits for its doors to open. */
export async function goTo(page: Page, floor: string): Promise<void> {
  await page.getByRole("button", { name: /Take the elevator/ }).click();
  const panel = page.getByRole("dialog", { name: "Elevator" });
  await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: `Go to ${floor}` }).click();
  await expect(page.locator(".al-floor-label")).toHaveText(floor);
  await expect(page.locator(".al-doors")).toHaveAttribute("data-phase", "open");
}

/**
 * Ctrl+K, a search, Enter. The palette lists what the overview of the hotel says, and the overview can lag a moment behind
 * the panel or the toast that announced the same thing, so the search is repeated until the command is there.
 */
export async function runCommand(page: Page, query: string): Promise<void> {
  const wrap = page.locator(".al-palette-wrap");
  const input = page.locator(".al-palette-input");
  await expect(async () => {
    if (await wrap.isVisible()) await page.keyboard.press("Escape");
    await expect(wrap).toBeHidden({ timeout: 1000 });
    await page.keyboard.press("Control+k");
    await expect(input).toBeFocused({ timeout: 1000 });
    await input.fill(query);
    await expect(page.locator(".al-palette-item").first()).toContainText(query, { ignoreCase: true, timeout: 1000 });
  }).toPass({ timeout: 15_000 });
  await page.keyboard.press("Enter");
  await expect(wrap).toBeHidden();
}

/** The Ecto balance of the top bar. */
export async function balance(page: Page): Promise<number> {
  return Number.parseInt((await page.locator(".al-balance").innerText()).replace(/\D/g, ""), 10);
}

/** What each figure wears, as the scene draws it (`data-looks` on the canvas). */
export async function looks(page: Page): Promise<Record<string, string>> {
  const raw = await page.locator(".al-stage > canvas").getAttribute("data-looks");
  return JSON.parse(raw ?? "{}") as Record<string, string>;
}

/**
 * Walks to a piece of furniture on the floor and opens its panel by clicking its drawing. When the piece lies outside
 * the stage or under a control at this window size (the room is not scaled to the window), the palette command that
 * does the same thing is used instead. The route taken goes into the test's annotations, so a run shows how much of a
 * journey used the canvas at each size.
 */
export async function useFurniture(
  page: Page,
  piece: { name: string; tile: { x: number; y: number }; command: string },
): Promise<"canvas" | "palette"> {
  const p = await tilePoint(page, "project", piece.tile.x, piece.tile.y);
  const point = { x: p.x, y: p.y - 12 };
  const route = (await canvasHit(page, point)) ? "canvas" : "palette";
  test.info().annotations.push({ type: "route", description: `${piece.name}: ${route}` });
  if (route === "canvas") await page.mouse.click(point.x, point.y);
  else await runCommand(page, piece.command);
  return route;
}

/** The computer desk of a project floor: starts a job. */
export const COMPUTER = { name: "computer", tile: { x: 3, y: 7 }, command: `New change job in ${FLOOR_NAME}` } as const;
/** The mailbox of a project floor: approvals and reports. The command is the one that fits what the mailbox holds. */
export const mailbox = (command: string) => ({ name: "mailbox", tile: { x: 0, y: 6 }, command }) as const;
