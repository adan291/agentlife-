import { describe, expect, it } from "vitest";
import { createComputerPanel } from "../src/ui/computer.ts";
import { createReplayBar, replayBannerText } from "../src/ui/replay-bar.ts";
import type { ReplayControls } from "../src/ui/replay-bar.ts";
import { FakeElement, fakeDoc, findAll, textOf } from "./fake-dom.ts";

function setup() {
  const calls: string[] = [];
  const controls: ReplayControls & { current: number } = {
    current: 1,
    get speed() {
      return this.current;
    },
    setSpeed(s) {
      this.current = s;
      calls.push(`speed ${s}`);
    },
    restart() {
      calls.push("restart");
    },
  };
  const doc = fakeDoc();
  const host = doc.createElement("div") as unknown as FakeElement;
  const bar = createReplayBar(host as unknown as HTMLElement, controls, new Date(Date.UTC(2026, 10, 11, 14, 59)), doc);
  const buttons = findAll(host, (e) => e.tagName === "button");
  const states = () => findAll(host, (e) => e.dataset["agentState"] !== undefined);
  return { host, bar, buttons, controls, calls, states };
}

describe("replay banner", () => {
  it("names the recording date in UTC", () => {
    expect(replayBannerText(new Date(Date.UTC(2026, 10, 11, 23, 59)))).toBe("Replay of a real run recorded on November 11, 2026");
  });

  it("shows the banner, the speeds 1×, 4×, 16× and a restart button", () => {
    const { host, buttons } = setup();
    expect(textOf(host)).toContain("Replay of a real run recorded on November 11, 2026");
    expect(buttons.map((b) => b.textContent)).toEqual(["1×", "4×", "16×", "Restart"]);
  });

  it("marks the active speed and drives the controls", () => {
    const { buttons, calls, controls } = setup();
    expect(buttons.map((b) => b.getAttribute("aria-pressed"))).toEqual(["true", "false", "false", null]);
    buttons[2]!.click();
    expect(controls.current).toBe(16);
    expect(buttons.map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "false", "true", null]);
    buttons[3]!.click();
    expect(calls).toEqual(["speed 16", "restart"]);
  });
});

describe("agent state list", () => {
  it("starts idle and follows welcome and agent_state messages", () => {
    const { bar, states } = setup();
    expect(states().map((s) => `${s.dataset["agent"]}=${s.dataset["agentState"]}`)).toEqual([
      "architect=idle",
      "developer=idle",
      "qa=idle",
      "builder=idle",
    ]);
    bar.handle({ type: "agent_state", agentId: "architect", state: "thinking" });
    expect(states()[0]!.dataset["agentState"]).toBe("thinking");
    expect(states()[0]!.textContent).toBe("architect: thinking");
    bar.handle({ type: "agent_state", agentId: "qa", state: "working" });
    expect(states()[2]!.dataset["agentState"]).toBe("working");
  });
});

describe("locked goal", () => {
  const data = { repos: [{ id: "r", name: "r" }], job: null } as unknown as Parameters<ReturnType<typeof createComputerPanel>>[0];

  it("prefills the recorded goal as read-only and starts the job with it", () => {
    const started: string[] = [];
    const render = createComputerPanel(fakeDoc(), { startJob: (r, g) => started.push(`${r}:${g}`) }, "Fix the bug");
    const content = render(data, null);
    const area = findAll(content.body, (e) => e.tagName === "textarea")[0] as FakeElement & { readOnly?: boolean };
    expect(area.value).toBe("Fix the bug");
    expect(area.readOnly).toBe(true);
    (content.footer as unknown as FakeElement).click();
    expect(started).toEqual(["r:Fix the bug"]);
    // The goal is still there after a re-render.
    expect((findAll(render(data, null).body, (e) => e.tagName === "textarea")[0] as FakeElement).value).toBe("Fix the bug");
  });

  it("leaves the goal editable when none is locked", () => {
    const area = findAll(createComputerPanel(fakeDoc(), { startJob: () => {} })(data, null).body, (e) => e.tagName === "textarea")[0] as FakeElement & { readOnly?: boolean };
    expect(area.value).toBe("");
    expect(area.readOnly).toBeUndefined();
  });
});
