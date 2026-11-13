# Requirements Document

## Introduction

The agent hotel gets floors. A lobby holds the Reception, the elevator and the HR office door; every registered project gets its own floor (an office generated from a template) with its own computer, mailbox, board and team. The user walks through the lobby, takes the elevator and works with each project's team on its floor, like rooms in an early-2000s social hotel.

Depends on project-registry (projects, Reception). All user-facing text in English.

## Requirements

### Requirement 1: Rooms

#### Acceptance Criteria
1. THE world SHALL hold several rooms: `lobby`, `hr` and one `project:<id>` room per registered project; room definitions are validated with `RoomDefSchema` as today.
2. Project rooms SHALL be generated from a template (`rooms/project-template.json`, today's office layout) with the project name on a plaque over the elevator (the floor's door); a new project gets its room as soon as it is registered, and a removed project's room disappears (users inside are moved to the lobby).
3. THE lobby SHALL contain the Reception desk (moved from the office), the elevator, a door to the HR office, a directory board listing floors, and Kiroween decor.
4. THE `WorldSim` SHALL be per room; avatars and agents belong to exactly one room at a time; messages are scoped to the user's current room.

### Requirement 2: Elevator

**User Story:** As the user, I want to take the elevator to a project's floor, so that I move between projects like in a hotel.

#### Acceptance Criteria
1. Using the elevator SHALL open a floor panel listing the lobby, the HR office and every project floor with its live status: idle, working (who), waiting for your approval, report ready, failed.
2. Choosing a floor SHALL play a short transition (doors close, floor indicator, doors open) and place the user at the elevator of the target room.
3. A floor that waits for approval or has an unread report SHALL be highlighted in the panel, and the lobby directory board SHALL show the same status.
4. Agents SHALL not use the elevator; each team stays on its floor.

### Requirement 3: Per-project jobs and teams on floors

#### Acceptance Criteria
1. Each project floor SHALL show that project's team (default: Architect, Developer, QA) and its own job state; jobs on different projects SHALL run independently, with at most two jobs running at once in the whole hotel (others wait in a visible queue).
2. Agent ids SHALL be scoped per project (`<projectId>:architect`); events, the team bar, the terminal and the stepper SHALL show only the current floor, and the terminal SHALL offer "This floor / All floors".
3. THE Builder ghost SHALL live in the lobby.

### Requirement 4: Navigation and state

#### Acceptance Criteria
1. THE HUD SHALL show the current floor name and an "Elevator" shortcut.
2. Reloading the page SHALL return the user to the floor they were on (sessionStorage, so a new visit starts in the lobby) if it still exists.
3. The demo (replay) build SHALL work with the recorded rooms: the recorded run includes the room ids, and the replay shows the floors that were recorded.

### Requirement 5: Tests

#### Acceptance Criteria
1. Room generation from the template for random project names (valid room, sign text sanitised, use tiles walkable).
2. Scoping: an event for project A never reaches a client on project B's floor; the two-job limit and the queue order.
3. Elevator flow from the lobby to a project floor and back in a world-server test.
