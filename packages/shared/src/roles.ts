import type { AgentId } from "./room.ts";

/** Display name and one-line part in the flow of each agent, shown in the hover tooltip. */
export const ROLE_INFO: Readonly<Record<AgentId, { name: string; does: string }>> = Object.freeze({
  architect: { name: "Architect", does: "Reads the repository and proposes a plan" },
  developer: { name: "Developer", does: "Implements the approved task in an isolated copy" },
  qa: { name: "QA", does: "Reviews the change and the test results" },
  builder: { name: "Builder", does: "Mirrors the Kiro sessions building this hotel" },
});
