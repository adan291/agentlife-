import { describe, expect, it } from "vitest";
import type { BuildBoard } from "@agentlife/shared";
import { BUILD_REFRESH_MS, chipText, isBuilderMessage, phaseLine, progressPercent, renderBuildBoard, renderBuildReport } from "../src/ui/build-board.ts";
import { PanelState } from "../src/ui/panel-state.ts";
import { fakeDoc, findAll, textOf } from "./fake-dom.ts";

const BOARD: BuildBoard = {
  phase: { text: "verify", spec: "build-board", at: 1 },
  rows: [
    { number: 1, spec: "project-registry", sessions: ["S14"], live: true, status: "waits_for_you", reason: "Merged; a check by you is pending", purpose: "Reception" },
    { number: 2, spec: "hotel-floors", sessions: ["S15"], live: true, status: "merged", purpose: "Lobby" },
    { number: 3, spec: "build-board", sessions: ["S15B"], live: false, status: "verifying", purpose: "Board" },
    { number: 4, spec: "job-types", sessions: [], live: false, status: "todo", purpose: "Types" },
  ],
  specs: [
    { spec: "project-registry", tasks: [], done: 0, total: 0, verdict: "none" },
    { spec: "hotel-floors", tasks: [{ number: "1", title: "Shared", done: true }, { number: "2", title: "Engine", done: true }], done: 2, total: 2, verdict: "PASS" },
    { spec: "build-board", tasks: [{ number: "1", title: "Engine", done: true }, { number: "2", title: "Client", done: false }], done: 1, total: 2, verdict: "FAIL" },
  ],
  sessions: [{ session: "S16", date: "2026-11-11 23:11", model: "auto", minutes: 16.9, status: "ok" }],
};

const noop = { toggle: () => {}, openReport: () => {} };

describe("construction board helpers", () => {
  it("says every status in words", () => {
    expect(["todo", "running", "verifying", "merged", "waits_for_you", "skipped"].map((s) => chipText(s as never))).toEqual([
      "To do",
      "Running",
      "Verifying",
      "Merged",
      "Waits for you",
      "Skipped",
    ]);
  });

  it("computes progress and survives empty specs", () => {
    expect(progressPercent({ done: 1, total: 2 })).toBe(50);
    expect(progressPercent({ done: 0, total: 0 })).toBe(0);
    expect(progressPercent(undefined)).toBe(0);
    expect(progressPercent({ done: 9, total: 3 })).toBe(100);
  });

  it("describes the conductor phase", () => {
    expect(phaseLine(undefined)).toBe("The conductor is not running.");
    expect(phaseLine({ text: "verify", spec: "build-board", at: 1 })).toBe("Conductor: verify on build-board");
    expect(phaseLine({ text: "stopped: pnpm check fails", spec: "x", at: 1 })).toBe("Stopped: pnpm check fails on x");
    expect(phaseLine({ text: "done", at: 1 })).toBe("The conductor finished the task map.");
  });
});

describe("renderBuildBoard", () => {
  it("lists rows in the order given with chip, progress bar and the highlighted running row", () => {
    const root = renderBuildBoard(fakeDoc(), BOARD, new Set(), noop);
    const rows = findAll(root, (e) => e.className === "al-build-row");
    expect(rows.map((r) => r.dataset["spec"])).toEqual(["project-registry", "hotel-floors", "build-board", "job-types"]);
    expect(rows[0]?.dataset["attention"]).toBe("true");
    expect(textOf(rows[0]!)).toContain("Waits for you: Merged; a check by you is pending");
    expect(rows[2]?.dataset["status"]).toBe("verifying");
    const bar = findAll(rows[2]!, (e) => e.getAttribute("role") === "progressbar")[0]!;
    expect(bar.getAttribute("aria-valuenow")).toBe("50");
    expect(textOf(root)).toContain("Conductor: verify on build-board");
    expect(textOf(root)).toContain("S16 · 2026-11-11 23:11 · auto · 16.9 min · ok");
  });

  it("shows tasks only for expanded rows and toggles through the action", () => {
    const calls: string[] = [];
    const actions = { toggle: (s: string) => calls.push(`toggle:${s}`), openReport: (s: string) => calls.push(`report:${s}`) };
    const closed = renderBuildBoard(fakeDoc(), BOARD, new Set(), actions);
    expect(textOf(closed)).not.toContain("1. Engine");
    findAll(closed, (e) => e.dataset["action"] === "toggle")[0]!.click();
    expect(calls).toEqual(["toggle:hotel-floors"]);
    const open = renderBuildBoard(fakeDoc(), BOARD, new Set(["build-board"]), actions);
    expect(textOf(open)).toContain("✓ 1. Engine");
    expect(textOf(open)).toContain("○ 2. Client");
  });

  it("offers the verdict link only for verified specs and opens the report", () => {
    const calls: string[] = [];
    const root = renderBuildBoard(fakeDoc(), BOARD, new Set(), { toggle: () => {}, openReport: (s) => calls.push(s) });
    const links = findAll(root, (e) => e.dataset["action"] === "report");
    expect(links.map((l) => l.dataset["verdict"])).toEqual(["pass", "fail"]);
    links[1]!.click();
    expect(calls).toEqual(["build-board"]);
  });

  it("shows loading and error states without a board", () => {
    expect(textOf(renderBuildBoard(fakeDoc(), null, new Set(), noop))).toContain("Loading");
    expect(textOf(renderBuildBoard(fakeDoc(), null, new Set(), noop, "needs the real engine"))).toContain("Not available: needs the real engine");
  });

  it("renders the report as text: raw HTML never becomes an element", () => {
    const root = renderBuildReport(fakeDoc(), "build-board", { spec: "build-board", content: "VERDICT: PASS\n\n# <img src=x onerror=1>\n- ok" }, () => {});
    expect(findAll(root, (e) => e.tagName === "img")).toHaveLength(0);
    expect(textOf(root)).toContain("<img src=x onerror=1>");
    expect(textOf(renderBuildReport(fakeDoc(), "build-board", null, () => {}))).toContain("Loading");
  });
});

describe("PanelState and the construction board", () => {
  it("keeps board data, re-renders only while the board is open", () => {
    const s = new PanelState();
    expect(s.apply({ type: "build_board", board: BOARD })).toBe(false);
    s.apply({ type: "open_panel", panel: "build" });
    expect(s.apply({ type: "build_board", board: BOARD })).toBe(true);
    expect(s.build).toBe(BOARD);
    expect(s.apply({ type: "build_report", report: { spec: "build-board", content: "x" } })).toBe(true);
  });

  it("records an engine error for the board and clears it when the panel opens again", () => {
    const s = new PanelState();
    s.apply({ type: "open_panel", panel: "build" });
    s.apply({ type: "error", code: "engine_unavailable", message: "needs the real engine" });
    expect(s.buildError).toBe("needs the real engine");
    s.close();
    s.apply({ type: "open_panel", panel: "build" });
    expect(s.buildError).toBeNull();
  });

  it("refreshes at most every 10 seconds", () => {
    expect(BUILD_REFRESH_MS).toBe(10_000);
  });

  it("recognises Builder messages as refresh triggers", () => {
    expect(isBuilderMessage({ type: "agent_state", agentId: "builder", state: "working" })).toBe(true);
    expect(isBuilderMessage({ type: "say", id: "builder", text: "verify" })).toBe(true);
    expect(isBuilderMessage({ type: "activity", line: { ts: 1, agentId: "builder", text: "Phase: verify" } })).toBe(true);
    expect(isBuilderMessage({ type: "agent_state", agentId: "architect", state: "working" })).toBe(false);
    expect(isBuilderMessage({ type: "say", id: 1, text: "hi" })).toBe(false);
  });
});
