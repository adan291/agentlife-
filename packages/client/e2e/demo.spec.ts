import { expect, test } from "@playwright/test";

/** Smoke test of the demo build: the recorded run starts, waits for the user's approval, and goes on. */

test("the demo build replays the recorded run without a server", async ({ page }) => {
  const errors: string[] = [];
  const sockets: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("websocket", (ws) => sockets.push(ws.url()));

  // Relative URL: resolved against the baseURL, which carries the Pages sub-path.
  await page.goto("?autostart");

  await expect(page.getByRole("status").filter({ hasText: "Replay of a real run recorded on" })).toBeVisible();
  await expect(page.locator(".al-stage > canvas")).toBeVisible();

  const agents = page.locator("[data-agent-state]");
  await expect(agents).toHaveCount(4);

  // The Architect starts working on its own.
  await expect(page.locator('[data-agent="architect"]:not([data-agent-state="idle"])')).toHaveCount(1, { timeout: 30_000 });

  // The run is paused for the plan approval; approve it in the mailbox and the Developer takes over.
  await page.getByRole("button", { name: "16×" }).click();
  await page.getByRole("button", { name: /Open mailbox/ }).click({ timeout: 45_000 });
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.locator('[data-agent="developer"]:not([data-agent-state="idle"])')).toHaveCount(1, { timeout: 45_000 });

  // The Bug sack belongs to the live hotel: the demo's Menu has no Bugs and no Report a bug, and F8 opens no form.
  await page.getByRole("button", { name: "Menu" }).click();
  await expect(page.getByRole("menu", { name: "Menu" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: /^(Bugs|Report a bug)/ })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.keyboard.press("F8");
  await expect(page.getByRole("dialog", { name: /Report a bug|Bug sack/ })).toHaveCount(0);
  // An error in the page is only an error in the page: nothing is sent anywhere.
  await page.evaluate(() => {
    setTimeout(() => {
      throw new Error("Bug sack test: an error in the demo");
    }, 0);
  });

  expect(sockets).toEqual([]);
  expect(errors.filter((e) => !e.includes("Bug sack test"))).toEqual([]);
});
