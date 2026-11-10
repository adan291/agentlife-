# Requirements Document

## Introduction

A first-time visitor (a Kiroween judge opening the demo URL) cannot tell which objects do something or what each agent is for. room-hints adds discoverability to the room: hover tooltips for interactive furniture and for the ghosts, a visible hint on usable objects, a pending badge on the mailbox, and a short "how it works" guide. It also fixes a defect found in live run 1: step durations are missing from the export and report.

Context: world-room and build-crew specs (scene, overlays, panels), agent-engine (job view, export), steering tech.md (client is plain DOM + PixiJS, no UI framework). All user-facing text in English.

## Requirements

### Requirement 1: Furniture tooltips

**User Story:** As a first-time visitor, I want to know what an object does before clicking it, so that I can use the room without instructions.

#### Acceptance Criteria
1. WHEN the pointer rests on an interactive item (computer, mailbox, board) for 300 ms, THE client SHALL show a tooltip with the item name and one line describing its function:
   - Computer: "Give the agents a job"
   - Mailbox: "Approve plans and read reports"
   - Board: "Timeline of the current job"
2. THE tooltip SHALL follow the pointer, stay inside the viewport, and hide on pointer leave, on click and when a panel opens.
3. Decorative items SHALL show no tooltip.
4. Tooltip texts SHALL come from the furniture catalog (`FurniDef.hint`, optional) so new interactive items get one by data.

### Requirement 2: Usable objects stand out

**User Story:** As a visitor, I want usable objects to look usable, so that I find them quickly.

#### Acceptance Criteria
1. Interactive items SHALL have a soft pulsing outline or glow (palette accent colour), visible at both zoom levels, stronger on hover.
2. The pointer cursor (already present) SHALL remain on interactive items only.
3. THE effect SHALL be disabled when the user prefers reduced motion (`prefers-reduced-motion: reduce`): static outline instead of a pulse.

### Requirement 3: Agent tooltips

**User Story:** As a visitor, I want to know who each ghost is and what it is doing, so that I can follow the work.

#### Acceptance Criteria
1. WHEN the pointer rests on an agent for 300 ms, THE client SHALL show: role name, one line on its part in the flow, its current state and status text, and its model when known.
   - Architect: "Reads the repository and proposes a plan"
   - Developer: "Implements the approved task in an isolated copy"
   - QA: "Reviews the change and the test results"
   - Builder: "Mirrors the Kiro sessions building this hotel"
2. THE model per role SHALL reach the client through the existing protocol (engine `GET /config/roles` or a field in the welcome snapshot), never from hard-coded client values.

### Requirement 4: Mailbox pending badge

**User Story:** As a user, I want to see that something waits for me, so that a job never stalls unnoticed.

#### Acceptance Criteria
1. WHEN at least one approval is pending, THE mailbox SHALL show a badge with the pending count and a gentle bounce; the badge SHALL disappear when none are pending.
2. WHEN a new report arrives and the mailbox panel has not been opened since, THE badge SHALL show a dot.
3. The HUD status line SHALL also say "Plan waiting for your approval" while an approval is pending.

### Requirement 5: How it works

**User Story:** As a judge with no context, I want a short guide, so that I understand the product in seconds.

#### Acceptance Criteria
1. ON the first visit (localStorage flag), THE client SHALL show a dismissible card with three steps: "1. Click the computer and give the agents a job. 2. Approve the Architect's plan in the mailbox. 3. Watch them build and test it, then read the report in the mailbox." plus one line: "Agents are real Kiro agents; tests run in an isolated Docker container."
2. A "?" button in the HUD SHALL reopen it.
3. The card SHALL not block the canvas when closed and SHALL close with Esc.

### Requirement 6: Step durations (defect from live run 1)

**User Story:** As a user, I want the report to show how long each step took, so that I can judge cost and speed.

#### Acceptance Criteria
1. THE engine SHALL record when each step ends (ok, failed or cancelled), so that `durationMs` appears for every finished step in `GET /tasks/:id`, the export and `report.md`.
2. A test SHALL run a job with FakeRuntime delays and assert every finished step has `durationMs > 0`.
