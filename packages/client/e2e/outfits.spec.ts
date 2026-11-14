import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { zoomOf } from "./helpers.ts";

/**
 * Outfits (ghost-skins): buy a part in the shop, put it on a team member at the HR desk, see it on the project floor, and
 * keep it across a reload. These tests run against a world-server of their own (`playwright.config.ts`: ports 8798 and
 * 5196) whose scripted engine has an HR office with the default team, and whose wallet, wardrobe and outfits are scratch
 * files. The canvas carries `data-looks`, the part ids each figure wears, because a canvas cannot say it.
 */
test.use({ baseURL: "http://127.0.0.1:5196" });

const TILE_W = 64;
const TILE_H = 32;
const CENTRES = {
  lobby: { x: 32, y: 112 },
  hr: { x: 32, y: 80 },
} as const;

async function open(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) errors.push(m.text());
  });
  await page.addInitScript(() => {
    // The first load of the tab only: a reload must keep the floor it was on.
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    localStorage.clear();
    localStorage.setItem("agentlife-guide-seen", "1");
    sessionStorage.setItem("agentlife-floor", "lobby");
  });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/");
  await expect(page.locator(".al-status")).toBeHidden();
  await expect(page.locator(".al-stage > canvas")).toBeVisible();
  await expect(page.locator(".al-floor-label")).toHaveText("Lobby");
  await expect(page.locator(".al-doors")).toHaveAttribute("data-phase", "open");
  return errors;
}

async function tilePoint(page: Page, room: keyof typeof CENTRES, x: number, y: number): Promise<{ x: number; y: number }> {
  const canvas = await page.locator(".al-stage > canvas").boundingBox();
  if (!canvas) throw new Error("no canvas");
  const zoom = await zoomOf(page);
  const c = CENTRES[room];
  const rootX = Math.round(Math.floor(canvas.width) / 2 - c.x * zoom);
  const rootY = Math.round(Math.floor(canvas.height) / 2 - c.y * zoom);
  return { x: canvas.x + rootX + ((x - y) * TILE_W * zoom) / 2, y: canvas.y + rootY + ((x + y) * TILE_H * zoom) / 2 };
}

/** Takes the elevator to a floor and waits for its doors to open. */
async function goTo(page: Page, floor: string): Promise<void> {
  await page.getByRole("button", { name: /Take the elevator/ }).click();
  const panel = page.getByRole("dialog", { name: "Elevator" });
  await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: `Go to ${floor}` }).click();
  await expect(page.locator(".al-floor-label")).toHaveText(floor);
  await expect(page.locator(".al-doors")).toHaveAttribute("data-phase", "open");
}

/** What each figure wears, as the scene draws it. */
async function looks(page: Page): Promise<Record<string, string>> {
  const raw = await page.locator(".al-stage > canvas").getAttribute("data-looks");
  return JSON.parse(raw ?? "{}") as Record<string, string>;
}

const CAP = "Checked flat cap";

/** Buys a part at the shop counter in the lobby, unless the user owns it already. The panel is closed afterwards. */
async function buyPart(page: Page, partId: string): Promise<void> {
  const shopTile = await tilePoint(page, "lobby", 4, 4);
  await page.mouse.click(shopTile.x, shopTile.y);
  const shop = page.getByRole("dialog", { name: "Shop" });
  await expect(shop).toBeVisible();
  await shop.getByRole("tab", { name: "Outfits" }).click();
  const card = shop.locator(`.al-shop-item[data-part="${partId}"]`);
  const buy = card.getByRole("button", { name: /^Buy / });
  if (await buy.count()) await buy.click();
  await expect(card).toContainText("Owned");
  await shop.getByRole("button", { name: "Close panel" }).click();
  await expect(shop).toBeHidden();
}

test.describe.serial("wearing outfits", () => {
  test("buys the flat cap, puts it on the Developer at the HR desk, and the Developer wears it on the project floor, also after a reload", async ({ page }) => {
    test.setTimeout(60_000);
    const errors = await open(page);

    // 1. The shop counter in the lobby: the Outfits page, and the cap is bought with Ecto.
    const shopTile = await tilePoint(page, "lobby", 4, 4);
    await page.mouse.click(shopTile.x, shopTile.y);
    const shop = page.getByRole("dialog", { name: "Shop" });
    await expect(shop).toBeVisible();
    await shop.getByRole("tab", { name: "Outfits" }).click();
    const card = shop.locator('.al-shop-item[data-part="flat_cap"]');
    await expect(card).toContainText(CAP);
    await card.getByRole("button", { name: /^Buy Checked flat cap/ }).click();
    await expect(card).toContainText("Owned");
    await shop.getByRole("button", { name: "Close panel" }).click();
    await expect(shop).toBeHidden();

    // 2. The HR desk: the Developer's card has a Look section with the cap on offer, and nothing else the user does not own.
    await goTo(page, "HR Office");
    const desk = await tilePoint(page, "hr", 4, 0);
    await page.mouse.click(desk.x, desk.y - 12);
    const hr = page.getByRole("dialog", { name: "HR desk" });
    await expect(hr).toBeVisible();
    const member = hr.locator('section[data-project="haunted-todo"] li[data-member="developer"]');
    await expect(member.locator('[data-section="look"]')).toBeVisible();
    const hat = member.locator('select[data-slot="hat"]');
    await expect(hat.locator("option")).toHaveText(["None", CAP]);
    await expect(member.locator('select[data-slot="top"] option')).toHaveText(["None"]);
    await expect(member.locator(".al-look-preview img")).toHaveAttribute("src", /^data:image\/png;base64,/);
    const before = await member.locator(".al-look-preview img").getAttribute("src");

    await hat.selectOption("flat_cap");
    // The picker follows the server's answer: still selected after the panel re-rendered, and the picture changed.
    await expect(member.locator('select[data-slot="hat"]')).toHaveValue("flat_cap");
    await expect(member.locator(".al-look-preview img")).not.toHaveAttribute("src", before ?? "");
    // The other members are untouched.
    await expect(hr.locator('li[data-member="qa"] select[data-slot="hat"]')).toHaveValue("");
    await hr.getByRole("button", { name: "Close panel" }).click();
    await expect(hr).toBeHidden();

    // 3. The project floor: the Developer wears the cap, and nobody else wears anything.
    await goTo(page, "haunted-todo");
    await expect.poll(() => looks(page)).toEqual({ developer: "flat_cap||" });

    // 4. A reload keeps it (the server holds it, not the page).
    await page.reload();
    await expect(page.locator(".al-floor-label")).toHaveText("haunted-todo");
    await expect(page.locator(".al-doors")).toHaveAttribute("data-phase", "open");
    await expect.poll(() => looks(page)).toEqual({ developer: "flat_cap||" });

    const shotDir = process.env["E2E_SHOT_DIR"];
    if (shotDir) await page.screenshot({ path: `${shotDir}/outfit-developer.png` });
    expect(errors).toEqual([]);
  });

  test("a member who wears a part stays dressed when the user goes to another floor and comes back", async ({ page }) => {
    await open(page);
    await goTo(page, "haunted-todo");
    await expect.poll(() => looks(page)).toEqual({ developer: "flat_cap||" });
    await goTo(page, "Lobby");
    await expect.poll(() => looks(page)).toEqual({});
    await goTo(page, "haunted-todo");
    await expect.poll(() => looks(page)).toEqual({ developer: "flat_cap||" });
  });

  test("the user dresses their own figure in the Profile panel", async ({ page }) => {
    const errors = await open(page);
    await buyPart(page, "flat_cap");
    // Under 900 px the top bar folds its buttons into the Menu: the way to the Profile when the hotel has no level to show.
    await page.setViewportSize({ width: 800, height: 700 });
    await page.getByRole("button", { name: "Menu" }).click();
    await page.getByRole("menuitem", { name: /^Profile: .*\d+ Ecto/ }).click();
    const panel = page.getByRole("dialog", { name: "Profile" });
    await expect(panel).toBeVisible();
    // Without progress the Look tab is the only one and is already open.
    const tab = panel.getByRole("tab", { name: "Look" });
    await expect(tab).toHaveAttribute("aria-selected", "true");
    const hat = panel.locator('select[data-slot="hat"]');
    await expect(hat.locator("option")).toHaveText(["None", CAP]);
    await hat.selectOption("flat_cap");
    await expect(panel.locator('select[data-slot="hat"]')).toHaveValue("flat_cap");
    // The user's figure is the one avatar with a number for an id.
    await expect.poll(async () => Object.values(await looks(page))).toEqual(["flat_cap||"]);
    await panel.locator('select[data-slot="hat"]').selectOption("");
    await expect.poll(() => looks(page)).toEqual({});
    expect(errors).toEqual([]);
  });
});
