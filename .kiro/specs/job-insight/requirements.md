# Requirements Document

## Introduction

User feedback after live run 3 (2026-11-11), with screenshots:
1. There is no way to tell which work belongs to which task, which model did it or how big it was: "todo está como todo con todo".
2. Some button and text colours are unreadable (the native repository dropdown renders white and blue; some buttons have low contrast).
3. The top stepper looks wrong: it overflows its box and shows scroll bars.
4. Ghosts show no visual sign of working (the badge text changes, but nothing reads as "processing").
5. When the report was delivered nothing visible happened: the Architect walked to the mailbox and only a small dot appeared.

job-insight makes the current job and each agent's work legible, fixes the stepper and contrast, adds working animations to the ghosts, and makes report delivery an event the user cannot miss. It also adds the WebSocket Origin check recommended by the first security audit (finding M3).

What can be measured: per step wall time; per agent the kiro-cli context usage percentage (`session_info_update.usagePercentage` in stream-json, see docs/spikes/kiro-cli.md); the model per role; files read and edited (from tool calls). Credits and tokens are NOT exposed by kiro-cli headless; the UI says "credits: see Kiro usage panel" and never invents a number.

Context: room-ux, ui-shell, agent-engine, agent-pipeline specs; steering tech.md and security.md. All user-facing text in English.

## Requirements

### Requirement 1: Work attribution per agent

**User Story:** As a user, I want to see what each agent is working on, so that I know which work belongs to which task.

#### Acceptance Criteria
1. THE engine SHALL emit `agent.work { agentId, taskId, step, title, model, contextPct?, filesRead, filesEdited }` when a step starts and whenever its values change (at most once per second per agent), where `title` is the plan task title (or "Analysing <repo>" for the Architect's analyse step) and file counts come from tool calls.
2. THE engine SHALL read `contextPct` from kiro-cli `session_info_update` records; FakeRuntime SHALL report a deterministic value for tests.
3. THE team bar row SHALL show, under the state: the task title (ellipsised, full text in a tooltip), the step, elapsed time, a small context meter (0–100 %) and "n read · m edited".
4. THE agent tooltip in the room SHALL show the same information.
5. Terminal lines SHALL carry a short task tag (`#d232` from the task id) and the step, so lines from different jobs or steps are distinguishable.

### Requirement 2: Job card

**User Story:** As a user, I want one place that explains the current job, so that I can understand it at a glance.

#### Acceptance Criteria
1. Clicking the board or the stepper SHALL open a Job panel with: goal, chosen task and its acceptance criteria, repository, branch, state, and a table of steps (agent, model, status, duration, context peak, files read/edited, attempt).
2. THE panel SHALL link to the plan, the diff, the test log, the review and the report of the job, each opening in a readable viewer (Requirement 5).
3. A line "Credits: not reported by kiro-cli headless; see the Kiro usage panel" SHALL be shown instead of any credit number.

### Requirement 3: Stepper layout

#### Acceptance Criteria
1. THE stepper SHALL never show scroll bars and SHALL fit the top bar at widths ≥ 640 px: labels shrink to icons with tooltips when needed, durations move under the label in a smaller font.
2. Completed, current, failed and pending steps SHALL be distinguishable by shape and colour (not colour only).
3. A Playwright check at 1366 × 768 and 800 × 600 SHALL assert the stepper's scrollWidth equals its clientWidth.

### Requirement 4: Working visuals on ghosts

**User Story:** As a user, I want to see at a glance who is busy, so that the room shows the work happening.

#### Acceptance Criteria
1. WHILE an agent is `thinking`, THE ghost SHALL show an animated thought cloud with three pulsing dots above its head.
2. WHILE an agent is `working`, THE ghost SHALL show a small floating candle with a flickering flame (Kiroween) next to it, and its desk monitor SHALL glow and scroll lines.
3. WHILE `waiting_approval`, THE ghost SHALL show a bouncing envelope icon; on `error`, a red exclamation; on `done`, a short sparkle once.
4. Animations SHALL respect `prefers-reduced-motion` (static icons) and be drawn procedurally (no external assets, no brand marks).

### Requirement 5: Report delivery and readable artifacts

**User Story:** As a user, I want to notice when the report arrives and read it comfortably.

#### Acceptance Criteria
1. WHEN `report.ready` arrives, THE Architect SHALL show a speech bubble "Report delivered", the mailbox SHALL glow and bounce, and a toast "Report ready: <verdict>" with an "Open report" button SHALL appear (same placement rules as the your-turn toast).
2. "Open report" SHALL open a Report viewer: wide panel, verdict badge at the top (PASS green, FAIL red), sections from the report as headings, the diff with green/red lines, and the test summary.
3. THE mailbox SHALL list reports newest first, each with verdict badge, task title and time; unread reports SHALL be marked until opened.
4. A test SHALL cover: report.ready → toast shown, mailbox unread count, viewer renders verdict and diff without raw HTML.

### Requirement 6: Readability and contrast fixes

#### Acceptance Criteria
1. THE repository select and every form control SHALL use the theme colours (no native white/blue popup): use a styled custom dropdown, or `color-scheme: dark` plus themed `option` colours where supported.
2. Every text/background pair in the UI SHALL meet WCAG AA contrast (4.5:1 for text, 3:1 for icons and borders); a unit test SHALL check the palette pairs used by `theme.ts`.
3. Buttons SHALL keep readable label colours in hover, focus, pressed and disabled states.
4. When only one repository is allowed, the computer panel SHALL say so ("Allowed repositories: 1 (haunted-todo)") instead of showing a one-item dropdown as if more existed.

### Requirement 7: WebSocket Origin check (security audit M3)

#### Acceptance Criteria
1. THE world-server SHALL accept WebSocket upgrades only from Origins in an allowlist (`WORLD_ALLOWED_ORIGINS`, default `http://localhost:5173,http://127.0.0.1:5173` plus the served client origin) and reject others with HTTP 403.
2. Requests without an Origin header (non-browser clients such as tests and scripts) SHALL be accepted only when the server binds to loopback.
3. Tests SHALL cover allowed, rejected and missing Origin.
