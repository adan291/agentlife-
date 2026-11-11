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

## Decisions made while implementing

- **`agent.work` carries `startedAt`** (epoch ms of the step start) so the client shows the elapsed time and a reload keeps it. The step records also get `model`, `contextPeak`, `filesRead`, `filesEdited` by folding `agent.work` (`jobs/fold.ts`); the report "Run facts" shows them.
- **Context percentage** comes from `update._meta.kiro.contextUsage.usagePercentage` (shape seen in real run logs); `contextUsagePercentage` (older fixture shape) is accepted too.
- **File counts** use unique paths relative to the cwd (`RuntimeEvent.progress.tool.file`), not basenames, so two files with the same name count twice. A path outside the cwd counts as `(outside)`.
- **Work tracker** lives in `work.ts` and is used by `runRole` and by the fake runtime steps. `test` and `report` have no model call, so the runner announces them itself (no model, zero counts). The title reaches the steps as `StepContext.title`.
- **Terminal tags**: the design said "step from the latest `agent.work`"; the first line of a step is written before its `agent.work`, so the gateway tags each activity line with the step of the job's latest state change instead (`ActivityLine.taskId` and `step`). Builder lines have no tag.
- **`job_details`**: one message with the job and the artifact contents (each cut at 200 000 characters, flagged `truncated`). `jobDetailsFromExport` (shared) builds it from the engine export, also for the recorded demo. The export adds `job.branch` (`agentlife/<taskId>`) once a develop step ran.
- **Work block visibility** (client): shown while the agent is working, thinking, walking, blocked or in error; hidden when idle, done or waiting. The gateway keeps the latest work per agent for `welcome` and forgets it when the job ends; the client also drops it when the agent goes idle.
- **Reports**: `Report` gets `verdict` and `ts` (gateway reads the `verdict:` reason of the `report_ready` transition) and a `report` message re-sent when the mailbox opens carries `resend: true`, so only a first delivery raises the toast, the Architect bubble and the mailbox glow. A report is unread until opened in the viewer.
- **Stepper**: six grid columns, `overflow: hidden`, labels or icons by `stepperFitsLabels(width, font)` (width of the top bar slot, capped at 760 px). Every step is a button: Approve while waiting opens the mailbox, the others open the job card.
- **Contrast**: new token `controlBorder` (3:1) for buttons and inputs; dividers keep `border`. `CONTRAST_PAIRS` in `theme.ts` lists the pairs the unit test checks. Status badge glyphs are dark on bright discs (`glyphColourOn`). The disabled button no longer uses opacity.
- **Origin check**: `WORLD_ALLOWED_ORIGINS` replaces the default list (`http://localhost:5173`, `http://127.0.0.1:5173`). If Vite picks another port, add that origin. The Playwright config sets its own.
- **Tests**: no DOM library; `client/test/fake-dom.ts` is a small stand-in, and the layout checks are Playwright specs (`e2e/job-insight.spec.ts`, proxying the world-server WebSocket to inject states).
