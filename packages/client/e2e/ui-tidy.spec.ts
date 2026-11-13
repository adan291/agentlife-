import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { zoomOf } from "./helpers.ts";

/** The one project of the scripted engine. */
const FLOOR = "project:haunted-todo";

async function open(page: Page, width = 1366, height = 768, floor: string | null = FLOOR): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript((remembered) => {
    localStorage.clear();
    localStorage.setItem("agentlife-guide-seen", "1");
    if (remembered) sessionStorage.setItem("agentlife-floor", remembered);
  }, floor);
  await page.setViewportSize({ width, height });
  await page.goto("/");
  await expect(page.locator(".al-status")).toBeHidden();
  await expect(page.locator(".al-stage > canvas")).toBeVisible();
  await expect(page.locator(".al-floor-label")).toHaveText(floor ? "haunted-todo" : "Lobby");
  await expect(page.locator(".al-doors")).toHaveAttribute("data-phase", "open");
  return errors;
}

const menuButton = (page: Page) => page.getByRole("button", { name: "Menu" });
const menu = (page: Page) => page.getByRole("menu", { name: "Menu" });
const editButton = (page: Page) => page.locator(".al-top .al-edit");
const editBar = (page: Page) => page.locator(".al-arrange");

test.describe("the Menu", () => {
  test("opens with the keyboard, moves with the arrows and runs Zoom", async ({ page }) => {
    const errors = await open(page);
    const before = await zoomOf(page);

    await menuButton(page).focus();
    await page.keyboard.press("Enter");
    await expect(menu(page)).toBeVisible();
    await expect(menuButton(page)).toHaveAttribute("aria-expanded", "true");
    const items = menu(page).getByRole("menuitem");
    await expect(items).toHaveText([/^Commands\s*Ctrl\+K$/, /^Zoom [12]×\s*Z$/, /^Text smaller$/, /^Text larger$/, /^Help and guide\s*\?$/]);
    // The first item has the focus; one arrow down is Zoom.
    await expect(items.first()).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(items.nth(1)).toBeFocused();
    await page.keyboard.press("Enter");

    // The menu closed, the focus is back on its button, and the zoom changed.
    await expect(menu(page)).toBeHidden();
    await expect(menuButton(page)).toBeFocused();
    await expect(menuButton(page)).toHaveAttribute("aria-expanded", "false");
    expect(await zoomOf(page)).toBe(before === 1 ? 2 : 1);
    expect(errors).toEqual([]);
  });

  test("Esc closes it and gives the focus back; so does a click outside", async ({ page }) => {
    await open(page);
    await menuButton(page).click();
    await expect(menu(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu(page)).toBeHidden();
    await expect(menuButton(page)).toBeFocused();

    await menuButton(page).click();
    await expect(menu(page)).toBeVisible();
    await page.locator(".al-stage > canvas").click({ position: { x: 20, y: 200 } });
    await expect(menu(page)).toBeHidden();
  });

  test("ArrowUp from the button opens it on the last item; Text larger and Help run", async ({ page }) => {
    await open(page);
    await menuButton(page).focus();
    await page.keyboard.press("ArrowUp");
    await expect(menu(page).getByRole("menuitem").last()).toBeFocused();
    await page.keyboard.press("Enter");
    // The guide opens: Help and guide is the last item.
    await expect(page.getByRole("dialog", { name: "How it works" })).toBeVisible();
  });

  test("Text larger changes the text size and the item says nothing else", async ({ page }) => {
    await open(page);
    const size = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--al-font"));
    const before = await size();
    await menuButton(page).click();
    await menu(page).getByRole("menuitem", { name: "Text larger" }).click();
    await expect.poll(size).not.toBe(before);
  });

  test("the keys keep working: Z for zoom, ? for help, Ctrl+K for the commands", async ({ page }) => {
    await open(page);
    const before = await zoomOf(page);
    await page.keyboard.press("z");
    expect(await zoomOf(page)).toBe(before === 1 ? 2 : 1);
    await page.keyboard.press("Control+k");
    await expect(page.locator(".al-palette-input")).toBeFocused();
    await page.keyboard.press("Escape");
    await page.keyboard.press("?");
    await expect(page.getByRole("dialog", { name: "How it works" })).toBeVisible();
  });
});

test.describe("Edit room", () => {
  test("enters and leaves edit mode on a project floor, with a banner under the top bar", async ({ page }) => {
    const errors = await open(page);
    await expect(editButton(page)).toBeEnabled();
    await expect(editButton(page)).toHaveText("Edit room");
    await expect(editBar(page)).toBeHidden();
    // The old button in a corner of the stage is gone.
    await expect(page.locator(".al-arrange-open")).toHaveCount(0);

    await editButton(page).click();
    await expect(editButton(page)).toHaveText("Done");
    await expect(editButton(page)).toHaveAttribute("aria-pressed", "true");
    await expect(editBar(page)).toBeVisible();
    await expect(editBar(page).locator(".al-arrange-help")).toHaveText("Editing haunted-todo: drag furniture, arrows to move, R to turn, Esc when done");
    for (const name of ["Rotate (R)", "Undo", "Reset layout", "Inventory"]) {
      await expect(editBar(page).getByRole("button", { name, exact: true })).toBeVisible();
    }
    // Under the top bar, and the stage starts below it: nothing is covered.
    const top = await page.locator(".al-top").boundingBox();
    const bar = await editBar(page).boundingBox();
    const stage = await page.locator(".al-stage").boundingBox();
    expect(bar!.y).toBeGreaterThanOrEqual(top!.y + top!.height - 0.5);
    expect(stage!.y).toBeGreaterThanOrEqual(bar!.y + bar!.height - 0.5);

    await editButton(page).click();
    await expect(editBar(page)).toBeHidden();
    await expect(editButton(page)).toHaveText("Edit room");
    await expect(editButton(page)).toHaveAttribute("aria-pressed", "false");
    expect(errors).toEqual([]);
  });

  test("the E key starts editing and Esc leaves; E does nothing in a text field", async ({ page }) => {
    await open(page);
    await page.keyboard.press("e");
    await expect(editBar(page)).toBeVisible();
    // E again does not leave: Esc and Done do.
    await page.keyboard.press("e");
    await expect(editBar(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(editBar(page)).toBeHidden();

    await page.keyboard.press("Control+k");
    const input = page.locator(".al-palette-input");
    await expect(input).toBeFocused();
    await page.keyboard.type("e");
    await expect(editBar(page)).toBeHidden();
    await expect(input).toHaveValue("e");
  });

  test("the Inventory button shows and hides the tray", async ({ page }) => {
    await open(page);
    await editButton(page).click();
    await expect(page.locator(".al-tray")).toBeVisible();
    const inventory = editBar(page).getByRole("button", { name: "Inventory", exact: true });
    await expect(inventory).toHaveAttribute("aria-pressed", "true");
    await inventory.click();
    await expect(page.locator(".al-tray")).toBeHidden();
    await inventory.click();
    await expect(page.locator(".al-tray")).toBeVisible();
    await editButton(page).click();
  });

  test("is disabled in the lobby, for now (task 2 makes every room editable)", async ({ page }) => {
    await open(page, 1366, 768, null);
    await expect(editButton(page)).toBeDisabled();
    await page.keyboard.press("e");
    await expect(editBar(page)).toBeHidden();
  });
});

for (const [width, height] of [
  [360, 640],
  [800, 600],
  [1366, 768],
] as const) {
  test.describe(`top bar at ${width}x${height}`, () => {
    test("does not overflow, and the Menu and the Elevator are always there", async ({ page }) => {
      await open(page, width, height);
      const m = await page.locator(".al-top").evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
      expect(m.sw).toBeLessThanOrEqual(m.cw);
      const doc = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
      expect(doc.sw).toBeLessThanOrEqual(doc.cw);
      await expect(menuButton(page)).toBeVisible();
      await expect(page.getByRole("button", { name: /Take the elevator/ })).toBeVisible();
      const bar = await page.locator(".al-top").boundingBox();
      for (const box of [await menuButton(page).boundingBox(), await page.getByRole("button", { name: /Take the elevator/ }).boundingBox()]) {
        expect(box!.x).toBeGreaterThanOrEqual(bar!.x - 0.5);
        expect(box!.x + box!.width).toBeLessThanOrEqual(bar!.x + bar!.width + 0.5);
      }
      // The collapsible group is in the bar from 900 px up, and inside the Menu below.
      const wide = width >= 900;
      await expect(editButton(page)).toBeVisible({ visible: wide });
      await expect(page.locator(".al-top .al-view-toggle")).toBeVisible({ visible: wide });
    });

    test("every control is reachable: in the bar or in the Menu", async ({ page }) => {
      await open(page, width, height);
      await menuButton(page).click();
      const items = menu(page).getByRole("menuitem");
      if (width >= 900) {
        await expect(items).toHaveCount(5);
      } else {
        await expect(items).toHaveCount(8);
        await expect(items.nth(0)).toHaveText(/Show the list/);
        await expect(items.nth(1)).toHaveText(/Edit room/);
      }
      // The list stays inside the window.
      const list = await menu(page).boundingBox();
      expect(list!.x).toBeGreaterThanOrEqual(0);
      expect(list!.x + list!.width).toBeLessThanOrEqual(width + 0.5);
      expect(list!.y + list!.height).toBeLessThanOrEqual(height + 0.5);
    });
  });
}

test("below 900 px the Menu starts Edit room and the same item reads Done editing", async ({ page }) => {
  await open(page, 800, 600);
  await menuButton(page).click();
  await menu(page).getByRole("menuitem", { name: /^Edit room/ }).click();
  await expect(editBar(page)).toBeVisible();
  await menuButton(page).click();
  await menu(page).getByRole("menuitem", { name: /^Done editing/ }).click();
  await expect(editBar(page)).toBeHidden();
});
