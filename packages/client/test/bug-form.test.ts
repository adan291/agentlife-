import { describe, expect, it } from "vitest";
import { BUG_NOTE_MAX, FURNI_CATALOG, validateRoom } from "@agentlife/shared";
import type { RoomDef } from "@agentlife/shared";
import lobby from "../../world-server/rooms/lobby.json";
import { withoutBugJar } from "../src/bugs/demo-room.ts";
import { createBugForm, manualMessage } from "../src/ui/bug-form.ts";
import type { BugFormActions } from "../src/ui/bug-form.ts";
import { FakeElement, FakeDocument, findAll, textOf } from "./fake-dom.ts";

/** What the form puts on the page, by the part it plays. */
function setup(capture: () => Promise<string | undefined> = async () => "PNGDATA") {
  const doc = new FakeDocument();
  const host = new FakeElement("div");
  const submitted: { note: string; shot: string | undefined }[] = [];
  const actions: BugFormActions = { capture, submit: (note, shot) => void submitted.push({ note, shot }) };
  const form = createBugForm(doc as unknown as Document, host as unknown as HTMLElement, actions);
  const root = form.element as unknown as FakeElement;
  const note = findAll(root, (e) => e.tagName === "textarea")[0]!;
  const box = findAll(root, (e) => e.tagName === "input")[0]! as FakeElement & { checked: boolean };
  const buttons = findAll(root, (e) => e.tagName === "button");
  const cancel = buttons.find((b) => textOf(b) === "Cancel")!;
  const submit = (): void => root.fire("submit", { preventDefault: () => undefined });
  const press = (key: string): { stopped: boolean } => {
    const seen = { stopped: false };
    root.fire("keydown", { key, preventDefault: () => undefined, stopPropagation: () => void (seen.stopped = true) });
    return seen;
  };
  const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
  return { form, root, note, box, cancel, submit, press, settle, submitted, host };
}

describe("manualMessage", () => {
  it("is the first line of the note, so two different notes are two different bugs", () => {
    expect(manualMessage("The jar is empty\nsecond line")).toBe("The jar is empty");
    expect(manualMessage("\n\n  after a blank line  \nmore")).toBe("after a blank line");
  });

  it("has a fixed text when there is no note, and cuts a long first line", () => {
    expect(manualMessage("")).toBe("Bug reported by hand");
    expect(manualMessage("   \n  ")).toBe("Bug reported by hand");
    expect(manualMessage("x".repeat(400))).toHaveLength(200);
  });
});

describe("the Report a bug form", () => {
  it("is closed until opened, and opens with the screenshot box on", async () => {
    const t = setup();
    expect(t.root.hidden).toBe(true);
    expect(t.form.isOpen).toBe(false);
    t.form.open();
    expect(t.form.isOpen).toBe(true);
    expect(t.root.hidden).toBe(false);
    expect(t.root.getAttribute("role")).toBe("dialog");
    // The picture is being taken: the box is on but cannot be changed yet.
    expect(t.box.checked).toBe(true);
    expect(t.box.disabled).toBe(true);
    await t.settle();
    expect(t.box.disabled).toBe(false);
    expect(t.box.checked).toBe(true);
    expect(textOf(t.root)).toContain("Attach a screenshot of the room");
  });

  it("limits the note to 500 characters and shows how many are used", () => {
    const t = setup();
    t.form.open();
    expect(t.note.maxLength).toBe(BUG_NOTE_MAX);
    t.note.value = "hello";
    t.note.fire("input");
    expect(textOf(t.root)).toContain(`5 / ${BUG_NOTE_MAX}`);
  });

  it("Save hands over the trimmed note and the picture, and closes", async () => {
    const t = setup();
    t.form.open();
    await t.settle();
    t.note.value = "  the shop did not open  ";
    t.submit();
    expect(t.submitted).toEqual([{ note: "the shop did not open", shot: "PNGDATA" }]);
    expect(t.form.isOpen).toBe(false);
    expect(t.root.hidden).toBe(true);
  });

  it("with the box off the picture is not sent", async () => {
    const t = setup();
    t.form.open();
    await t.settle();
    t.box.checked = false;
    t.note.value = "x";
    t.submit();
    expect(t.submitted).toEqual([{ note: "x", shot: undefined }]);
  });

  it("an empty note is allowed: the report is the picture and the place", async () => {
    const t = setup();
    t.form.open();
    await t.settle();
    t.submit();
    expect(t.submitted).toEqual([{ note: "", shot: "PNGDATA" }]);
  });

  it("saving before the picture is ready sends the report without it", () => {
    const t = setup(() => new Promise<string | undefined>(() => undefined));
    t.form.open();
    t.note.value = "quick";
    t.submit();
    expect(t.submitted).toEqual([{ note: "quick", shot: undefined }]);
  });

  it("when no picture can be taken the box is off and says so, and a report is still possible", async () => {
    for (const capture of [async () => undefined, async () => Promise.reject(new Error("no canvas"))]) {
      const t = setup(capture);
      t.form.open();
      await t.settle();
      expect(t.box.checked).toBe(false);
      expect(t.box.disabled).toBe(true);
      expect(textOf(t.root)).toContain("No screenshot could be taken");
      t.note.value = "x";
      t.submit();
      expect(t.submitted).toEqual([{ note: "x", shot: undefined }]);
    }
  });

  it("Cancel and Esc close it without sending anything, and Esc is not passed on to the panel behind", () => {
    const t = setup();
    t.form.open();
    t.cancel.click();
    expect(t.form.isOpen).toBe(false);
    t.form.open();
    const esc = t.press("Escape");
    expect(esc.stopped).toBe(true);
    expect(t.form.isOpen).toBe(false);
    expect(t.press("a").stopped).toBe(false);
    expect(t.submitted).toEqual([]);
  });

  it("a picture that arrives for a form that was closed and opened again is not used", async () => {
    let first: (v: string) => void = () => undefined;
    let calls = 0;
    const t = setup(() => (++calls === 1 ? new Promise<string | undefined>((r) => (first = r)) : Promise.resolve("SECOND")));
    t.form.open();
    t.cancel.click();
    t.form.open();
    await t.settle();
    first("FIRST");
    await t.settle();
    t.submit();
    expect(t.submitted).toEqual([{ note: "", shot: "SECOND" }]);
  });

  it("starts empty each time it opens", async () => {
    const t = setup();
    t.form.open();
    t.note.value = "old note";
    t.cancel.click();
    t.form.open();
    expect(t.note.value).toBe("");
  });

  it("submitting a closed form does nothing", () => {
    const t = setup();
    t.submit();
    expect(t.submitted).toEqual([]);
  });
});

describe("the recorded demo", () => {
  const lobbyRoom = validateRoom(lobby) as RoomDef;

  it("the live lobby has the bug jar and the demo's lobby does not", () => {
    expect(lobbyRoom.furni.some((p) => FURNI_CATALOG[p.defId]?.interaction === "bugs")).toBe(true);
    const demo = withoutBugJar(lobbyRoom);
    expect(demo.furni.some((p) => p.defId === "bug_jar" || FURNI_CATALOG[p.defId]?.interaction === "bugs")).toBe(false);
    expect(demo.furni).toHaveLength(lobbyRoom.furni.length - 1);
    // Nothing else changed.
    expect({ ...demo, furni: [] }).toEqual({ ...lobbyRoom, furni: [] });
    expect(lobbyRoom.furni.filter((p) => p.defId !== "bug_jar")).toEqual(demo.furni);
  });

  it("a room with no jar comes back the same", () => {
    const demo = withoutBugJar(lobbyRoom);
    expect(withoutBugJar(demo)).toEqual(demo);
  });
});
