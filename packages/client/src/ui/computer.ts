import { GOAL_MAX_CHARS } from "@agentlife/shared";
import type { PanelData } from "./panel-state.ts";
import { createSelect } from "./select.ts";

export interface ComputerActions {
  startJob(repoId: string, goal: string): void;
}

/** What a panel shows: the scrollable body and, when it has actions, a footer. */
export interface PanelContent {
  body: HTMLElement;
  footer?: HTMLElement;
}

/** Computer panel: pick an allowlisted repo, type a goal, start a job (the button lives in the footer). Form values survive re-renders. */
export function createComputerPanel(doc: Document, actions: ComputerActions) {
  let repoId = "";
  let goal = "";

  return function render(data: PanelData, engineError: string | null): PanelContent {
    const root = doc.createElement("div");
    if (engineError) {
      const err = doc.createElement("p");
      err.className = "al-error";
      err.setAttribute("role", "alert");
      err.textContent = `Engine unavailable: ${engineError}`;
      root.appendChild(err);
      return { body: root };
    }
    const busy = data.job !== null && !["report_ready", "delivered", "failed", "cancelled"].includes(data.job.state);

    if (data.repos.length === 0) {
      const p = doc.createElement("p");
      p.textContent = "No repositories available.";
      root.appendChild(p);
      return { body: root };
    }
    if (!data.repos.some((r) => r.id === repoId)) repoId = data.repos[0]!.id;

    // One repository: say so, instead of a one-item dropdown that looks as if there were more to choose from.
    const repoBlock = doc.createElement("div");
    const only = data.repos.length === 1 ? data.repos[0] : undefined;
    if (only) {
      const line = doc.createElement("p");
      line.className = "al-repo-line";
      line.textContent = `Allowed repositories: 1 (${only.name})`;
      if (only.description) line.title = only.description;
      repoBlock.appendChild(line);
    } else {
      // A div, not a label: a label would forward clicks on its text to the button and toggle the list.
      const repoLabel = doc.createElement("div");
      repoLabel.className = "al-field";
      repoLabel.append(doc.createTextNode("Repository"));
      repoLabel.appendChild(
        createSelect(doc, {
          label: "Repository",
          value: repoId,
          options: data.repos.map((r) => ({ value: r.id, label: r.description ? `${r.name} - ${r.description}` : r.name })),
          onChange: (v) => {
            repoId = v;
          },
        }),
      );
      repoBlock.appendChild(repoLabel);
    }
    const goalLabel = doc.createElement("label");
    goalLabel.textContent = "Goal";
    const area = doc.createElement("textarea");
    area.className = "al-input";
    area.rows = 4;
    area.maxLength = GOAL_MAX_CHARS;
    area.placeholder = "What should the agents do?";
    area.value = goal;
    const count = doc.createElement("small");
    const updateCount = () => {
      count.textContent = `${area.value.length}/${GOAL_MAX_CHARS}`;
    };
    area.addEventListener("input", () => {
      goal = area.value;
      updateCount();
    });
    updateCount();
    goalLabel.append(area, count);

    const btn = doc.createElement("button");
    btn.type = "button";
    btn.className = "al-btn";
    btn.textContent = busy ? "Job running..." : "Start job";
    btn.disabled = busy;
    btn.addEventListener("click", () => {
      const g = area.value.trim();
      if (!g) {
        area.focus();
        return;
      }
      actions.startJob(repoId, g);
      goal = "";
    });

    root.append(repoBlock, goalLabel);
    return { body: root, footer: btn };
  };
}
