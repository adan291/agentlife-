# Design Document: room-ux

## Data path for activity

```mermaid
flowchart LR
  K["KiroCliRuntime<br/>progress events"] --> S["steps/deps.ts runRole<br/>(already loops events)"]
  S -- "agent.activity (throttled, sanitised)" --> L["event log + SSE"]
  C["crew relay (Builder)"] -- "agent.activity" --> L
  L --> W["world-server<br/>ring buffer 50 + forward"]
  W -- "activity msg / welcome.activity" --> T["client terminal + team bar"]
```

- `shared/src/events.ts`: add `agent.activity { agentId, text }`.
- `shared/src/sanitize.ts`: move `sanitize` from `scripts/crew-map.ts` into shared so engine, runner and tests use one implementation; `scripts/crew-map.ts` re-exports it.
- `steps/deps.ts` `runRole`: on `ev.kind === "progress"`, emit `agent.activity` for the role through the store's `appendEvent`, throttled per agent (1/s, drop extras), text `sanitize(ev.text)`.
- Crew relay: activity crew events also emit `agent.activity` for `builder` (in addition to the throttled `agent.say`).
- JobRunner: emit `agent.activity` lines for state changes ("Plan ready: 3 tasks"), approval resolved ("Approved task 1"), test result ("Tests passed 11/11" parsed from Vitest's `Tests  N passed` line when present, else exit code).
- Protocol: server message `activity { line: { ts, agentId, text } }`; `welcome.activity?: ActivityLine[]` (max 50).
- World-server gateway: ring buffer of 50 lines fed by `agent.activity` events; forward each as `activity`.

## Client components (plain DOM + CSS, palette colours)

- `ui/team-bar.ts`: rows from agent state (existing `agent_state` messages) + models (`welcome.models`) + last activity; elapsed timer updated once per second; click → `worldView.focusAgent(id)` (pan camera, show tooltip 2 s).
- `ui/stepper.ts`: pure `stepperFor(jobView)` → steps with status; renders at top centre; "Your turn" step opens the mailbox.
- `ui/toast.ts`: your-turn toast driven by `mailbox-state.ts` (pending count); updates `document.title`.
- `ui/terminal.ts`: ring buffer 300, filter by agent, auto-scroll unless scrolled up, collapse/resize handle; seeded from `welcome.activity`.
- `ui/theme.ts`: CSS custom properties for font size (`--al-font`), A−/A+ control in `hud.ts`, persisted.
- Report diff colouring in `ui/markdown.ts`: fenced blocks tagged `diff` get per-line classes `+`/`-` (built with DOM nodes, never `innerHTML`).
- Room labels: name tags and badges use `--al-font`-independent canvas text at ≥ 11 px with a 2 px dark stroke.

Layout: team bar left (220 px, collapsible to icons), terminal bottom (resizable), stepper and toast top centre, HUD top right. Panels open centred above the terminal.

## Testing strategy

See requirement 6. Manual check: run a real job and confirm the toast, stepper, team bar and terminal all move together.

## Decisions made while implementing

- **Activity emitter** (`agent-engine/src/activity.ts`): one `ActivityEmitter` per engine with `progress` (throttled 1/s per agent, extras dropped) and `line` (milestones, not throttled). `runRole` and the fake `createRuntimeSteps` use `progress`; `JobRunner` uses `line`. The crew relay builds its own emitter so Builder lines follow the same 1/s rule. Events are optional in tests: without an emitter nothing is emitted. `agent.activity` text is at most 80 chars (`ACTIVITY_TEXT_MAX`).
- **Test line**: `Tests passed 11/11` counts passed + failed from the Vitest `Tests` line; skipped tests are not counted. Without a summary: `Tests passed` or `Tests failed (exit N)`.
- **Welcome snapshot**: `welcome.activity` is left out while the buffer is empty. The world-server also sends `job_update` right after `welcome` when a job exists, so the stepper survives a reload. The client hides the stepper on `welcome` and the server then refills it.
- **Your-turn toast replaces the HUD line** "Plan waiting for your approval" (same trigger, same place). `Hud.setNotice` stays in the API but `main.ts` no longer calls it.
- **Opening the mailbox from the toast or the stepper is local** (`Panels.open`): the client already holds the approvals and reports, so the avatar does not walk. A server `open_panel` after a click on the real mailbox still works as before.
- **Stepper reads failure from the timeline**: the engine ends a failed job as `failed -> report_ready -> delivered`, so a `failed` entry in the timeline marks the step before it red and the later steps stay pending. A cancelled job marks the step it was in red (note "Plan rejected" or "Cancelled").
- **Team bar colours**: the state colour is a dot before the state text and the row's left border. Text itself stays in the readable UI colours, because some state colours (idle, error) are below 4.5:1 on the panel background. Contrast of all UI colours is checked in `readability.test.ts`.
- **Camera focus**: `WorldView.focusAgent` pans to the agent (eased, instant with reduced motion), pins the tooltip for 2 s and returns to the room centre after 3 s. `HoverSink` gained `pin`.
- **Layout variables**: the terminal publishes its height as `--al-terminal-h`; panels, team bar and the transient HUD toast stay clear of it. Panels are centred (`min(720px, 90vw)`).
- **Not looked at in a browser** (no browser in the unattended run): terminal resize and collapse, team bar animation, camera pan, toast placement. See STATUS.md.
