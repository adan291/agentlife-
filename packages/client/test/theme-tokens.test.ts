import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FOCUS_COLOUR, RADIUS_PX, SPACING, UI_COLOURS, contrastRatio, themeCss } from "../src/ui/theme.ts";

const uiDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "ui");
const sources = readdirSync(uiDir)
  .filter((f) => f.endsWith(".ts"))
  .map((f) => ({ file: f, text: readFileSync(join(uiDir, f), "utf8") }));

describe("design tokens", () => {
  it("has the spacing scale 4, 8, 12, 16, 24 and one 6 px radius", () => {
    expect(Object.values(SPACING)).toEqual([4, 8, 12, 16, 24]);
    expect(RADIUS_PX).toBe(6);
  });

  it("defines every token as a custom property", () => {
    const css = themeCss();
    for (const name of ["--al-s1: 4px", "--al-s2: 8px", "--al-s3: 12px", "--al-s4: 16px", "--al-s5: 24px", "--al-radius: 6px", "--al-border:", "--al-shadow:"]) {
      expect(css).toContain(name);
    }
  });

  it("buttons have hover, pressed, disabled and a focus-visible ring", () => {
    const css = themeCss();
    expect(css).toContain(".al-btn:hover");
    expect(css).toContain(".al-btn:active");
    expect(css).toContain(".al-btn:disabled");
    expect(css).toContain(":focus-visible");
  });

  it("the focus ring is visible on the panel and terminal backgrounds (3:1 for UI components)", () => {
    expect(contrastRatio(FOCUS_COLOUR, UI_COLOURS.panelBg)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(FOCUS_COLOUR, UI_COLOURS.inputBg)).toBeGreaterThanOrEqual(3);
  });
});

describe("no component positions itself against the window (requirement 1.5)", () => {
  it("only the shell uses position: fixed", () => {
    for (const s of sources) {
      if (s.file === "shell.ts") continue;
      expect(s.text, s.file).not.toMatch(/position:\s*fixed/);
    }
  });

  it("components use the radius and border tokens, not literals", () => {
    for (const s of sources) {
      if (s.file === "theme.ts") continue;
      expect(s.text, s.file).not.toMatch(/border-radius:\s*\d+px\s*[;}]/);
      expect(s.text, s.file).not.toContain("1px solid ${UI_COLOURS.border}");
    }
  });
});
