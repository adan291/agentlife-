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

  expect(sockets).toEqual([]);
  expect(errors).toEqual([]);
});
