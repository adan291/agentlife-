# Requirements Document

## Introduction

build-crew shows the Kiro sessions that build AGENT LIFE inside AGENT LIFE. While `pnpm session <id>` runs, a fourth resident, the **Builder** (a ghost, the hotel's night-shift engineer), works at its own desk in the office: it shows what the session is doing (reading, editing, running a command, committing) as status badges and short speech bubbles, and announces when the session starts and ends.

This is a visual mirror only. It never controls a session, never blocks it, and costs no Kiro credits: the data comes from the `stream-json` output the session runner already receives.

Context: scripts/run-session.ts, docs/spikes/kiro-cli.md (stream-json shape), agent-engine spec (event log, SSE), world-room spec (sim, avatars). Boundaries in .kiro/steering/tech.md still apply: the runner talks to the agent-engine, the engine emits agent events, the world-server turns them into visible actions.

## Glossary
- **Builder**: the avatar with agent id `builder`.
- **Crew event**: a small message from the session runner to the engine describing session progress.
- **Activity**: one of `think`, `read`, `edit`, `run`, `commit`, derived from a `tool_call` record.

## Requirements

### Requirement 1: Builder in the room

**User Story:** As the user, I want a Builder resident in the office, so that I can watch the sessions that build the project.

#### Acceptance Criteria
1. THE agent id schema SHALL include `builder`, and the room SHALL define anchors `home_builder` and a builder desk; `resolveAnchor(room, "desk", "builder")` SHALL resolve to it.
2. THE office room SHALL contain a builder desk with a walkable use tile; the room still validates.
3. THE client SHALL draw the Builder as a floating ghost (procedural, palette colours, no Habbo or Kiro brand assets), distinct from the three job agents, with the same name tag, status badge and bubble overlays.
4. WHEN no build session is running, THE Builder SHALL be `idle` at `home_builder`.

### Requirement 1b: Ghost staff theme

**User Story:** As a judge, I want the hotel staff to be ghosts, so that the room is clearly Kiroween and each role is easy to tell apart.

#### Acceptance Criteria
1. ALL agent residents (Architect, Developer, QA, Builder) SHALL be drawn as floating ghosts with one shared original ghost shape (rounded head, wavy hem, two eyes) and a distinct body colour per role from the palette; the user's avatar stays a human guest.
2. Ghosts SHALL float with a 2–3 px bob instead of a walk cycle, keep the 8 logical directions (mirrored as today), and keep name tags, status badges and bubbles unchanged.
3. THE ghost design SHALL be our own procedural drawing. It SHALL NOT trace or reproduce the Kiro logo or any other brand mark (see .kiro/steering/security.md).

### Requirement 2: Crew events API

**User Story:** As the session runner, I want to report session progress to the engine, so that the world can show it.

#### Acceptance Criteria
1. THE engine SHALL expose `POST /crew/events` with body validated by `CrewEventSchema` in `@agentlife/shared`: `{ kind: "started" | "activity" | "finished", session: string (≤ 8 chars, e.g. "S9"), spec?: string, model?: string, activity?: Activity, text?: string (≤ 80 chars), ok?: boolean }`.
2. THE route SHALL follow the same binding and token rules as the other engine routes.
3. THE engine SHALL translate crew events into existing agent event types for agent `builder` only (`agent.goto`, `agent.state_changed`, `agent.say`), appended to the event log with `taskId` `build:<session>`. It SHALL NOT emit `task.*`, `approval.*` or `report.*` events for crew events.
4. Mapping: `started` → goto `desk`, state `working`, say "<session> <spec> (<model>)"; `activity` → state `thinking` for `think`, `working` otherwise, say the text; `finished` → say "done" or "failed", state `done` or `error`, then goto `home` and state `idle`.
5. THE engine SHALL emit at most one `agent.say` for the Builder every 3 seconds; extra activity updates within the window only update the state.
6. Crew events SHALL NOT change the single-active-job rule: a job can start while a build session is shown, and vice versa.

### Requirement 3: Runner reporting

**User Story:** As the user, I want the runner to report automatically, so that I do not have to do anything to watch a session.

#### Acceptance Criteria
1. scripts/run-session.ts SHALL map stream-json lines to crew events with a pure function `crewEventFromLine(line)` in `scripts/crew-map.ts`: `tool_call` records become `activity` with a short text built from `kind`, `title` and the first `locations` path (file name only, no directories); `git commit` commands become `commit` with the first 60 characters of the message; `agent_thought_chunk` becomes `think` with no text.
2. Text sent SHALL contain no absolute paths, no environment values and nothing matching `ksk_` or the patterns already redacted by the engine logger.
3. THE runner SHALL send `started` before spawning kiro-cli and `finished` after `pnpm check`, to `ENGINE_URL` (default `http://127.0.0.1:8788`) with `ENGINE_TOKEN` when set.
4. Reporting SHALL be best effort: each POST has a 1 s timeout, failures are ignored after one warning line, and a missing engine never delays or fails a session.
5. `AGENTLIFE_CREW=0` SHALL disable reporting.

### Requirement 4: Tests

#### Acceptance Criteria
1. Unit tests for `crewEventFromLine` with sample stream-json lines (committed fixture with no real paths or secrets), including a property test that output text never exceeds 80 chars and never contains a path separator followed by a drive letter or `ksk_`.
2. Engine route tests: validation errors → 400, mapping per Requirement 2.4, say throttling per 2.5, no `task.*` events emitted.
3. A world-server or sim test: Builder events move the Builder to its desk and back home.
