# Design Document: job-insight

## Data

- `shared/src/events.ts`: `agent.work` event (requirement 1.1). `shared/src/protocol.ts`: server message `work { agentId, work }`, included in `welcome.agents[*].work` so a reload keeps it.
- Engine `steps/deps.ts` `runRole`: keeps a per-step `WorkTracker` (`title`, `step`, `model`, `contextPct`, `filesRead` set, `filesEdited` set). Fed by runtime events:
  - `progress` from tool calls: the kiro-cli runtime passes `kind` (`read` / `edit`) and the file basename in a new optional field `RuntimeEvent.tool?: { kind, file }` so counting does not parse text.
  - new `RuntimeEvent { kind: "context", pct }` from `session_info_update`.
  - Emits `agent.work` on change, throttled 1/s, and once at step end.
- Job step records gain `model`, `contextPeak`, `filesRead`, `filesEdited`; exported and shown in the report "Run facts".
- Terminal tag: `agent.activity` gains optional `taskId` already present on all events; the client derives `#` + first 4 hex chars after `task-`, plus `step` from the latest `agent.work`.

## Client

- `ui/team-bar.ts`: second block per row (task title, step, elapsed, context meter as a 40 px bar, file counts).
- `ui/job-panel.ts`: Job panel (requirement 2), opened from the board and the stepper; artifacts fetched through the existing world-server panel data path (add `job_details` request/response; world-server proxies `GET /tasks/:id` and artifact contents from the engine, size-capped at 200 KB each).
- `ui/report-viewer.ts`: Report viewer (requirement 5.2) reusing `markdown.ts` (diff colouring already exists).
- `ui/toast.ts`: generalise to a queue with kinds `your-turn` and `report`.
- `ui/stepper.ts`: CSS grid with `minmax(0, 1fr)` columns, `overflow: hidden`, label → icon below a width threshold measured with ResizeObserver; durations as a second line.
- `scene/working-fx.ts`: procedural effects per state (thought cloud with three dots, candle with flame flicker, envelope, exclamation, sparkle), attached to `avatar-view.ts`; monitor glow on the agent's desk via `furni-view.ts`.
- `ui/select.ts`: small custom dropdown (button + listbox, keyboard accessible) used by the computer panel; replaced by a static line when there is one repository.
- `ui/theme.ts`: contrast test over the declared pairs.

## World-server

- `gateway.ts`: `verifyClient` with the Origin allowlist (requirement 7); keep loopback-only acceptance of missing Origin.

## Testing

Unit tests per requirement 1.2, 3.2, 4.4 (reduced motion path), 5.4, 6.2, 7.3; engine test that `agent.work` counts files and context from a scripted runtime; Playwright stepper overflow check (3.3) added to the existing e2e.
