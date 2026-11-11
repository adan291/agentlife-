import { describe, expect, it } from "vitest";
import type { Project, RegisterProjectBody, RegisterProjectResult, Report } from "@agentlife/shared";
import { PanelState, type PanelData } from "../src/ui/panel-state.ts";
import { createReceptionPanel, findingLine, stackLabel } from "../src/ui/reception.ts";
import { deliveryCommand, renderDelivery, renderReportViewer } from "../src/ui/report-viewer.ts";
import { fakeDoc, findAll, textOf } from "./fake-dom.ts";

const builtin: Project = { id: "haunted-todo", name: "haunted-todo", stack: "node-npm", testCommand: "npm test", builtin: true, registeredAt: 0 };
const mine: Project = { id: "my-app", name: "My App", stack: "unsupported-tests", testCommand: "", builtin: false, registeredAt: Date.UTC(2026, 10, 11) };

const data = (projects: Project[] = [builtin, mine]): PanelData => ({ repos: [], projects, job: null, approvals: [], reports: [], details: null });

function harness() {
  const sent: string[] = [];
  const bodies: RegisterProjectBody[] = [];
  let rerenders = 0;
  const panel = createReceptionPanel(fakeDoc(), {
    register: (b) => {
      sent.push("register");
      bodies.push(b);
    },
    remove: (id) => sent.push(`remove:${id}`),
  });
  const render = (d: PanelData = data(), registration: RegisterProjectResult | null = null, extra: { locked?: string; engineError?: string } = {}) =>
    panel(d, { registration, ...extra }, () => rerenders++);
  return { sent, bodies, render, rerenders: () => rerenders };
}

const field = (root: unknown, name: string) => findAll(root, (e) => e.dataset["field"] === name)[0]!;
const byData = (root: unknown, key: string, value?: string) =>
  findAll(root, (e) => e.dataset[key] !== undefined && (value === undefined || e.dataset[key] === value))[0];

describe("Reception panel", () => {
  it("lists the projects with stack, test command and date, and lets only registered ones be removed", () => {
    const { render } = harness();
    const { body } = render();
    const text = textOf(body);
    expect(text).toContain("haunted-todo");
    expect(text).toContain("Node (npm) · test: npm test · built in");
    expect(text).toContain("My App");
    expect(text).toContain("No supported tests · test: none");
    expect(byData(body, "remove", "my-app")).toBeDefined();
    expect(byData(body, "remove", "haunted-todo")).toBeUndefined();
    expect(text).toContain("secret files are blocked");
    expect(text).toContain("never pushes");
  });

  it("sends the form trimmed, leaves the test command out when empty and does nothing without a folder or name", () => {
    const { render, sent, bodies } = harness();
    const { body, footer } = render();
    footer?.click();
    expect(sent).toEqual([]);
    field(body, "path").value = "  D:\\AgentHotel\\app  ";
    footer?.click();
    expect(sent).toEqual([]);
    field(body, "name").value = " App ";
    footer?.click();
    expect(bodies).toEqual([{ path: "D:\\AgentHotel\\app", name: "App" }]);
    field(body, "testCommand").value = "npm run check";
    footer?.click();
    expect(bodies[1]).toEqual({ path: "D:\\AgentHotel\\app", name: "App", testCommand: "npm run check" });
  });

  it("shows the rule that refused a folder", () => {
    const { render } = harness();
    const { body } = render(data(), { status: "error", code: "not_a_git_repo", message: "The folder must be the root of a git repository." });
    const alert = findAll(body, (e) => e.getAttribute("role") === "alert")[0];
    expect(alert?.textContent).toBe("The folder must be the root of a git repository.");
  });

  it("asks for confirmation with the masked findings, then registers again with acceptFindings", () => {
    const { render, bodies, rerenders } = harness();
    const first = render();
    field(first.body, "path").value = "D:\\AgentHotel\\leaky";
    field(first.body, "name").value = "Leaky";
    first.footer?.click();
    expect(bodies).toEqual([{ path: "D:\\AgentHotel\\leaky", name: "Leaky" }]);

    const result: RegisterProjectResult = {
      status: "needs_acceptance",
      total: 2,
      findings: [
        { severity: "high", kind: "kiro-api-key", masked: "ksk_…J0 (20 chars)", where: "src/config.js", count: 1 },
        { severity: "medium", kind: "email", masked: "j***@corp.io", where: "package.json", count: 3 },
      ],
    };
    const second = render(data(), result);
    const text = textOf(second.body);
    expect(text).toContain("found 2 possible secrets or personal details");
    expect(text).toContain("HIGH kiro-api-key ksk_…J0 (20 chars) in src/config.js");
    expect(text).toContain("MEDIUM email j***@corp.io in package.json (+2 more)");
    byData(second.body, "accept", "findings")?.click();
    expect(bodies[1]).toEqual({ path: "D:\\AgentHotel\\leaky", name: "Leaky", acceptFindings: true });

    // Cancel hides the confirmation until the next registration.
    findAll(second.body, (e) => e.tagName === "button" && e.textContent === "Cancel")[0]?.click();
    expect(rerenders()).toBe(1);
    expect(byData(render(data(), result).body, "accept")).toBeUndefined();
  });

  it("clears the form after a successful registration and says what happened", () => {
    const { render } = harness();
    const first = render();
    field(first.body, "path").value = "D:\\AgentHotel\\app";
    field(first.body, "name").value = "App";
    first.footer?.click();
    const ok: RegisterProjectResult = { status: "ok", project: mine };
    const after = render(data(), ok);
    expect(textOf(after.body)).toContain("Registered My App");
    expect(field(after.body, "path").value).toBe("");
    expect(field(after.body, "name").value).toBe("");
    // A later render of the same result does not clear what the user types next.
    field(after.body, "path").value = "D:\\AgentHotel\\next";
    const again = render(data(), ok);
    expect(field(again.body, "path").value).toBe("");
  });

  it("asks before removing, says the user's files are not touched, and removes only after the confirmation", () => {
    const { render, sent, rerenders } = harness();
    const first = render();
    byData(first.body, "remove", "my-app")?.click();
    expect(sent).toEqual([]);
    expect(rerenders()).toBe(1);

    const confirm = render();
    expect(textOf(confirm.body)).toContain("Your files are not touched");
    byData(confirm.body, "confirm", "remove")?.click();
    expect(sent).toEqual(["remove:my-app"]);

    byData(render().body, "remove", "my-app")?.click();
    findAll(render().body, (e) => e.tagName === "button" && e.textContent === "Keep")[0]?.click();
    expect(sent).toEqual(["remove:my-app"]);
  });

  it("is read-only in the demo: the list and the reason, no form", () => {
    const { render } = harness();
    const { body, footer } = render(data([builtin]), null, { locked: "This is a recorded run." });
    expect(textOf(body)).toContain("This is a recorded run.");
    expect(findAll(body, (e) => e.tagName === "input")).toHaveLength(0);
    expect(footer).toBeUndefined();
  });

  it("shows an engine problem instead of an empty list", () => {
    const { render } = harness();
    const { body } = render(data([]), null, { engineError: "cannot list projects" });
    expect(textOf(body)).toContain("Engine unavailable: cannot list projects");
    expect(textOf(body)).not.toContain("No projects yet");
  });

  it("formats findings and stacks", () => {
    expect(stackLabel("node-npm")).toBe("Node (npm)");
    expect(findingLine({ severity: "high", kind: "private-key", masked: "***", where: "a.pem", count: 1 })).toBe("HIGH private-key *** in a.pem");
  });
});

describe("panel state for the Reception", () => {
  it("keeps the project list and the last registration answer, and forgets the answer when the panel opens", () => {
    const state = new PanelState();
    expect(state.apply({ type: "projects", projects: [builtin, mine] })).toBe(true);
    expect(state.data.projects.map((p) => p.id)).toEqual(["haunted-todo", "my-app"]);
    const error: RegisterProjectResult = { status: "error", code: "no_commits", message: "The repository has no commits yet." };
    expect(state.apply({ type: "register_result", result: error })).toBe(true);
    expect(state.registration).toEqual(error);
    state.apply({ type: "open_panel", panel: "reception" });
    expect(state.open).toBe("reception");
    expect(state.registration).toBeNull();
  });
});

describe("Deliver as branch in the report viewer", () => {
  const report = (delivery: Report["delivery"]): Report => ({
    reportId: "report-task-1",
    taskId: "task-1",
    title: "Report: x",
    markdown: "# AGENT LIFE report\n\n## Summary\n\n- **Verdict:** PASS\n",
    ...(delivery ? { delivery } : {}),
  });
  const actions = () => {
    const calls: string[] = [];
    return { calls, back: () => calls.push("back"), deliver: (id: string) => calls.push(`deliver:${id}`) };
  };

  it("offers the button while the branch can be delivered, and says nothing is merged or pushed", () => {
    const a = actions();
    const root = renderReportViewer(fakeDoc(), report({ state: "available" }), a);
    const btn = byData(root, "action", "deliver");
    expect(btn?.textContent).toBe("Deliver as branch");
    expect(textOf(root)).toContain("nothing is merged or pushed");
    btn?.click();
    expect(a.calls).toEqual(["deliver:task-1"]);
  });

  it("shows the branch, the short commit and the command once delivered, with no button", () => {
    const root = renderDelivery(fakeDoc(), report({ state: "done", branch: "agentlife/task-1", commit: "0123456789abcdef" }), actions());
    const text = textOf(root);
    expect(text).toContain("Delivered as branch agentlife/task-1 (commit 0123456");
    expect(text).toContain("git log agentlife/task-1");
    expect(byData(root, "action", "deliver")).toBeUndefined();
    expect(deliveryCommand("agentlife/task-1")).toBe("git log agentlife/task-1");
  });

  it("shows nothing for a report without delivery", () => {
    expect(renderDelivery(fakeDoc(), report(undefined), actions())).toBeNull();
  });
});
