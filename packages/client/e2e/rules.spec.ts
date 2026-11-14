import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { installClickProbe, screenProblems } from "./support/rules.ts";

/**
 * A rule that cannot fail proves nothing. Each test gives `screenProblems` a small page with one deliberate fault and
 * expects exactly that rule to speak, plus a clean page that expects silence. No hotel, no world-server.
 */

const BASE_STYLE = "button, a, input { font: 14px monospace; } button, a { cursor: pointer; } :focus-visible { outline: 2px solid #8fd8ff; }";

async function show(page: Page, body: string, style = ""): Promise<void> {
  await page.addInitScript(installClickProbe);
  await page.setViewportSize({ width: 400, height: 300 });
  await page.route("http://rules.test/", (route) =>
    route.fulfill({ contentType: "text/html", body: `<!doctype html><html><head><style>html, body { margin: 0; } ${BASE_STYLE} ${style}</style></head><body>${body}</body></html>` }),
  );
  await page.goto("http://rules.test/");
}

const rulesOf = async (page: Page): Promise<string[]> => [...new Set((await screenProblems(page)).map((p) => p.rule))].sort();

test.describe("the screen rules", () => {
  test("a clean page has no problem", async ({ page }) => {
    await show(page, `<button>Save</button> <a href="#x">Help</a> <label>Name <input></label> <button aria-label="Close">x</button>`);
    expect(await screenProblems(page)).toEqual([]);
  });

  test("viewport: a control outside the window", async ({ page }) => {
    await show(page, `<button style="position: fixed; left: -60px; top: 10px">Gone</button>`);
    expect(await rulesOf(page)).toEqual(["viewport"]);
  });

  test("viewport: a label past the right edge", async ({ page }) => {
    await show(page, `<p style="position: fixed; left: 380px; top: 10px; margin: 0">Past the edge</p>`);
    expect(await rulesOf(page)).toContain("viewport");
  });

  test("covered: a control under another element", async ({ page }) => {
    await show(page, `<button style="position: absolute; left: 20px; top: 20px">Under</button><div style="position: absolute; left: 0; top: 0; width: 200px; height: 100px"></div>`);
    expect(await rulesOf(page)).toEqual(["covered"]);
  });

  test("page-scroll: the page is wider than the window", async ({ page }) => {
    await show(page, `<div style="width: 900px; height: 10px"></div>`);
    expect(await rulesOf(page)).toEqual(["page-scroll"]);
  });

  test("text-cut: text clipped without an ellipsis, and an ellipsis is accepted", async ({ page }) => {
    await show(page, `<div style="width: 40px; overflow: hidden; white-space: nowrap">A long sentence that does not fit</div>`);
    expect(await rulesOf(page)).toEqual(["text-cut"]);
    await page.unrouteAll();
    const ok = await page.context().newPage();
    await show(ok, `<div style="width: 40px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis">A long sentence that does not fit</div>`);
    expect(await screenProblems(ok)).toEqual([]);
  });

  test("clickable-role: a div with a click listener, an onclick attribute and a pointer cursor", async ({ page }) => {
    await show(
      page,
      `<div id="a">Listener</div><div onclick="void 0" style="margin-top: 20px">Attribute</div><div style="cursor: pointer; margin-top: 20px">Cursor</div><script>document.getElementById("a").addEventListener("click", () => {});</script>`,
    );
    const problems = (await screenProblems(page)).filter((p) => p.rule === "clickable-role");
    expect(problems.map((p) => p.element)).toEqual(['div "Listener"', 'div "Attribute"', 'div "Cursor"']);
  });

  test("clickable-role: a role without a way to focus it", async ({ page }) => {
    await show(page, `<span role="button">Fake button</span>`);
    expect(await rulesOf(page)).toContain("clickable-role");
  });

  test("name: an icon button without a name, in the page and in the accessibility tree", async ({ page }) => {
    await show(page, `<button><svg width="10" height="10"></svg></button>`);
    const problems = await screenProblems(page);
    expect(problems.filter((p) => p.rule === "name").length).toBeGreaterThanOrEqual(1);
  });

  test("tab: a control that Tab skips", async ({ page }) => {
    await show(page, `<button>Reachable</button> <button tabindex="-1">Skipped</button>`);
    const problems = await screenProblems(page);
    expect(problems.map((p) => `${p.rule}: ${p.element}`)).toEqual(['tab: button "Skipped"']);
  });

  test("focus-ring: a control that shows nothing when focused", async ({ page }) => {
    await show(page, `<button class="bare">No ring</button>`, "button.bare:focus-visible { outline: none; }");
    expect(await rulesOf(page)).toEqual(["focus-ring"]);
  });

  test("cursor: a button that does not look clickable", async ({ page }) => {
    await show(page, `<button style="cursor: default">Plain</button>`);
    expect(await rulesOf(page)).toEqual(["cursor"]);
  });

  test("a modal that traps Tab hides the controls behind it from the cover and Tab rules; one that does not is reported", async ({ page }) => {
    const modal = `<button style="position: absolute; left: 10px; top: 10px">Behind</button><div role="dialog" aria-modal="true" aria-label="Modal" style="position: absolute; inset: 0; background: #000"><input aria-label="Only stop"></div>`;
    await show(page, `${modal}<script>document.querySelector("input").addEventListener("keydown", (e) => { if (e.key === "Tab") e.preventDefault(); });</script>`);
    await page.locator("input").focus();
    expect(await screenProblems(page)).toEqual([]);

    const loose = await page.context().newPage();
    await show(loose, modal);
    await loose.locator("input").focus();
    expect((await screenProblems(loose)).map((p) => `${p.rule}: ${p.element}`)).toEqual(['tab: button "Behind"']);
  });
});
