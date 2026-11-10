# Design Document: room-hints

## Client

- `ui/tooltip.ts`: one DOM element (`.al-tooltip`), `show(x, y, title, lines[])`, `hide()`; positioned with clamping to the viewport; 300 ms dwell timer. Plain DOM + CSS in the existing panel style (palette colours, monospace).
- `scene/world-view.ts` already resolves the hovered item in `onPointerMove` and sets the cursor. Extend it to resolve the hovered avatar too (agent sprites are in the depth-sorted layer; reuse the hit test used for clicks) and to drive the tooltip. Hide on `pointertap`, `pointerleave` and when `panels` opens one.
- Glow: `scene/furni-view.ts` adds, for items whose def has an `interaction`, a sprite copy tinted with the accent colour and drawn behind the item with an alpha pulse (sin over time, period about 2 s). Respect `matchMedia("(prefers-reduced-motion: reduce)")`.
- Mailbox badge: `scene/overlay.ts` draws a small circle with the count above the mailbox, fed by the existing approvals and reports state in the client; `hud.ts` adds the waiting line.
- How-it-works card: `ui/guide.ts`; flag `agentlife-guide-seen` in localStorage; "?" button in the HUD top bar.

## Shared

- `FurniDefSchema` gains optional `hint: z.string().max(80)`; catalog entries for computer, mailbox and board get the texts from requirement 1.1.
- Role descriptions (requirement 3.1) live in `shared/src/roles.ts` (`ROLE_INFO: Record<AgentId, { name, does }>`), used by the client tooltip.
- Models per role: add optional `models?: Partial<Record<AgentId, string>>` to the `welcome` message. The world-server fills it from a new engine route `GET /config/roles` (returns `{ architect: { model }, developer: …, qa: … }` from config/agents.json, no secrets) when `ENGINE=http`; the fake engine returns fixed labels "fake".

## Engine

- Step durations: in `jobs/runner.ts`, the step wrapper already measures `Date.now() - started` for the log. Record the end time in the step record the report and export read (`rec.endedAt`), in the `finally` path, for ok, failed and cancelled outcomes.

## Testing strategy

- Unit: tooltip clamping, guide flag, badge counts from approval/report state, `ROLE_INFO` covers every `AgentId`, catalog: every def with `interaction` has a `hint`.
- Engine: durations test (requirement 6.2); `/config/roles` returns only `model` and `runtime`.
- Manual: hover each item and ghost, see glow, badge appears on a pending plan, guide on first load.

## Decisions made while implementing

- Step durations: `StepRecord` gained `durationMs`, set by the fold when a step ends (`endedAt - startedAt`); `endedAt` already existed. Per-step facts for the report read it. The step that builds the report is still running while the report is built, so its own line has no duration.
- Models: the gateway caches `GET /config/roles` (via `EngineLink.roleModels?`) and puts it in `welcome.models`; it refreshes at start and on each connection, so the first client after a late engine start sees models only after a reload. With `RUNTIME=fake` the engine reports `fake` for runtime and model.
- Pending badge: the gateway now also sends the pending approvals right after `welcome`, so a reload keeps the badge and the HUD line. `MailboxState` (client) drops pending approvals when their job ends or another job starts.
- Agent hover uses the avatar sprite bounds (not a pixel-exact hit test). Glow is four accent-tinted copies of the sprite offset by 2 px behind the item.
- The guide flag is `agentlife-guide-seen`; the card also closes with the "Got it" button.
