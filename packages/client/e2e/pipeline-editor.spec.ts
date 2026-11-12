import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * The pipeline editor in a real browser: pointer drag and drop, the arrow buttons, the red steps and Save. The editor is
 * mounted on top of the app with a state the test controls, because the scripted engine has no pipeline to edit.
 */
const STATE = {
  projectId: "haunted-todo",
  customised: false,
  steps: [{ kind: "plan" }, { kind: "approve" }, { kind: "develop" }, { kind: "test" }, { kind: "review" }, { kind: "report" }],
  members: [
    { id: "architect", displayName: "Architect", role: "architect", model: "m-a" },
    { id: "developer", displayName: "Developer", role: "developer", model: "m-d" },
    { id: "qa", displayName: "QA", role: "qa", model: "m-q" },
  ],
};

async function mountEditor(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) errors.push(m.text());
  });
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("agentlife-guide-seen", "1");
  });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/");
  await expect(page.locator(".al-stage > canvas")).toBeVisible();
  await page.evaluate(async ({ state, modulePath }) => {
    const mod = await import(/* @vite-ignore */ modulePath);
    const host = document.createElement("div");
    host.id = "pipe-test";
    host.style.cssText = "position:fixed;inset:0;z-index:99;background:#14101c;color:#eee;overflow:auto;padding:16px";
    document.body.appendChild(host);
    const saved: unknown[] = [];
    (window as unknown as { __saved: unknown[] }).__saved = saved;
    const render = mod.createPipelineEditor(document, { save: (s: unknown) => saved.push(s), reset: () => saved.push("reset") });
    const view = { state, error: null };
    const paint = (): void => host.replaceChildren(render(view, paint));
    paint();
  }, { state: STATE, modulePath: "/src/ui/pipeline-editor.ts" });
  return errors;
}

const kinds = (page: Page) => page.locator("#pipe-test .al-pipe-card").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset["kind"]));
const saved = (page: Page) => page.evaluate(() => (window as unknown as { __saved: unknown[] }).__saved);

test.describe("pipeline editor", () => {
  test("moves a step with the arrows, marks the broken rule in red and keeps Save off until it is fixed", async ({ page }) => {
    const errors = await mountEditor(page);
    await expect.poll(() => kinds(page)).toEqual(["plan", "approve", "develop", "test", "review", "report"]);
    const save = page.getByRole("button", { name: "Save pipeline" });
    await expect(save).toBeDisabled();

    await page.getByRole("button", { name: "Move Approval later" }).click();
    await expect.poll(() => kinds(page)).toEqual(["plan", "develop", "approve", "test", "review", "report"]);
    const bad = page.locator('#pipe-test .al-pipe-card[data-invalid="true"]');
    await expect(bad).toHaveCount(1);
    await expect(bad).toContainText("Approval must come before Develop");
    await expect(save).toBeDisabled();

    await page.getByRole("button", { name: "Move Approval earlier" }).click();
    await expect(page.locator('#pipe-test .al-pipe-card[data-invalid="true"]')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("drags a card with the pointer to another place", async ({ page }) => {
    const errors = await mountEditor(page);
    const grip = page.getByRole("button", { name: "Drag Report to move it" });
    const target = page.locator('#pipe-test .al-pipe-card[data-kind="plan"]');
    const from = await grip.boundingBox();
    const to = await target.boundingBox();
    expect(from && to).toBeTruthy();
    await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
    await page.mouse.down();
    await page.mouse.move(to!.x + 10, to!.y + 10, { steps: 8 });
    await expect(target).toHaveAttribute("data-drop", "true");
    await page.mouse.up();
    // The report now comes first, which breaks the rules: it is red and Save stays off.
    await expect.poll(() => kinds(page)).toEqual(["report", "plan", "approve", "develop", "test", "review"]);
    await expect(page.locator('#pipe-test .al-pipe-card[data-kind="report"]')).toHaveAttribute("data-invalid", "true");
    await expect(page.getByRole("button", { name: "Save pipeline" })).toBeDisabled();
    expect(errors).toEqual([]);
  });

  test("a drag that ends where it began changes nothing", async ({ page }) => {
    await mountEditor(page);
    const grip = page.getByRole("button", { name: "Drag Develop to move it" });
    const box = await grip.boundingBox();
    await page.mouse.move(box!.x + 2, box!.y + 2);
    await page.mouse.down();
    await page.mouse.move(box!.x + 6, box!.y + 4, { steps: 3 });
    await page.mouse.up();
    await expect.poll(() => kinds(page)).toEqual(["plan", "approve", "develop", "test", "review", "report"]);
    await expect(page.locator("#pipe-test [data-dragging], #pipe-test [data-drop]")).toHaveCount(0);
  });

  test("adds an optional step and is red until the team has someone for it", async ({ page }) => {
    const errors = await mountEditor(page);
    await page.getByRole("button", { name: "Add Research" }).click();
    await expect.poll(() => kinds(page)).toEqual(["research", "plan", "approve", "develop", "test", "review", "report"]);
    // There is no researcher on this team: the step is red until one is hired.
    await expect(page.locator('#pipe-test .al-pipe-card[data-kind="research"]')).toContainText("needs a researcher");
    await expect(page.getByRole("button", { name: "Save pipeline" })).toBeDisabled();
    await page.getByRole("button", { name: "Remove Research" }).click();
    await page.getByRole("button", { name: "Remove Review" }).click();
    await page.getByRole("button", { name: "Add Review" }).click();
    await expect.poll(() => kinds(page)).toEqual(["plan", "approve", "develop", "test", "review", "report"]);
    expect(await saved(page)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("picks a member from the themed menu", async ({ page }) => {
    await mountEditor(page);
    const review = page.locator('#pipe-test .al-pipe-card[data-kind="review"]');
    await review.getByRole("combobox").click();
    await expect(review.getByRole("option")).toHaveText(["Default: QA", "QA (qa)"]);
    await review.getByRole("option", { name: "QA (qa)" }).click();
    // The review now names QA: the pipeline differs from the saved one and can be saved.
    const save = page.getByRole("button", { name: "Save pipeline" });
    await expect(save).toBeEnabled();
    await save.click();
    expect(await saved(page)).toEqual([[{ kind: "plan" }, { kind: "approve" }, { kind: "develop" }, { kind: "test" }, { kind: "review", memberId: "qa" }, { kind: "report" }]]);
  });
});

/** The world-server of the Playwright config (fake engine). */
const WORLD_URL = /ws:\/\/127\.0\.0\.1:8795/;

const REX = { id: "reviewer-1", displayName: "Rex", role: "reviewer", model: "m-r" };

test("the board shows the editor above the job card, and Save sends the pipeline to the server", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("agentlife-guide-seen", "1");
    sessionStorage.setItem("agentlife-floor", "project:haunted-todo");
  });
  const sent: unknown[] = [];
  const state = { ...STATE, members: [...STATE.members, REX] };
  await page.routeWebSocket(WORLD_URL, (ws) => {
    const server = ws.connectToServer();
    let injected = false;
    server.onMessage((message) => {
      ws.send(message);
      if (!injected && typeof message === "string" && message.includes('"type":"welcome"') && message.includes('"roomId":"project:haunted-todo"')) {
        injected = true;
        ws.send(JSON.stringify({ type: "pipeline", state }));
        ws.send(JSON.stringify({ type: "open_panel", panel: "board" }));
      }
    });
    ws.onMessage((message) => {
      const msg = typeof message === "string" ? (JSON.parse(message) as { type: string; steps?: unknown }) : undefined;
      // The scripted engine has no pipeline: the test plays the server for these messages.
      if (msg?.type === "pipeline_save") {
        sent.push(msg);
        ws.send(JSON.stringify({ type: "pipeline", state: { ...state, customised: true, steps: msg.steps } }));
      } else if (msg?.type === "pipeline_reset") {
        sent.push(msg);
        ws.send(JSON.stringify({ type: "pipeline", state }));
      } else {
        server.send(message);
      }
    });
  });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/");
  const dialog = page.getByRole("dialog", { name: "Job" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Pipeline" })).toBeVisible();
  await expect(dialog.locator(".al-pipe-card")).toHaveCount(6);
  // The editor comes first, the job card after it.
  const editorBox = await dialog.locator(".al-pipe").boundingBox();
  const cardBox = await dialog.locator(".al-job").boundingBox();
  expect(editorBox!.y).toBeLessThan(cardBox!.y);

  await dialog.getByRole("button", { name: "Add Second review" }).click();
  // For a look by eye: set E2E_SHOT_DIR to a folder and the picture is written there.
  const shotDir = process.env["E2E_SHOT_DIR"];
  if (shotDir) await page.screenshot({ path: `${shotDir}/pipeline-editor.png` });
  const save = dialog.getByRole("button", { name: "Save pipeline" });
  await expect(save).toBeEnabled();
  await save.click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toMatchObject({
    type: "pipeline_save",
    steps: [{ kind: "plan" }, { kind: "approve" }, { kind: "develop" }, { kind: "test" }, { kind: "review" }, { kind: "second-review" }, { kind: "report" }],
  });
  // The server's answer is the new saved pipeline: nothing left to save, and the way back appears.
  await expect(dialog.getByRole("button", { name: "Back to the default" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Save pipeline" })).toBeDisabled();
  await dialog.getByRole("button", { name: "Back to the default" }).click();
  await expect.poll(() => sent.length).toBe(2);
  await expect(dialog.locator(".al-pipe-card")).toHaveCount(6);
  expect(errors).toEqual([]);
});
