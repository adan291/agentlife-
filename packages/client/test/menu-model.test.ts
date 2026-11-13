import { describe, expect, it } from "vitest";
import { BREAK_MENU_PX, editButtonState, isEditKey, isHelpKey, isNarrow, menuItems, nextEnabled, profileLabel } from "../src/ui/menu-model.ts";
import type { MenuState } from "../src/ui/menu-model.ts";
import { BREAK_SIDE_PX } from "../src/ui/shell.ts";
import { inTextField } from "../src/ui/view-mode.ts";

const wide: MenuState = {
  narrow: false,
  zoom: 2,
  view: "hotel",
  editing: false,
  editable: true,
  balance: 40,
  level: "Lv 3",
  fontMin: false,
  fontMax: false,
};

const ids = (s: MenuState) => menuItems(s).map((i) => i.id);

describe("menu items", () => {
  it("lists the five always-there items with their shortcuts", () => {
    const items = menuItems(wide);
    expect(items.map((i) => i.id)).toEqual(["commands", "zoom", "text-smaller", "text-larger", "help"]);
    const key = (id: string) => items.find((i) => i.id === id)?.shortcut;
    expect(key("commands")).toBe("Ctrl+K");
    expect(key("zoom")).toBe("Z");
    expect(key("help")).toBe("?");
  });

  it("the zoom item shows the current zoom and says what a choice does", () => {
    const two = menuItems(wide).find((i) => i.id === "zoom")!;
    expect(two.label).toBe("Zoom 2×");
    expect(two.note).toBe("Switch to 1×");
    const one = menuItems({ ...wide, zoom: 1 }).find((i) => i.id === "zoom")!;
    expect(one.label).toBe("Zoom 1×");
    expect(one.note).toBe("Switch to 2×");
  });

  it("text size items are disabled at the limits", () => {
    const items = menuItems({ ...wide, fontMin: true });
    expect(items.find((i) => i.id === "text-smaller")?.disabled).toBe(true);
    expect(items.find((i) => i.id === "text-larger")?.disabled).toBeUndefined();
    expect(menuItems({ ...wide, fontMax: true }).find((i) => i.id === "text-larger")?.disabled).toBe(true);
  });

  it("when the top bar has collapsed, the view, edit and profile items come first, with a separator after them", () => {
    const narrow = menuItems({ ...wide, narrow: true });
    expect(narrow.map((i) => i.id)).toEqual(["view", "edit", "profile", "commands", "zoom", "text-smaller", "text-larger", "help"]);
    expect(narrow.map((i) => i.separatorAfter === true)).toEqual([false, false, true, false, false, false, false, false]);
    expect(narrow[0]).toMatchObject({ label: "Show the list", shortcut: "L" });
    expect(narrow[1]).toMatchObject({ label: "Edit room", shortcut: "E" });
    expect(narrow[2]!.label).toBe("Profile: Lv 3, 40 Ecto");
  });

  it("the view item offers the other view", () => {
    expect(menuItems({ ...wide, narrow: true, view: "list" })[0]!.label).toBe("Show the hotel");
  });

  it("the edit item says Done while editing, and is disabled where editing is not possible (but never while editing)", () => {
    const s = { ...wide, narrow: true };
    expect(menuItems({ ...s, editing: true })[1]).toMatchObject({ label: "Done editing" });
    expect(menuItems({ ...s, editable: false })[1]!.disabled).toBe(true);
    expect(menuItems({ ...s, editable: false, editing: true })[1]!.disabled).toBeUndefined();
  });

  it("without an economy there is no profile item, and the separator moves to the last item of the group", () => {
    const narrow = menuItems({ ...wide, narrow: true, balance: null, level: null });
    expect(narrow.map((i) => i.id)).toEqual(["view", "edit", "commands", "zoom", "text-smaller", "text-larger", "help"]);
    expect(narrow[1]!.separatorAfter).toBe(true);
    expect(ids({ ...wide, balance: null, level: null })).not.toContain("profile");
  });

  it("the profile label shows whichever of level and Ecto the hotel has", () => {
    expect(profileLabel(40, "Lv 3")).toBe("Profile: Lv 3, 40 Ecto");
    expect(profileLabel(5, null)).toBe("Profile: 5 Ecto");
    expect(profileLabel(null, "Lv 1")).toBe("Profile: Lv 1");
    expect(profileLabel(null, null)).toBe("Profile");
  });
});

describe("the collapse rule", () => {
  it("collapses below 900 px, at the width where the side bar collapses too", () => {
    expect(BREAK_MENU_PX).toBe(900);
    expect(BREAK_MENU_PX).toBe(BREAK_SIDE_PX);
    for (const w of [360, 375, 800, 899]) expect(isNarrow(w)).toBe(true);
    for (const w of [900, 1366, 1920]) expect(isNarrow(w)).toBe(false);
  });
});

describe("the Edit room button", () => {
  it("reads Edit room and works on a floor that can be arranged", () => {
    expect(editButtonState(true, true, false)).toMatchObject({ text: "Edit room", pressed: false, disabled: false });
  });

  it("reads Done and is pressed while editing, even when nothing else would allow it", () => {
    expect(editButtonState(true, true, true)).toMatchObject({ text: "Done", pressed: true, disabled: false });
    expect(editButtonState(false, false, true).disabled).toBe(false);
  });

  it("is disabled in the recorded demo, with the reason in its title", () => {
    const s = editButtonState(false, true, false);
    expect(s.disabled).toBe(true);
    expect(s.title).toMatch(/recorded demo/);
  });

  it("is disabled where the room cannot be arranged", () => {
    expect(editButtonState(true, false, false)).toMatchObject({ disabled: true });
  });
});

describe("keys", () => {
  const target = (tagName: string) => ({ tagName });

  it("E starts editing outside text fields, without Ctrl, Alt or Meta, and not on key repeat", () => {
    expect(isEditKey({ key: "e" }, inTextField)).toBe(true);
    expect(isEditKey({ key: "E" }, inTextField)).toBe(true);
    expect(isEditKey({ key: "e", ctrlKey: true }, inTextField)).toBe(false);
    expect(isEditKey({ key: "e", metaKey: true }, inTextField)).toBe(false);
    expect(isEditKey({ key: "e", altKey: true }, inTextField)).toBe(false);
    expect(isEditKey({ key: "e", repeat: true }, inTextField)).toBe(false);
    expect(isEditKey({ key: "e", target: target("INPUT") }, inTextField)).toBe(false);
    expect(isEditKey({ key: "e", target: target("TEXTAREA") }, inTextField)).toBe(false);
    expect(isEditKey({ key: "e", target: target("BUTTON") }, inTextField)).toBe(true);
    expect(isEditKey({ key: "r" }, inTextField)).toBe(false);
  });

  it("? opens the help outside text fields", () => {
    expect(isHelpKey({ key: "?" }, inTextField)).toBe(true);
    expect(isHelpKey({ key: "?", target: target("INPUT") }, inTextField)).toBe(false);
    expect(isHelpKey({ key: "?", ctrlKey: true }, inTextField)).toBe(false);
    expect(isHelpKey({ key: "/" }, inTextField)).toBe(false);
  });
});

describe("moving through the menu", () => {
  const items = [
    { id: "view", label: "a" },
    { id: "edit", label: "b", disabled: true },
    { id: "zoom", label: "c" },
    { id: "help", label: "d" },
  ] as const;

  it("skips disabled items and wraps around", () => {
    expect(nextEnabled(items, -1, 1)).toBe(0);
    expect(nextEnabled(items, 0, 1)).toBe(2);
    expect(nextEnabled(items, 3, 1)).toBe(0);
    expect(nextEnabled(items, 2, -1)).toBe(0);
    expect(nextEnabled(items, 0, -1)).toBe(3);
  });

  it("going up from nothing lands on the last item", () => {
    expect(nextEnabled(items, -1, -1)).toBe(3);
  });

  it("gives -1 when nothing can be chosen", () => {
    expect(nextEnabled([{ id: "view", label: "a", disabled: true }], -1, 1)).toBe(-1);
    expect(nextEnabled([], -1, 1)).toBe(-1);
  });
});
