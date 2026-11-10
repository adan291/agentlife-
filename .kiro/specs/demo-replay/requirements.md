# Requirements Document

## Introduction

Judges must be able to open a public URL and see AGENT LIFE working without our machine, credentials or backend. demo-replay adds a replay mode to the client that plays a recorded real run (exported by the agent-engine) through the same world simulation used live, and publishes it as a static site. It also covers the submission polish that depends on it.

Context: docs/architecture-proposal.md ("Modo demo"), Kiroween rules (working app URL, video under 3 minutes, English materials).

## Requirements

### Requirement 1: Replay transport

**User Story:** As a judge, I want the room to play a real recorded run in my browser, so that I can see the product working without installing anything.

#### Acceptance Criteria
1. THE client SHALL implement `ReplayTransport` with the same `Transport` interface as `LiveTransport`.
2. ReplayTransport SHALL load a `RunExport` JSON (validated with `RunExportSchema`), run `WorldSim` in the browser, and feed the recorded agent events into it with their original relative timing.
3. THE user avatar SHALL remain controllable during replay (walking, opening panels).
4. THE mailbox SHALL show the recorded approval; WHEN the judge clicks Approve, THE replay SHALL continue (Reject SHALL show a note that the recorded run was approved and continue).
5. Panels SHALL show the real recorded artifacts (plan, diff, test log, review, report).

### Requirement 2: Replay controls and honesty

**User Story:** As a judge, I want to know it is a replay and control its speed, so that the demo is clear and short.

#### Acceptance Criteria
1. THE client SHALL show a visible banner "Replay of a real run recorded on <date>" in replay mode.
2. THE client SHALL offer speeds 1×, 4× and 16× and a restart button.
3. Idle gaps longer than 10 s of recorded time SHALL be compressed to 2 s at any speed.

### Requirement 3: Mode selection and build

**User Story:** As the developer, I want one client build that serves both modes, so that there is no drift between demo and live.

#### Acceptance Criteria
1. THE client SHALL start in replay mode WHEN built with `VITE_MODE=demo` or opened with `?mode=demo`, and in live mode otherwise.
2. THE demo build SHALL work from a sub-path (configurable `base`) with all assets resolved through `import.meta.env.BASE_URL`.
3. THE demo build SHALL make no network requests other than its own static files (test: build output contains no `ws://` or engine URLs used in demo mode).

### Requirement 4: Publishing

**User Story:** As a judge, I want a stable public URL, so that I can test the project at any time during judging.

#### Acceptance Criteria
1. A GitHub Actions workflow SHALL build the demo and publish it to GitHub Pages on every push to `main`.
2. A smoke test (Playwright, Chromium) SHALL open the published build locally, wait for the canvas, and check that the replay banner and at least one agent state change appear within 30 s.

### Requirement 5: Submission material

**User Story:** As the entrant, I want the submission material ready, so that judges understand the project and how Kiro was used.

#### Acceptance Criteria
1. THE README (English) SHALL include: what it is, demo URL, how to run live mode, architecture diagram, safety model, assets/attribution, license.
2. `docs/kiro-usage.md` (English) SHALL describe how specs, steering, hooks, custom agents, kiro-cli headless, property-based tests and Kiro Crew were used, with links to the files.
3. A video script (`docs/video-script.md`, under 3 minutes) SHALL cover problem, live room, real run, report, and Kiro usage.
