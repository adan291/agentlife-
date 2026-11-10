# Requirements Document

## Introduction

Feedback from the user after live runs 1 and 2: it is hard to notice that the mailbox needs attention, text is hard to read, and there is no way to see what the agents are doing or who is working right now. room-ux adds a team bar, a job progress stepper, a live activity terminal, a clear "your turn" call to action for approvals, and readability fixes.

The activity terminal shows real agent progress. The kiro-cli runtime already produces `progress` events (tool calls such as reading or editing a file); today they only reach the run log on disk. This spec carries them to the room as a new agent event type.

Context: world-room, room-hints, build-crew, agent-engine and agent-pipeline specs. Boundaries (tech.md) and secrets rules (security.md) apply: the client only talks to the world-server; activity text must never contain absolute paths, secrets or environment values. All user-facing text in English.

## Requirements

### Requirement 1: Team bar ("who is working")

**User Story:** As a user, I want to see every agent's status at a glance, so that I know who is working without hunting for them in the room.

#### Acceptance Criteria
1. THE client SHALL show a team bar (left edge, vertical, collapsible) with one row per agent (Architect, Developer, QA, Builder): coloured ghost icon, role name, model, current state, last activity text and elapsed time in the current state.
2. THE row of an agent in `working` or `thinking` SHALL be highlighted and its icon SHALL animate; `waiting_approval`, `error` and `done` SHALL have distinct colours.
3. WHEN the user clicks a row, THE camera SHALL pan to that agent and its tooltip SHALL show for 2 s.
4. THE team bar SHALL update within one frame of the corresponding agent event.

### Requirement 2: Job progress stepper

**User Story:** As a user, I want to see where the current job is, so that I know what happens next and whether it waits for me.

#### Acceptance Criteria
1. WHILE a job exists, THE client SHALL show a horizontal stepper at the top centre: Plan → Approve → Build → Test → Review → Report, mapped from the job state.
2. THE current step SHALL be highlighted with the responsible agent's colour; completed steps SHALL show a check and their duration; a failed step SHALL be red.
3. THE "Approve" step, when current, SHALL read "Your turn" and be clickable: clicking opens the mailbox panel.

### Requirement 3: Your-turn call to action

**User Story:** As a user, I want to be told clearly when a plan waits for me, so that a job never stalls.

#### Acceptance Criteria
1. WHEN an approval becomes pending, THE client SHALL show a toast at the top ("The Architect's plan is ready. Review it in the mailbox.") with an "Open mailbox" button that opens the panel directly, from anywhere in the room.
2. THE toast SHALL stay until the approval is resolved or the mailbox is opened, and SHALL reappear if the mailbox is closed while the approval is still pending.
3. THE browser tab title SHALL show "(1) AGENT LIFE" while an approval is pending.
4. Opening the mailbox from the toast SHALL not require walking to it (the avatar may still walk there in the background).

### Requirement 4: Activity terminal

**User Story:** As a user, I want a live log of what the agents are doing, so that I can follow the real work.

#### Acceptance Criteria
1. THE engine SHALL turn runtime `progress` events into a new agent event `agent.activity { agentId, text }` (schema in `@agentlife/shared`), with text sanitised by the same rules as build-crew (no absolute paths, no `ksk_`, no `NAME=value`, max 80 chars) and at most one event per agent per second.
2. Job state changes, approvals, test results (pass/fail and counts when parseable from the test log) and Builder crew activity SHALL also appear in the terminal.
3. THE client SHALL show a docked terminal at the bottom (collapsible, resizable height, default 6 lines visible) with lines `HH:MM:SS  Role  text`, the role in its colour, newest at the bottom, auto-scroll unless the user scrolled up.
4. THE terminal SHALL keep the last 300 lines and offer a filter by agent.
5. THE world-server SHALL include the last 50 activity lines in the `welcome` snapshot so a reload does not start empty.

### Requirement 5: Readability

**User Story:** As a user, I want text I can read comfortably, so that panels, reports and tooltips are not a strain.

#### Acceptance Criteria
1. Base UI font size SHALL be 14 px (panels, terminal, tooltips) with line height ≥ 1.4 and contrast ratio ≥ 4.5:1 against panel backgrounds.
2. Panels SHALL be wider (max 720 px, 90 vw on small screens) and scroll internally.
3. THE report SHALL render diffs with added lines green and removed lines red, monospace, horizontal scroll for long lines.
4. A "A−/A+" control in the HUD SHALL scale UI text between 12 and 18 px, persisted in localStorage.
5. Name tags and status badges in the room SHALL stay legible at zoom 1× (minimum 11 px, dark outline).

### Requirement 6: Tests

#### Acceptance Criteria
1. Engine: progress → `agent.activity` mapping, sanitisation (property test reusing the build-crew rules), 1 per second throttle.
2. Client: stepper mapping from every job state, toast show/hide rules, terminal ring buffer (300) and auto-scroll rule, team bar state colours.
3. World-server: `welcome` carries at most 50 activity lines, newest last.
