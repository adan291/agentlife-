import { DEFAULT_NIGHT_CONFIG, DEFAULT_PIPELINE } from "@agentlife/shared";
import type { BranchesResponse, BuildBoard, BuildReport, ImportView, MemoryState, NightJob, NightState, PipelineResponse } from "@agentlife/shared";
import type { MemoryLink, PipelineLink } from "./engine-link.ts";

/**
 * What the night board, the Library, the review desk, the pipeline editor and the imports of the HR desk show in the
 * scripted engine (tests and Playwright only, `FAKE_PANELS=1`). The data is fixed and read-only: every change is refused,
 * like the scripted HR office does, so a screenshot of these panels is the same on every run.
 */

const REFUSED = "The scripted engine only shows this panel. Start the real engine to change it.";
const refuse = (): Promise<never> => Promise.reject(new Error(REFUSED));

/** A morning in the year the screenshots are frozen at, so no date of the page is "today". */
const THEN = Date.UTC(2029, 11, 31, 12, 0, 0);

const NIGHT_JOBS: NightJob[] = [
  {
    id: "night-1",
    repoId: "haunted-todo",
    kind: "review-branch",
    target: "fix/empty-title",
    goal: "Review branch fix/empty-title",
    tier: "cheap",
    preApprove: false,
    deliver: false,
    status: "scheduled",
    addedAt: THEN,
  },
  {
    id: "night-2",
    repoId: "haunted-todo",
    kind: "write-tests",
    target: "src/todo.js",
    goal: "Write tests for src/todo.js",
    tier: "normal",
    preApprove: true,
    deliver: true,
    status: "scheduled",
    addedAt: THEN + 1,
  },
  {
    id: "night-3",
    repoId: "haunted-todo",
    kind: "change",
    goal: "Reject an empty title in addTodo",
    tier: "normal",
    preApprove: false,
    deliver: false,
    status: "waiting",
    addedAt: THEN - 1000,
    reason: "The plan touches src/ and waits for your approval.",
  },
  {
    id: "night-4",
    repoId: "haunted-todo",
    kind: "audit-deps",
    goal: "Audit dependencies",
    tier: "cheap",
    preApprove: false,
    deliver: false,
    status: "done",
    addedAt: THEN - 2000,
    verdict: "pass",
  },
];

/** The schedule: a window that is closed, two jobs waiting for a night, one waiting for the user and one done. */
export function fakeNight(): NightState {
  return { config: { ...DEFAULT_NIGHT_CONFIG }, open: false, jobs: structuredClone(NIGHT_JOBS) };
}

/** The Library of the project: a few notes of every kind, one note waiting for a decision, no librarian at work. */
export function fakeMemory(): MemoryLink {
  const state: MemoryState = {
    entries: [
      { id: "mem-aaaaaa01", kind: "decision", text: "Titles are trimmed before they are stored.", sourceTaskId: "task-0001", createdAt: THEN },
      { id: "mem-aaaaaa02", kind: "convention", text: "Tests live next to the module, as <name>.test.js.", sourceTaskId: "task-0001", createdAt: THEN },
      { id: "mem-aaaaaa03", kind: "pitfall", text: "list() returns the live array: copy it before sorting.", sourceTaskId: "task-0002", createdAt: THEN },
      { id: "mem-aaaaaa04", kind: "finding", text: "The haunted test fails only when the clock is at midnight.", sourceTaskId: "task-0002", createdAt: THEN },
    ],
    proposals: [
      { id: "prop-bbbbbb01", kind: "convention", text: "Run npm test before asking for a review.", sourceTaskId: "task-0003", createdAt: THEN },
    ],
    autoRemember: false,
    learning: [],
  };
  return {
    state: () => Promise.resolve(structuredClone(state)),
    edit: refuse,
    remove: refuse,
    accept: refuse,
    dismiss: refuse,
    setAutoRemember: refuse,
  };
}

/** The default pipeline with the default team. */
export function fakePipeline(): PipelineLink {
  const state = (projectId: string): PipelineResponse => ({
    projectId,
    customised: false,
    steps: DEFAULT_PIPELINE.map((s) => ({ ...s })),
    members: [
      { id: "architect", displayName: "Architect", role: "architect", model: "fake" },
      { id: "developer", displayName: "Developer", role: "developer", model: "fake" },
      { id: "qa", displayName: "QA", role: "qa", model: "fake" },
    ],
  });
  return { state: (projectId) => Promise.resolve(state(projectId)), save: refuse, reset: refuse };
}

/** The local branches of the project. */
export function fakeBranches(): BranchesResponse {
  return { current: "main", branches: ["main", "feature/login", "fix/empty-title"] };
}

/** Where the HR desk may import from, and what it already imported: one template that waits (with concerns) and one approved. */
export const FAKE_IMPORT_SOURCES = ["https://example.com/templates/security-reviewer.json", "https://example.com/templates/docs-writer.json"];

export function fakeImports(): ImportView[] {
  return [
    {
      id: "security-reviewer",
      url: FAKE_IMPORT_SOURCES[0]!,
      name: "Security reviewer",
      role: "reviewer",
      tier: "read-only",
      description: "Reads a change looking for unsafe input handling.",
      persona: "You are a careful reviewer. You read every change as if the input came from a stranger.",
      defaultModel: "fake",
      hash: "a".repeat(64),
      ignored: ["tools", "permissions"],
      review: { verdict: "concerns", flags: ["The persona asks the agent to ignore earlier instructions."], checkedBy: "checks" },
      status: "pending",
      importedAt: THEN,
    },
    {
      id: "docs-writer",
      url: FAKE_IMPORT_SOURCES[1]!,
      name: "Docs writer",
      role: "researcher",
      tier: "read-only",
      description: "Reads the code and writes short notes about it.",
      persona: "You write short, plain notes. You say what you could not find.",
      defaultModel: "fake",
      hash: "b".repeat(64),
      ignored: [],
      review: { verdict: "pass", flags: [], checkedBy: "checks" },
      status: "approved",
      importedAt: THEN,
    },
  ];
}

/** The construction board of the lobby with three rows in three states, a running phase and two sessions. */
export function fakeBuildBoard(): BuildBoard {
  return {
    phase: { text: "session S12", spec: "night-shift", at: THEN },
    rows: [
      { number: 1, spec: "hotel-floors", sessions: ["S10", "S11"], live: true, status: "merged", purpose: "Lobby, elevator and one floor per project" },
      { number: 2, spec: "night-shift", sessions: ["S12"], live: true, status: "running", purpose: "Schedule jobs for the night; morning summary in the mailbox" },
      { number: 3, spec: "final-demo", sessions: [], live: true, status: "waits_for_you", reason: "Record the video with Kiro", purpose: "Re-record the replay, video, Devpost" },
    ],
    specs: [
      { spec: "hotel-floors", tasks: [{ number: "1", title: "Rooms and the elevator", done: true }, { number: "2", title: "Floors per project", done: true }], done: 2, total: 2, verdict: "PASS" },
      { spec: "night-shift", tasks: [{ number: "1", title: "Schedule and window", done: true }, { number: "2", title: "Morning summary", done: false }], done: 1, total: 2, verdict: "none" },
      { spec: "final-demo", tasks: [{ number: "1", title: "Re-record the replay", done: false }], done: 0, total: 1, verdict: "none" },
    ],
    sessions: [
      { session: "S11", date: "2029-12-30 21:10", model: "claude-sonnet-5.5", minutes: 24.5, status: "ok" },
      { session: "S12", date: "2029-12-31 09:40", model: "claude-sonnet-5.5", minutes: 12, status: "running" },
    ],
  };
}

/** The verifier's report of a row, as the board shows it. */
export function fakeBuildReport(spec: string): BuildReport {
  return { spec, content: `VERDICT: PASS\n\n# Verification of ${spec}\n\n- 1.1 Rooms: PASS\n- 1.2 Elevator: PASS\n` };
}