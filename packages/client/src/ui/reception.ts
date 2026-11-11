import {
  PROJECT_NAME_MAX,
  PROJECT_PATH_MAX,
  PROJECT_TEST_COMMAND_MAX,
  type LeakFindingView,
  type Project,
  type ProjectStack,
  type RegisterProjectBody,
  type RegisterProjectResult,
} from "@agentlife/shared";
import type { PanelContent } from "./computer.ts";
import type { PanelData } from "./panel-state.ts";

export interface ReceptionActions {
  register(body: RegisterProjectBody): void;
  remove(projectId: string): void;
}

/** What the panel shows besides the project list: the last answer to a registration and, in the demo, why it is locked. */
export interface ReceptionView {
  registration: RegisterProjectResult | null;
  /** The engine did not answer (e.g. it is down); shown instead of an empty list. */
  engineError?: string | null;
  /** Replay mode: registering is off, and this is the reason shown instead of the form. */
  locked?: string | undefined;
}

export function stackLabel(stack: ProjectStack): string {
  return stack === "node-npm" ? "Node (npm)" : "No supported tests";
}

/** `high kiro-api-key ksk_…ab (20 chars) in src/config.js` plus a count when the value is in several places. */
export function findingLine(f: LeakFindingView): string {
  const more = f.count > 1 ? ` (+${f.count - 1} more)` : "";
  return `${f.severity.toUpperCase()} ${f.kind} ${f.masked} in ${f.where}${more}`;
}

function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = doc.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function button(doc: Document, label: string, onClick: () => void, title?: string): HTMLButtonElement {
  const b = el(doc, "button", "al-btn", label);
  b.type = "button";
  if (title) b.title = title;
  b.addEventListener("click", onClick);
  return b;
}

function registeredText(p: Project): string {
  return p.builtin ? "built in" : new Date(p.registeredAt).toLocaleDateString();
}

function projectRow(doc: Document, p: Project, askRemove: (id: string) => void, removing: string | null, actions: ReceptionActions, cancel: () => void): HTMLElement {
  const row = el(doc, "li", "al-project");
  row.dataset["project"] = p.id;
  const head = el(doc, "div", "al-row al-wrap");
  const name = el(doc, "strong", undefined, p.name);
  const facts = el(doc, "span", "al-muted", `${stackLabel(p.stack)} · test: ${p.testCommand || "none"} · ${registeredText(p)}`);
  head.append(name, facts);
  row.appendChild(head);
  if (p.builtin) return row;
  if (removing === p.id) {
    const ask = el(doc, "div", "al-card");
    ask.appendChild(el(doc, "p", undefined, `Remove ${p.name} from the hotel? Your files are not touched; only the hotel's own copy is deleted.`));
    const buttons = el(doc, "div", "al-row");
    const yes = button(doc, "Remove", () => {
      cancel();
      actions.remove(p.id);
    });
    yes.dataset["confirm"] = "remove";
    buttons.append(yes, button(doc, "Keep", cancel));
    ask.appendChild(buttons);
    row.appendChild(ask);
  } else {
    const rm = button(doc, "Remove", () => askRemove(p.id), `Remove ${p.name} from the hotel (your files are not touched)`);
    rm.dataset["remove"] = p.id;
    head.appendChild(rm);
  }
  return row;
}

function resultBlock(doc: Document, result: RegisterProjectResult, accept: () => void, dismiss: () => void): HTMLElement | null {
  if (result.status === "error") {
    const err = el(doc, "p", "al-error", result.message);
    err.setAttribute("role", "alert");
    return err;
  }
  if (result.status === "ok") {
    const ok = el(doc, "p", undefined, `Registered ${result.project.name}. Agents can work on it from the computer.`);
    ok.setAttribute("role", "status");
    return ok;
  }
  const card = el(doc, "section", "al-card");
  card.setAttribute("role", "alert");
  card.appendChild(
    el(doc, "p", undefined, `The scanner found ${result.total} possible ${result.total === 1 ? "secret or personal detail" : "secrets or personal details"} in the committed files. Agents read this code through Kiro, so check before you go on.`),
  );
  const list = el(doc, "ul");
  list.className = "al-findings";
  for (const f of result.findings) list.appendChild(el(doc, "li", undefined, findingLine(f)));
  card.appendChild(list);
  if (result.total > result.findings.length) card.appendChild(el(doc, "p", "al-muted", `${result.total - result.findings.length} more not shown.`));
  const buttons = el(doc, "div", "al-row");
  const go = button(doc, "Register anyway", accept);
  go.dataset["accept"] = "findings";
  buttons.append(go, button(doc, "Cancel", dismiss));
  card.appendChild(buttons);
  return card;
}

/**
 * Reception panel: the projects of the hotel, a form to register a folder, a confirmation step that shows the
 * scanner's findings (masked) before the project is accepted, and a two-step removal that says the user's files are
 * not touched. Form values and the pending removal survive re-renders.
 */
export function createReceptionPanel(doc: Document, actions: ReceptionActions) {
  let path = "";
  let name = "";
  let testCommand = "";
  let removing: string | null = null;
  /** The request that is waiting for the user to accept its findings. */
  let pending: RegisterProjectBody | null = null;
  /** A result the user dismissed (so the next render does not show it again). */
  let dismissed: RegisterProjectResult | null = null;
  /** The last result whose side effect (clearing the form after a success) has been applied. */
  let handled: RegisterProjectResult | null = null;

  return function renderPanel(data: PanelData, view: ReceptionView, rerender: () => void): PanelContent {
    const result = view.registration;
    if (result !== handled) {
      handled = result;
      if (result?.status === "ok") {
        path = "";
        name = "";
        testCommand = "";
      }
    }
    const root = el(doc, "div");
    root.appendChild(
      el(doc, "p", "al-muted", "Register a project from your computer. Agents read this project's code through Kiro; secret files are blocked. The hotel never changes your working copy and never pushes."),
    );

    const h = el(doc, "h4", undefined, "Projects");
    root.appendChild(h);
    if (view.engineError) {
      const err = el(doc, "p", "al-error", `Engine unavailable: ${view.engineError}`);
      err.setAttribute("role", "alert");
      root.appendChild(err);
    }
    if (data.projects.length === 0 && !view.engineError) root.appendChild(el(doc, "p", "al-muted", "No projects yet."));
    const list = el(doc, "ul");
    list.className = "al-projects";
    for (const p of data.projects) {
      list.appendChild(
        projectRow(doc, p, (id) => { removing = id; rerender(); }, removing, actions, () => { removing = null; rerender(); }),
      );
    }
    root.appendChild(list);

    if (view.locked) {
      root.appendChild(el(doc, "p", "al-muted", view.locked));
      return { body: root };
    }

    root.appendChild(el(doc, "h4", undefined, "Register a project"));
    const field = (label: string, value: string, set: (v: string) => void, max: number, placeholder: string): HTMLInputElement => {
      const wrap = el(doc, "label", undefined, label);
      const input = el(doc, "input", "al-input");
      input.type = "text";
      input.maxLength = max;
      input.placeholder = placeholder;
      input.value = value;
      input.addEventListener("input", () => set(input.value));
      wrap.appendChild(input);
      root.appendChild(wrap);
      return input;
    };
    const pathInput = field("Folder", path, (v) => (path = v), PROJECT_PATH_MAX, "D:\\AgentHotel\\my-project");
    const nameInput = field("Name", name, (v) => (name = v), PROJECT_NAME_MAX, "My project");
    const cmdInput = field("Test command", testCommand, (v) => (testCommand = v), PROJECT_TEST_COMMAND_MAX, "Leave empty for the default (npm test)");
    pathInput.dataset["field"] = "path";
    nameInput.dataset["field"] = "name";
    cmdInput.dataset["field"] = "testCommand";

    const body = (): RegisterProjectBody => {
      path = pathInput.value.trim();
      name = nameInput.value.trim();
      testCommand = cmdInput.value.trim();
      return { path, name, ...(testCommand ? { testCommand } : {}) };
    };

    if (result && result !== dismissed) {
      const block = resultBlock(
        doc,
        result,
        () => {
          if (pending) actions.register({ ...pending, acceptFindings: true });
        },
        () => {
          pending = null;
          dismissed = result;
          rerender();
        },
      );
      if (block) root.appendChild(block);
    }

    const submit = button(doc, "Register project", () => {
      const b = body();
      if (!b.path) return void pathInput.focus();
      if (!b.name) return void nameInput.focus();
      pending = b;
      dismissed = null;
      actions.register(b);
    });
    submit.dataset["action"] = "register";
    return { body: root, footer: submit };
  };
}
