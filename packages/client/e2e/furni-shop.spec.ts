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

const TILE_W = 64;
const TILE_H = 32;
/** Centre of the 12 x 10 room in scene coordinates, as `roomBounds` computes it (the lobby has the same size as a project floor). */
const CENTRE = { x: 32, y: 112 };

/** Where the middle of a tile is on the page, from the canvas size and the zoom (the room is centred in the stage). */
async function tilePoint(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const canvas = await page.locator(".al-stage > canvas").boundingBox();
  if (!canvas) throw new Error("no canvas");
  const zoomText = await page.locator(".al-top-right .al-btn", { hasText: /^[12]×$/ }).textContent();
  const zoom = Number.parseInt(zoomText ?? "1", 10);
  const rootX = Math.round(Math.floor(canvas.width) / 2 - CENTRE.x * zoom);
  const rootY = Math.round(Math.floor(canvas.height) / 2 - CENTRE.y * zoom);
  return { x: canvas.x + rootX + ((x - y) * TILE_W * zoom) / 2, y: canvas.y + rootY + ((x + y) * TILE_H * zoom) / 2 };
}

test.describe("the shop counter", () => {
  test("opens the Shop panel with 26 pictures of furniture on six pages, and nothing can be bought without Ecto", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await open(page);
    await expect(page.locator(".al-floor-label")).toHaveText("Lobby");
    const p = await tilePoint(page, 4, 4);
    await page.mouse.click(p.x, p.y);
    const panel = page.getByRole("dialog", { name: "Shop" });
    await expect(panel).toBeVisible();
    await expect(panel).toContainText(/You have \d+ Ecto\. In your inventory: \d+ of 200\./);

    const tabs = panel.getByRole("tab");
    await expect(tabs).toHaveText(["Seating", "Tables", "Lights", "Plants", "Spooky", "Walls"]);

    const shotDir = process.env["E2E_SHOT_DIR"];
    let items = 0;
    for (const name of ["Seating", "Tables", "Lights", "Plants", "Spooky", "Walls"]) {
      // The open page's tab is disabled (as in the HR and Library panels): click only the others.
      const tab = panel.getByRole("tab", { name });
      if ((await tab.getAttribute("aria-selected")) !== "true") await tab.click();
      await expect(tab).toHaveAttribute("aria-selected", "true");
      const cards = panel.locator(".al-shop-item");
      const count = await cards.count();
      expect(count, name).toBeGreaterThanOrEqual(4);
      items += count;
      // Every card has a picture the room's own renderer drew, and a price.
      for (let i = 0; i < count; i++) {
        const img = cards.nth(i).locator("img");
        await expect(img).toHaveAttribute("src", /^data:image\/png;base64,/);
        await expect(cards.nth(i).locator(".al-shop-price")).toHaveText(/^\d+ Ecto$/);
        const size = await img.evaluate((el) => (el as HTMLImageElement).naturalWidth);
        expect(size).toBeGreaterThan(8);
      }
      if (shotDir) await panel.screenshot({ path: `${shotDir}/shop-${name.toLowerCase()}.png` });
    }
    expect(items).toBeGreaterThanOrEqual(24);

    // A button the user cannot pay is disabled and says how much is missing (the wallet of this run may hold some Ecto: the dearest item is out of reach).
    await panel.getByRole("tab", { name: "Seating" }).click();
    await expect(panel.getByRole("tab", { name: "Seating" })).toHaveAttribute("aria-selected", "true");
    const throne = panel.locator('.al-shop-item[data-item="throne"]').getByRole("button", { name: /^Buy Bone throne/ });
    await expect(throne).toBeVisible();
    await panel.getByRole("button", { name: "Close panel" }).click();
    await expect(panel).toBeHidden();
    expect(errors).toEqual([]);
  });

  test("the shop panel closes with Escape and the canvas stays clickable", async ({ page }) => {
    await open(page);
    const p = await tilePoint(page, 4, 4);
    await page.mouse.click(p.x, p.y);
    const panel = page.getByRole("dialog", { name: "Shop" });
    await expect(panel).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
  });
});
