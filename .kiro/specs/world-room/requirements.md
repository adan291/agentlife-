# Requirements Document

## Introduction

The world-room feature delivers the visible world of AGENT LIFE: one isometric office room, a controllable user avatar, three agent avatars (Architect, Developer, QA) and three interactive furniture items (computer, mailbox, board). Agents are driven by agent events; until the real agent-engine exists, a scripted fake engine produces them. The room has a Kiroween (night, haunted hotel) look.

Context: docs/architecture-proposal.md, docs/mvp-roadmap.md. Out of scope: multiple rooms, multiplayer, furniture placement/editing, avatar customisation.

## Glossary
- **Tile**: one cell of the room grid, addressed by integer (x, y).
- **Anchor**: a named, semantic location in the room (`desk`, `board`, `computer`, `mailbox`, `door`, plus one `home` per agent) that resolves to a tile and a facing direction.
- **Agent event**: a message from the agent-engine (`agent.goto`, `agent.state_changed`, `agent.say`, …) defined in `@agentlife/shared`.
- **World simulation**: the pure logic that turns room definition + user intents + agent events into world state changes. It must run both in the world-server and in the browser (replay mode).

## Requirements

### Requirement 1: Room definition

**User Story:** As a developer, I want the room described in a data file, so that the layout can change without code changes.

#### Acceptance Criteria
1. THE SYSTEM SHALL load the room from a JSON file validated by a zod `RoomDefSchema` in `@agentlife/shared`.
2. THE room definition SHALL include a heightmap (rows of characters, `x` = no floor, `0`–`9` = floor height), a door tile, a list of anchors, and a list of placed furniture items.
3. IF the room file fails validation, THEN THE world-server SHALL refuse to start and print which field is invalid.
4. IF an anchor or furniture footprint lies outside the floor, THEN validation SHALL fail.

### Requirement 2: Isometric rendering

**User Story:** As a user, I want to see the room in classic isometric view, so that it reads like an early-2000s hotel.

#### Acceptance Criteria
1. THE client SHALL render floor tiles with a 2:1 isometric projection (tile 64×32 px at zoom 1) and two back walls.
2. THE client SHALL draw furniture and avatars in correct front-to-back order, including multi-tile furniture.
3. WHEN the user hovers a floor tile, THE client SHALL highlight it.
4. THE projection and its inverse SHALL round-trip: for every tile, `screenToTile(tileToScreen(t)) = t` (property-based test).
5. THE client SHALL support zoom 1× and 2× with nearest-neighbour sampling.

### Requirement 3: User avatar movement

**User Story:** As a user, I want to click a tile and walk there, so that I can move around the room.

#### Acceptance Criteria
1. WHEN the user clicks a walkable tile, THE client SHALL send a `move` intent and THE world-server SHALL compute a path and broadcast it.
2. THE path SHALL avoid tiles with no floor and tiles blocked by non-walkable furniture, and SHALL allow diagonal steps only when both adjacent orthogonal tiles are walkable.
3. IF no path exists, THEN THE world-server SHALL reply with an error code `no_path` and the avatar SHALL not move.
4. THE client SHALL animate the avatar along the path at the server-given speed and face the direction of travel (8 logical directions; 5 drawn, 3 mirrored).
5. Path properties SHALL be property-tested: every step is between adjacent walkable tiles, the path ends at the target, and no path is returned when the target is unreachable.

### Requirement 4: Furniture

**User Story:** As a user, I want furniture that I can use, so that the room is the interface to the agents.

#### Acceptance Criteria
1. THE system SHALL define a furniture catalog in `@agentlife/shared` with id, name, footprint (w × l), height, walkable flag and optional `interaction` (`computer`, `mailbox`, `board`).
2. WHEN the user clicks an interactive item, THE user avatar SHALL walk to the item's use tile and THEN THE client SHALL open the item's panel.
3. THE room SHALL contain at least: one computer desk, one mailbox, one board, three agent desks, and decorative items (plants, lamps, a sofa).
4. Furniture without an `interaction` SHALL do nothing when clicked except walk the user next to it.

### Requirement 5: Agent avatars

**User Story:** As a user, I want to see what each agent is doing, so that I can follow the work visually.

#### Acceptance Criteria
1. THE room SHALL show three agent avatars, each with a name tag, a role colour, and a status badge above the head.
2. WHEN an `agent.goto` event with an anchor arrives, THE world simulation SHALL path the agent to the anchor tile and face the anchor direction.
3. WHEN an `agent.state_changed` event arrives, THE client SHALL update the status badge (icon + short text) within one frame of receiving it.
4. WHEN an `agent.say` event arrives, THE client SHALL show a speech bubble for 4–8 seconds depending on text length.
5. THE agent avatar states SHALL be: `idle`, `walking`, `thinking`, `working`, `waiting_approval`, `blocked`, `done`, `error`, each with a distinct icon.

### Requirement 6: Protocol

**User Story:** As a developer, I want a typed protocol, so that client and server cannot silently disagree.

#### Acceptance Criteria
1. ALL client↔world-server messages SHALL be defined as zod discriminated unions in `@agentlife/shared` and validated on receipt by both sides.
2. WHEN a client connects, THE world-server SHALL send a `welcome` message with the protocol version and the full room snapshot (room def, avatars, agent states).
3. IF a message fails validation, THEN THE receiver SHALL drop it and THE world-server SHALL reply with `error` code `bad_message`.
4. THE world-server SHALL reject messages larger than 16 KB and more than 20 messages per second per connection.

### Requirement 7: Fake engine for development

**User Story:** As a developer, I want a scripted engine, so that the world can be built before the real agent-engine exists.

#### Acceptance Criteria
1. THE world-server SHALL depend on an `EngineLink` interface, with a `FakeEngineLink` implementation selected by `ENGINE=fake` (the default in this spec).
2. WHEN the user starts a job from the computer panel, THE fake engine SHALL play a scripted scenario that walks all three agents through a full job (analyse, wait for approval, develop, test, review, report) using the same agent event types as the real engine.
3. THE fake scenario SHALL wait for the user's approval in the mailbox before continuing.

### Requirement 8: Panels

**User Story:** As a user, I want panels for the computer, mailbox and board, so that I can start jobs, approve, and read results.

#### Acceptance Criteria
1. THE computer panel SHALL list allowlisted repositories (from the engine link), take a goal text (max 300 chars), and start a job.
2. THE mailbox panel SHALL list pending approvals with Approve / Reject buttons and delivered reports, rendering report Markdown as safe HTML (no raw HTML from the report).
3. THE board panel SHALL show the current job's timeline (state changes with timestamps).
4. Panels SHALL be plain DOM + CSS, closable with Esc or a close button, and SHALL not block the canvas when closed.

### Requirement 9: Kiroween look

**User Story:** As a judge, I want the hotel to feel haunted, so that the project fits the Kiroween theme.

#### Acceptance Criteria
1. ALL colours SHALL come from one palette module (night palette: deep purples, teal, pumpkin orange accents).
2. THE room SHALL include at least two spooky decorative items (e.g. jack-o'-lantern lamp, cobweb wall item) drawn procedurally.
3. No graphic, name or sound SHALL derive from Habbo (see .kiro/steering/security.md).
