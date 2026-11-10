import { GOAL_MAX_CHARS } from "@agentlife/shared";
import type { PanelData } from "./panel-state.ts";

export interface ComputerActions {
  startJob(repoId: string, goal: string): void;
}

/** Computer panel: pick an allowlisted repo, type a goal, start a job. Form values survive re-renders. */
export function createComputerPanel(doc: Document, actions: ComputerActions) {
  let repoId = "";
  let goal = "";

  return function render(data: PanelData, engineError: string | null): HTMLElement {
    const root = doc.createElement("div");
    if (engineError) {
      const err = doc.createElement("p");
      err.className = "al-error";
      err.setAttribute("role", "alert");
      err.textContent = `Engine unavailable: ${engineError}`;
      root.appendChild(err);
      return root;
    }
    const busy = data.job !== null && !["report_ready", "delivered", "failed", "cancelled"].includes(data.job.state);

    if (data.repos.length === 0) {
      const p = doc.createElement("p");
      p.textContent = "No repositories available.";
      root.appendChild(p);
      return root;
    }
    if (!data.repos.some((r) => r.id === repoId)) repoId = data.repos[0]!.id;

    const repoLabel = doc.createElement("label");
    repoLabel.textContent = "Repository";
    const select = doc.createElement("select");
    select.className = "al-input";
    for (const r of data.repos) {
      const o = doc.createElement("option");
      o.value = r.id;
      o.textContent = r.description ? `${r.name} - ${r.description}` : r.name;
      o.selected = r.id === repoId;
      select.appendChild(o);
    }
    select.addEventListener("change", () => {
      repoId = select.value;
    });
    repoLabel.appendChild(select);

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
      actions.startJob(select.value, g);
      goal = "";
    });

    root.append(repoLabel, goalLabel, btn);
    return root;
  };
}
