import type { CatalogueEntry, HrState, ImportView, TeamMember, TeamResponse, TeamSuggestion } from "@agentlife/shared";
import type { HrLink } from "./engine-link.ts";
import { FAKE_IMPORT_SOURCES, fakeImports } from "./fake-panels.ts";

const REFUSED = "The scripted HR office only shows the default team. Start the real engine to hire and fire.";

const CATALOGUE: CatalogueEntry[] = [
  { id: "architect", name: "Architect", role: "architect", tier: "read-only", defaultModel: "fake", description: "Plans the change.", source: "built-in", origin: "built-in" },
  { id: "developer", name: "Developer", role: "developer", tier: "write-in-worktree", defaultModel: "fake", description: "Writes the change in its own copy.", source: "built-in", origin: "built-in" },
  { id: "qa", name: "QA", role: "qa", tier: "read-only", defaultModel: "fake", description: "Reviews the result.", source: "built-in", origin: "built-in" },
];

function defaultTeam(): TeamMember[] {
  return CATALOGUE.map((c) => ({ id: c.id, displayName: c.name, templateId: c.id, role: c.role, model: "fake" }));
}

/**
 * The HR office of the scripted engine (tests and Playwright only, `FAKE_HR=1`): the default team of the one project, and a
 * refusal for every change. It lets the HR desk panel, the Look section and the team view run without the real engine.
 */
export function createFakeHr(projectId: string, projectName: string, withImports = false): HrLink {
  const team = (): TeamResponse => ({ projectId, customised: false, members: defaultTeam() });
  const refuse = (): Promise<never> => Promise.reject(new Error(REFUSED));
  return {
    state: (): Promise<HrState> =>
      Promise.resolve({
        catalogue: CATALOGUE,
        teams: [{ projectId, name: projectName, customised: false, members: defaultTeam() }],
        imports: withImports ? fakeImports() : [],
        sources: withImports ? FAKE_IMPORT_SOURCES : [],
        models: {},
      }),
    team: (id: string): Promise<TeamResponse> => (id === projectId ? Promise.resolve(team()) : Promise.reject(new Error("unknown project"))),
    hire: refuse,
    update: refuse,
    fire: refuse,
    importTemplate: (): Promise<ImportView> => refuse(),
    approveImport: (): Promise<ImportView> => refuse(),
    rejectImport: refuse,
    suggest: (): Promise<TeamSuggestion> => refuse(),
  };
}
