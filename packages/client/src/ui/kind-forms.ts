import { GOAL_MAX_CHARS, JOB_TARGET_MAX_CHARS, targetProblem } from "@agentlife/shared";
import type { JobKind } from "@agentlife/shared";
import type { PanelContent } from "./computer.ts";
import type { PanelData } from "./panel-state.ts";
import { createSelect } from "./select.ts";

/** The job kinds that have their own furniture besides the computer. */
export type FurnitureKind = Exclude<JobKind, "change" | "audit-deps">;

export interface KindFormActions {
  startJob(repoId: string, goal: string, kind: FurnitureKind, target: string): void;
}

interface KindText {
  intro: string;
  /** Label of the target field. */
  field: string;
  placeholder: string;
  button: string;
}

const TEXT: Record<FurnitureKind, KindText> = {
  "review-branch": {
    intro:
      "Choose a local branch. The team reads what it changes, runs the tests on it and says whether it is ready to merge. Nothing is written to your project.",
    field: "Branch",
    placeholder: "",
    button: "Review branch",
  },
  "write-tests": {
    intro: "Name a file, folder or module. The team plans tests for it, you approve the plan, and the Developer may only add or change test files.",
    field: "Path or module",
    placeholder: "src/todo.ts",
    button: "Write tests",
  },
  document: {
    intro: "Name a topic or a path. The team researches it, you approve the plan, and the Developer may only write Markdown files and docs/.",
    field: "Topic or path",
    placeholder: "How the build works",
    button: "Write docs",
  },
};

const VERB: Record<FurnitureKind, string> = {
  "review-branch": "Review branch",
  "write-tests": "Write tests for",
  document: "Document",
};

/**
 * The goal the engine records for a job started from a piece of furniture: a verb, the target and the user's optional
 * notes on one line, cut to the goal limit. The engine still checks the target itself.
 */
export function kindGoal(kind: FurnitureKind, target: string, notes = ""): string {
  const extra = notes.replace(/\s+/g, " ").trim();
  const base = `${VERB[kind]} ${target}`;
  const goal = extra ? `${base}: ${extra}` : base;
  return goal.length > GOAL_MAX_CHARS ? `${goal.slice(0, GOAL_MAX_CHARS - 1)}…` : goal;
}

/** The branch the picker starts on: the first one that is not the checked-out branch (that one is the review base). */
export function defaultBranch(branches: readonly string[], current: string | null): string {
  return branches.find((b) => b !== current) ?? "";
}

const JOB_ENDED = ["report_ready", "delivered", "failed", "cancelled"];

/**
 * The form of a review desk, test lab or library shelf. Same shape as the Computer panel: the job starts from a button in
 * the footer, and what the user typed survives a re-render. `locked` is set in the recorded demo, where only the
 * recorded run can be started.
 */
export function createKindPanel(doc: Document, kind: FurnitureKind, actions: KindFormActions, locked = false) {
  const text = TEXT[kind];
  let branch = "";
  let target = "";
  let notes = "";

  return function render(data: PanelData, engineError: string | null): PanelContent {
    const root = doc.createElement("div");
    const note = (cls: string, msg: string, role?: string): HTMLElement => {
      const p = doc.createElement("p");
      p.className = cls;
      p.textContent = msg;
      if (role) p.setAttribute("role", role);
      root.appendChild(p);
      return p;
    };

    if (locked) {
      note("al-muted", "This desk is off in the recorded demo. Run AGENT LIFE on your computer to use it.");
      return { body: root };
    }
    if (engineError) {
      note("al-error", `Engine unavailable: ${engineError}`, "alert");
      return { body: root };
    }
    const project = data.repos[0];
    if (!project) {
      note("al-muted", "No repositories available.");
      return { body: root };
    }
    note("al-repo-line", `Project: ${project.name}`);
    note("al-muted", text.intro);

    const busy = data.job !== null && !JOB_ENDED.includes(data.job.state);
    let getTarget: () => string;
    let focusTarget: () => void;
    let problem: HTMLElement | undefined;

    if (kind === "review-branch") {
      const list = data.branches?.branches ?? [];
      if (list.length === 0) {
        note("al-muted", "This project has no local branches.");
        return { body: root };
      }
      if (!list.includes(branch)) branch = defaultBranch(list, data.branches?.current ?? null);
      const field = doc.createElement("div");
      field.className = "al-field";
      field.append(doc.createTextNode(text.field));
      const select = createSelect(doc, {
        label: text.field,
        value: branch,
        options: list.map((b) => ({ value: b, label: b === data.branches?.current ? `${b} (checked out)` : b })),
        onChange: (v) => {
          branch = v;
        },
      });
      field.appendChild(select);
      root.appendChild(field);
      getTarget = () => branch;
      focusTarget = () => select.querySelector("button")?.focus();
    } else {
      const label = doc.createElement("label");
      label.textContent = text.field;
      const input = doc.createElement("input");
      input.type = "text";
      input.className = "al-input";
      input.maxLength = JOB_TARGET_MAX_CHARS;
      input.placeholder = text.placeholder;
      input.value = target;
      input.addEventListener("input", () => {
        target = input.value;
        if (problem) problem.textContent = "";
      });
      label.appendChild(input);
      root.appendChild(label);
      problem = doc.createElement("p");
      problem.className = "al-error";
      problem.setAttribute("role", "alert");
      root.appendChild(problem);
      getTarget = () => input.value.trim();
      focusTarget = () => input.focus();

      const notesLabel = doc.createElement("label");
      notesLabel.textContent = "Notes (optional)";
      const area = doc.createElement("textarea");
      area.className = "al-input";
      area.rows = 3;
      area.maxLength = 150;
      area.placeholder = "Anything the team should know";
      area.value = notes;
      area.addEventListener("input", () => {
        notes = area.value;
      });
      notesLabel.appendChild(area);
      root.appendChild(notesLabel);
    }

    const btn = doc.createElement("button");
    btn.type = "button";
    btn.className = "al-btn";
    btn.textContent = busy ? "Job running..." : text.button;
    btn.disabled = busy;
    btn.addEventListener("click", () => {
      const value = getTarget();
      const why = targetProblem(kind, value);
      if (why) {
        if (problem) problem.textContent = why.charAt(0).toUpperCase() + why.slice(1);
        focusTarget();
        return;
      }
      actions.startJob(project.id, kindGoal(kind, value, notes), kind, value);
      target = "";
      notes = "";
    });
    return { body: root, footer: btn };
  };
}
