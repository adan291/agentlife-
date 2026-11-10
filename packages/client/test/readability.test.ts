import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { ActivityLine } from "@agentlife/shared";
import { ROLE_COLOURS } from "../src/palette.ts";
import { LABEL_OUTLINE_PX, MIN_LABEL_PX, bubbleTextStyle, labelStyle } from "../src/scene/label-style.ts";
import { diffLineKind, parseMarkdown, renderMarkdown } from "../src/ui/markdown.ts";
import {
  TERMINAL_MAX_LINES,
  TerminalModel,
  formatLine,
  shouldAutoScroll,
} from "../src/ui/terminal.ts";
import {
  FONT_DEFAULT,
  FONT_KEY,
  FONT_MAX,
  FONT_MIN,
  UI_COLOURS,
  clampFont,
  contrastRatio,
  createTheme,
  cssHex,
  loadFont,
} from "../src/ui/theme.ts";
import type { FlagStorage } from "../src/ui/guide.ts";

function memory(): FlagStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

const line = (n: number, agentId: ActivityLine["agentId"] = "qa"): ActivityLine => ({ ts: 1_700_000_000_000 + n * 1000, agentId, text: `line ${n}` });

describe("font size", () => {
  it("defaults to 14 px and clamps to 12..18", () => {
    expect(FONT_DEFAULT).toBe(14);
    expect(clampFont(5)).toBe(FONT_MIN);
    expect(clampFont(99)).toBe(FONT_MAX);
    expect(clampFont(15.4)).toBe(15);
    expect(clampFont(Number.NaN)).toBe(FONT_DEFAULT);
    fc.assert(fc.property(fc.double({ noNaN: true }), (n) => clampFont(n) >= FONT_MIN && clampFont(n) <= FONT_MAX));
  });

  it("loads a saved size and ignores garbage or throwing storage", () => {
    const s = memory();
    expect(loadFont(s)).toBe(14);
    s.data.set(FONT_KEY, "17");
    expect(loadFont(s)).toBe(17);
    s.data.set(FONT_KEY, "banana");
    expect(loadFont(s)).toBe(14);
    s.data.set(FONT_KEY, "40");
    expect(loadFont(s)).toBe(FONT_MAX);
    expect(loadFont(undefined)).toBe(14);
    const broken: FlagStorage = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(loadFont(broken)).toBe(14);
  });

  it("A−/A+ change --al-font by 1 px within the limits and persist the choice", () => {
    const set: Record<string, string> = {};
    const root = { style: { setProperty: (k: string, v: string) => void (set[k] = v) } } as unknown as HTMLElement;
    const s = memory();
    const seen: number[] = [];
    const theme = createTheme(s, root);
    theme.onChange((n) => seen.push(n));
    expect(set["--al-font"]).toBe("14px");
    theme.bigger();
    expect(set["--al-font"]).toBe("15px");
    expect(s.data.get(FONT_KEY)).toBe("15");
    for (let i = 0; i < 10; i++) theme.bigger();
    expect(theme.size).toBe(FONT_MAX);
    for (let i = 0; i < 20; i++) theme.smaller();
    expect(theme.size).toBe(FONT_MIN);
    expect(set["--al-font"]).toBe("12px");
    expect(seen[0]).toBe(15);
    expect(seen.every((n) => n >= FONT_MIN && n <= FONT_MAX)).toBe(true);
    // A new session starts from the saved size.
    expect(createTheme(s, root).size).toBe(FONT_MIN);
  });
});

describe("contrast (requirement 5.1: at least 4.5:1)", () => {
  it("computes known WCAG ratios", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#777777")).toBeCloseTo(1, 5);
  });

  it("text colours are readable on the panel and terminal backgrounds", () => {
    const backgrounds = [UI_COLOURS.panelBg, UI_COLOURS.inputBg];
    const texts = [UI_COLOURS.text, UI_COLOURS.muted, UI_COLOURS.error, UI_COLOURS.accentText, UI_COLOURS.accent];
    for (const bg of backgrounds) for (const fg of texts) expect(contrastRatio(fg, bg), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
  });

  it("diff colours are readable on their line backgrounds", () => {
    expect(contrastRatio(UI_COLOURS.add, UI_COLOURS.addBg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(UI_COLOURS.del, UI_COLOURS.delBg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(UI_COLOURS.hunk, UI_COLOURS.inputBg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(UI_COLOURS.muted, UI_COLOURS.inputBg)).toBeGreaterThanOrEqual(4.5);
  });

  it("role colours are readable as terminal text", () => {
    for (const key of ["architect", "developer", "qa", "builder"] as const) {
      expect(contrastRatio(cssHex(ROLE_COLOURS[key]), UI_COLOURS.inputBg), key).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(cssHex(ROLE_COLOURS[key]), UI_COLOURS.panelBg), key).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("cssHex pads to six digits", () => {
    expect(cssHex(0x0000ff)).toBe("#0000ff");
    expect(cssHex(0x2fd4c2)).toBe("#2fd4c2");
  });
});

describe("TerminalModel", () => {
  it("keeps the newest 300 lines, oldest dropped, order kept", () => {
    const m = new TerminalModel();
    for (let i = 0; i < TERMINAL_MAX_LINES + 25; i++) m.push(line(i));
    const v = m.visible();
    expect(v).toHaveLength(TERMINAL_MAX_LINES);
    expect(v[0]?.text).toBe("line 25");
    expect(v.at(-1)?.text).toBe(`line ${TERMINAL_MAX_LINES + 24}`);
  });

  it("never holds more than 300 lines for any number of pushes (property)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 700 }), (n) => {
        const m = new TerminalModel();
        for (let i = 0; i < n; i++) m.push(line(i));
        return m.size === Math.min(n, TERMINAL_MAX_LINES);
      }),
      { numRuns: 30 },
    );
  });

  it("filters by agent and shows everything with 'all'", () => {
    const m = new TerminalModel();
    m.push(line(1, "qa"));
    m.push(line(2, "developer"));
    m.push(line(3, "qa"));
    m.filter = "qa";
    expect(m.visible().map((l) => l.text)).toEqual(["line 1", "line 3"]);
    m.filter = "builder";
    expect(m.visible()).toEqual([]);
    m.filter = "all";
    expect(m.visible()).toHaveLength(3);
  });

  it("seed replaces the content and caps it", () => {
    const m = new TerminalModel();
    m.push(line(99));
    m.seed(Array.from({ length: 50 }, (_, i) => line(i)));
    expect(m.size).toBe(50);
    expect(m.visible()[0]?.text).toBe("line 0");
    m.seed([]);
    expect(m.size).toBe(0);
  });

  it("formats a line as time, role name and text", () => {
    const f = formatLine(line(3, "architect"));
    expect(f.time).toMatch(/^\d\d:\d\d:\d\d$/);
    expect(f.role).toBe("Architect");
    expect(f.text).toBe("line 3");
  });
});

describe("shouldAutoScroll", () => {
  it("follows new lines at the bottom and stops when the user scrolled up", () => {
    expect(shouldAutoScroll(400, 100, 500)).toBe(true); // exactly at the bottom
    expect(shouldAutoScroll(397, 100, 500)).toBe(true); // within the slack
    expect(shouldAutoScroll(300, 100, 500)).toBe(false); // scrolled up
    expect(shouldAutoScroll(0, 100, 100)).toBe(true); // nothing to scroll
  });
});

// ---- report diffs ----

describe("diff colouring", () => {
  it("classifies unified diff lines", () => {
    expect(diffLineKind("+added")).toBe("add");
    expect(diffLineKind("-removed")).toBe("del");
    expect(diffLineKind(" context")).toBe("ctx");
    expect(diffLineKind("@@ -1,3 +1,4 @@")).toBe("hunk");
    expect(diffLineKind("+++ b/src/a.ts")).toBe("meta");
    expect(diffLineKind("--- a/src/a.ts")).toBe("meta");
    expect(diffLineKind("diff --git a/x b/x")).toBe("meta");
    expect(diffLineKind("")).toBe("ctx");
  });

  it("keeps the language of a fenced block", () => {
    const blocks = parseMarkdown("```diff\n+a\n```\n\n```\nplain\n```");
    expect(blocks).toEqual([
      { kind: "code", text: "+a", lang: "diff" },
      { kind: "code", text: "plain" },
    ]);
  });

  it("renders diff blocks as one span per line with a class, text only", () => {
    class El {
      className = "";
      textContent = "";
      children: El[] = [];
      constructor(readonly tag: string) {}
      appendChild(c: El): El {
        this.children.push(c);
        return c;
      }
    }
    const doc = {
      createElement: (tag: string) => new El(tag),
      createTextNode: (text: string) => Object.assign(new El("#text"), { textContent: text }),
      createDocumentFragment: () => new El("#fragment"),
    } as unknown as Document;
    const frag = renderMarkdown(doc, "```diff\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old <b>\n+new\n same\n```") as unknown as El;
    const pre = frag.children[0]!;
    expect(pre.tag).toBe("pre");
    const code = pre.children[0]!;
    expect(code.children.map((s) => s.className)).toEqual([
      "al-diff-line al-diff-meta",
      "al-diff-line al-diff-meta",
      "al-diff-line al-diff-hunk",
      "al-diff-line al-diff-del",
      "al-diff-line al-diff-add",
      "al-diff-line al-diff-ctx",
    ]);
    // Raw HTML in a diff stays text.
    expect(code.children[3]?.textContent).toBe("-old <b>");
    expect(code.children[3]?.children).toEqual([]);
  });
});

// ---- room labels ----

describe("canvas labels (requirement 5.5)", () => {
  it("never go below 11 px and carry a dark outline", () => {
    expect(MIN_LABEL_PX).toBe(11);
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 40 }), (size) => {
        const s = labelStyle(size, 0xffffff);
        const stroke = s.stroke as { width: number };
        return (s.fontSize as number) >= 11 && stroke.width === LABEL_OUTLINE_PX && LABEL_OUTLINE_PX >= 2;
      }),
    );
    expect(bubbleTextStyle(8, 170).fontSize).toBe(11);
  });
});
