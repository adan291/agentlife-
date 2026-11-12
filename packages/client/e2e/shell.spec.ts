import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

const SIZES = [
  { name: "desktop", width: 1366, height: 768 },
  { name: "laptop small", width: 800, height: 600 },
  { name: "phone", width: 375, height: 667 },
  { name: "minimum", width: 360, height: 480 },
] as const;

const REGIONS = [".al-top", ".al-side", ".al-stage", ".al-dock"] as const;

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function box(locator: Locator): Promise<Box> {
  const b = await locator.boundingBox();
  if (!b) throw new Error(`no bounding box for ${locator}`);
  return b;
}

/** Overlap area in px² of two boxes; sub-pixel layout rounding is ignored. */
function overlap(a: Box, b: Box): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0.5 && h > 0.5 ? w * h : 0;
}

async function open(page: Page, width: number, height: number): Promise<void> {
  // A clean slate: no remembered side bar / dock choice, and no first-visit guide covering the stage.
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("agentlife-guide-seen", "1");
  });
  await page.setViewportSize({ width, height });
  await page.goto("/");
  // Connected: the status chip hides itself once the socket is open, and the world-server then sends the welcome.
  await expect(page.locator(".al-status")).toBeHidden();
  await expect(page.locator(".al-stage > canvas")).toBeVisible();
}

async function canvasSize(page: Page): Promise<{ w: number; h: number }> {
  const b = await box(page.locator(".al-stage > canvas"));
  return { w: b.width, h: b.height };
}

/** Pixi resizes from a ResizeObserver callback, so give the layout a moment to settle before measuring. */
async function settled(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

for (const size of SIZES) {
  test.describe(`${size.name} ${size.width}x${size.height}`, () => {
    test("regions do not overlap and nothing scrolls the page", async ({ page }) => {
      await open(page, size.width, size.height);
      const boxes = new Map<string, Box>();
      for (const sel of REGIONS) boxes.set(sel, await box(page.locator(sel)));
      for (let i = 0; i < REGIONS.length; i++) {
        for (let j = i + 1; j < REGIONS.length; j++) {
          const a = REGIONS[i]!;
          const b = REGIONS[j]!;
          expect(overlap(boxes.get(a)!, boxes.get(b)!), `${a} overlaps ${b}`).toBe(0);
        }
      }
      // The regions together fill the window.
      const top = boxes.get(".al-top")!;
      const dock = boxes.get(".al-dock")!;
      expect(top.y).toBeCloseTo(0, 0);
      expect(dock.y + dock.height).toBeCloseTo(size.height, 0);
      const scroll = await page.evaluate(() => ({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight }));
      expect(scroll.w).toBeLessThanOrEqual(size.width);
      expect(scroll.h).toBeLessThanOrEqual(size.height);
    });

    test("the canvas is as big as the stage", async ({ page }) => {
      await open(page, size.width, size.height);
      await settled(page);
      const stage = await box(page.locator(".al-stage"));
      const canvas = await canvasSize(page);
      expect(Math.abs(canvas.w - stage.width)).toBeLessThanOrEqual(1);
      expect(Math.abs(canvas.h - stage.height)).toBeLessThanOrEqual(1);
    });

    test("collapsing the side bar grows the canvas", async ({ page }) => {
      await open(page, size.width, size.height);
      // Make sure it is expanded first (it starts collapsed below 900 px), then collapse it.
      const expand = page.getByRole("button", { name: "Expand team" });
      if (await expand.isVisible()) {
        await expand.click();
        await settled(page);
      }
      const before = await canvasSize(page);
      await page.getByRole("button", { name: "Collapse team" }).click();
      await settled(page);
      const after = await canvasSize(page);
      expect(after.w).toBeGreaterThan(before.w);
      expect(after.w - before.w).toBeGreaterThanOrEqual(180);
      const stage = await box(page.locator(".al-stage"));
      expect(Math.abs(after.w - stage.width)).toBeLessThanOrEqual(1);
    });

    test("collapsing the dock grows the canvas", async ({ page }) => {
      await open(page, size.width, size.height);
      const show = page.getByRole("button", { name: "Show activity" });
      if (await show.isVisible()) {
        await show.click();
        await settled(page);
      }
      const before = await canvasSize(page);
      await page.getByRole("button", { name: "Hide activity" }).click();
      await settled(page);
      const after = await canvasSize(page);
      expect(after.h).toBeGreaterThan(before.h);
    });
  });
}

test("responsive defaults", async ({ page }) => {
  await open(page, 1366, 768);
  await expect(page.locator(".al-shell")).toHaveAttribute("data-side-collapsed", "false");
  await expect(page.locator(".al-shell")).toHaveAttribute("data-dock-collapsed", "false");

  await open(page, 800, 600);
  await expect(page.locator(".al-shell")).toHaveAttribute("data-side-collapsed", "true");
  await expect(page.locator(".al-shell")).toHaveAttribute("data-dock-collapsed", "false");

  await open(page, 375, 667);
  await expect(page.locator(".al-shell")).toHaveAttribute("data-compact", "true");
  await expect(page.locator(".al-shell")).toHaveAttribute("data-dock-collapsed", "true");

  await open(page, 1366, 500);
  await expect(page.locator(".al-shell")).toHaveAttribute("data-dock-collapsed", "true");
});

test("the dock height can be dragged and is remembered", async ({ page }) => {
  await open(page, 1366, 768);
  const grip = page.getByRole("separator", { name: "Resize activity" });
  const before = await box(page.locator(".al-dock"));
  await grip.focus();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await settled(page);
  const after = await box(page.locator(".al-dock"));
  expect(after.height).toBeGreaterThan(before.height);
  expect(after.height).toBeLessThanOrEqual(768 / 2 + 1);
  expect(await page.evaluate(() => localStorage.getItem("agentlife-dock-px"))).not.toBeNull();
});

test("the elevator takes the user to a project floor, and a reload returns there", async ({ page }) => {
  await open(page, 1366, 768);
  await expect(page.locator(".al-floor-label")).toHaveText("Lobby");
  // Only the Builder lives in the lobby.
  await expect(page.locator(".al-team-row:not([hidden])")).toHaveCount(1);

  await page.getByRole("button", { name: /Take the elevator/ }).click();
  const panel = page.getByRole("dialog", { name: "Elevator" });
  await expect(panel).toBeVisible();
  await expect(panel.locator(".al-floor")).toHaveCount(3);
  await panel.getByRole("button", { name: "Go to haunted-todo" }).click();

  await expect(page.locator(".al-floor-label")).toHaveText("haunted-todo");
  await expect(page.locator(".al-team-row:not([hidden])")).toHaveCount(3);
  await expect(page.locator(".al-doors")).toHaveAttribute("data-phase", "open");
  expect(await page.evaluate(() => sessionStorage.getItem("agentlife-floor"))).toBe("project:haunted-todo");
});

test("a reload returns to the floor the user was on", async ({ page }) => {
  // Seed the storage once; `open()` would clear it again on the reload.
  await page.addInitScript(() => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    localStorage.clear();
    localStorage.setItem("agentlife-guide-seen", "1");
    sessionStorage.setItem("agentlife-floor", "project:haunted-todo");
  });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/");
  await expect(page.locator(".al-floor-label")).toHaveText("haunted-todo");
  await page.reload();
  await expect(page.locator(".al-floor-label")).toHaveText("haunted-todo");
});
