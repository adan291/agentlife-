# Status

Updated: 2026-11-11 (ui-shell tasks 1–5 done)

## Phase
Phase 0 done. world-room merged into main (S1, S3, S4, S5; tasks 1–12 done, browser check passed). Reviewed with agentlife-reviewer (docs/reviews/feat-world-room.md); its two blockers were fixed. agent-engine merged into main (S6, S7; 10/10). Review docs/reviews/feat-agent-engine.md: blocker fixed (ENGINE_HOST, refuses a non-loopback host without ENGINE_TOKEN). Two-process e2e verified: engine (RUNTIME=fake) + world-server ENGINE=http, a scripted WebSocket client went start_job -> approve -> report. `pnpm check` passes (226 tests). Next: agent-pipeline, once the S2 security finding is resolved. S2 (kiro-cli spike) is blocked on a security finding, see below.

## Run the client
Two terminals from the repo root (the client needs the world-server on 127.0.0.1:8787):
- `pnpm --filter @agentlife/world-server start`
- `pnpm --filter @agentlife/client dev` then open http://localhost:5173/ (Z or the button toggles 1×/2×)

With the fake engine: `config/agents.json` now uses kiro-cli, so set `RUNTIME=fake` for the engine (PowerShell `$env:RUNTIME='fake'`); tests and CI get it from `packages/agent-engine/vitest.config.ts`. Without it the engine installs the role agents into `data/kiro-home` and runs the real pipeline (needs `KIRO_API_KEY` and the Docker image). Start the engine first, then the world-server with `ENGINE=http` (`ENGINE_URL` default http://127.0.0.1:8788, `ENGINE_TOKEN` optional on both):
- `pnpm --filter @agentlife/agent-engine start` (`FAKE_DELAY_MS`, default 800, sets the pace of the fake agents)
- PowerShell: `$env:ENGINE='http'; pnpm --filter @agentlife/world-server start`

## Last conversation with the user
Newest last. Kiro IDE and Kiro Crew (Discord) both append here, so either side can pick up the thread.
- 2026-11-11 morning (IDE): ui-shell reviewed and merged; services started; security scanner, publishing gate and agentlife-security agent created; first audit says history must be cleaned before the first push (decisions below). User went out.
- 2026-11-11 09:47 (Discord): user asked for a summary; Crew had no project context (its steering was not in the per-channel session folder). Fixed: steering copied to the Discord session folders and now tells Crew to read this section first.
- 2026-11-11 afternoon (IDE): user back. Waiting for: browser look at the new shell, live run 3, security decisions 1-3.

## Next (2026-11-11)
1. User looks at the new shell in the browser (collapse team bar, resize terminal, minimise/restore).
2. Live run 3 from the room (goal: "Validate todo titles in addTodo"), then agent-pipeline task 13: export it to packages/client/public/demo/run-001.json.
3. S11 (demo-replay 1–4), S12 (5–6 + polish, needs the GitHub repo), S13 (submission texts).
4. User decisions: see Security below.

Start-up for live runs: Docker Desktop, Ollama, then engine (KIRO_API_KEY from .env, LLM_BASE_URL/LLM_MODEL for ambient lines), world-server with ENGINE=http, client dev.

## Security (before the first push)
First audit: data/security/2026-11-11-first-push.md (local only). Verdict: NOT safe to publish yet; the current tree is clean, the problems are in git history.
Decisions for the user:
1. Rewrite history before the first push (author/committer email to a GitHub noreply address; replace the other account's email in commit 4e16788 and two fake key-shaped test literals). Recommended: yes. Backup branch first; push only main.
2. Set a repository-local noreply author email for new commits (user runs it).
3. Accept the `C:\Users\me` test fixtures in scripts/security-allow.json (low).
Tasks to schedule: Origin check on the world-server WebSocket (M3, before the freeze); `permissions: contents: read` in CI (L5); scan the demo export before committing it.
Gate: `pnpm security:scan` (free). Pushes are blocked by a Kiro hook and a git pre-push hook while it reports high or medium findings. Agent: agentlife-security (read-only, recommends).

## Specs
| Spec | Tasks done | Branch | Notes |
|---|---|---|---|
| world-room | 12 / 12 | main | Done. Browser check by the user on 2026-11-10: job, approval and report worked |
| agent-engine | 10 / 10 | main | Merged. Two-process e2e verified by script |
| agent-pipeline | 13 / 13 | main | Done. 3 live runs passed (~70-80 s each). Run 3 (task-d232d369, 'Validate todo titles in addTodo': analyze 32 s, develop 22 s, tests 6 s, review 19 s, PASS) exported to packages/client/public/demo/run-001.json, scanned clean |
| build-crew | 5 / 5 | main | Done. Seen by the user during S10D: Builder bubbles and terminal lines followed the session (git add, commits) |
| room-hints | 5 / 5 | main | Done and merged (tooltips, glow, mailbox badge, HUD line, guide, step durations). Browser look pending (user) |
| room-ux | 5 / 5 | main | Done and merged after review (blocker fixed: token formats in sanitize; activity redacted before storage, tested). Browser look pending (user) |
| room-fixes | 3 / 3 | main | Done and merged (commit c20d4e6). Its free-viewport code was removed by ui-shell. Browser look pending (user) |
| ui-shell | 5 / 5 | main | Done, reviewed (approve) and merged. Playwright smoke test 18/18 (Edge). Look in a real browser pending (user) |
| demo-replay | 0 / 7 | — | S11–S13 |

## Manual browser checks (world-room task 12, user to do)
Automated so far: a scripted WebSocket client against ENGINE=fake (use computer_desk_1 -> repos + open_panel computer -> start_job -> approval -> approve -> developing/testing/reviewing -> delivered + report in ~10 s) passed. Run both servers (see above) and check:
1. Click the computer desk: avatar walks there, Computer panel opens listing haunted-todo.
2. Empty goal + Start job does nothing; text over 300 chars is impossible to type; counter updates.
3. Start job: button shows "Job running...", Architect shows thinking/working bubbles and badges.
4. After ~6 s the plan approval arrives. Click the mailbox: panel lists the pending plan with Approve / Reject.
5. Approve: status changes to approved, Developer and QA states change, no errors in console.
6. Board: click it; timeline shows each state with a time. It updates live while open.
7. Mailbox after ~10 s: report renders as headings/lists, no raw HTML. Esc and the Close button both close any panel; the canvas stays clickable when closed.
8. Start a second job after the first ends, and a job with Reject (pending approvals of finished jobs must disappear from the mailbox).
9. Stop the world-server while the computer panel is open: banner reconnects; reopen computer shows an engine error, not a blank panel.
10. Typing in the goal box then pressing Z must not toggle zoom (already guarded); a server message arriving while typing re-renders the form and may drop focus (known, minor).

## Open problems / pending decisions
- ui-shell (merged to main, tasks 1–5 done, one commit each; `pnpm check` and `vite build` pass). What exists, in `packages/client/src/ui/shell.ts`: `shellTemplate(prefs, viewport)` (pure, tested) gives side width, dock height and the collapsed/compact modes; `createShell()` builds the grid (`.al-top` with slots `topLeft`/`topCentre`/`topRight`, `.al-side`, `.al-stage` with a `banners` column, `.al-dock`), sets `--side-w`/`--dock-h` and `data-side-collapsed|dock-collapsed|compact` on `.al-shell`. User choices (side, dock, dock body px) are stored under `agentlife-side-collapsed`, `agentlife-dock-collapsed`, `agentlife-dock-px`; with no choice the breakpoints decide (side <900 px wide, dock and compact stepper <640 px wide, dock <560 px high). A stored choice wins over the breakpoints. `main.ts` resizes the Pixi renderer from a ResizeObserver on the stage; `scene/viewport.ts` and the `--al-terminal-h` variable are gone. Components take their host: `createHud({left,right,banners,stage}, ...)` (controls order is now zoom, A−, A+, ?), `createStepper(cb, host)`, `createYourTurnToast(cb, host)`, `createGuide(storage, host)`, `createPanels(send, onChange, host)`, `createTooltip(host)` (positions are stage-relative, world-view passes `e.global`), `createTeamBar(onFocus, shell)`, `createTerminal(shell)` (no `refresh()` any more; `theme.onChange` calls `shell.refresh()`). Tokens and button states are in `ui/theme.ts` (`themeCss()`, `--al-s1..s5`, `--al-radius`, `--al-border`, `--al-shadow`, `--al-focus`); `test/theme-tokens.test.ts` fails if a component other than the shell uses `position: fixed` or a literal radius. Panels have header, scrollable body and footer; the Computer panel's Start job button is in the footer (`PanelContent` in `computer.ts`). The dock grip is focusable (arrow keys resize 24 px).
  - Playwright: `pnpm --filter @agentlife/client e2e` starts the world-server (fake engine, port 8795) and Vite (port 5199) itself. The Chromium download was not done in the unattended session; set `E2E_CHANNEL=msedge` (PowerShell `$env:E2E_CHANNEL='msedge'`) to use the installed Edge, or run `pnpm --filter @agentlife/client exec playwright install chromium` once. 18 tests passed with Edge at 1366×768, 800×600, 375×667 and 360×480. Screenshots at 1366 and 375 looked right (team bar and dock in their cells, room centred in the stage, guide inside the stage). Vitest now has `packages/client/vitest.config.ts` so it ignores `e2e/`.
  - Not looked at by the user: the your-turn toast under the top bar, the panels (header/body/footer) and the stepper in a real job; the compact stepper (<640 px); the collapsed side bar with state rings; the dock summary and "n new" badge while collapsed; browser zoom 50–200 %.
  - Known limits: below 360×480 the layout is not guaranteed; a remembered "expanded" side bar on a phone-sized window leaves little stage (the stored choice wins over the breakpoints).
  - Pending: merge to main.
- room-fixes (merged to main; the free-viewport/insets part was replaced by ui-shell, so the "room is centred in the area right of the team bar" check now means the stage; branch `feat/room-fixes`, tasks 1–3 done, nothing looked at in a browser). User to check: open a second tab (first shows "AGENT LIFE is open in another tab" + Use here, no reconnect loop; stopping the world-server still shows Reconnecting…); room is centred in the area right of the team bar and above the terminal and picks 2× when it fits (collapse the team bar, hide/resize the terminal, resize the window; the 1×/2× button or Z overrides; the HUD zoom label follows the automatic change); Builder row shows "Kiro build sessions" idle and "S9 · model" during `pnpm session`. Design notes: `scene/viewport.ts` holds the insets (team bar publishes left = 10 + width, terminal publishes its height) and `freeViewport`; `LiveTransport.reconnect()` and status `replaced`; Builder session/model is parsed from the `started` label text ("S9 spec (model)") in `TeamModel`. Task 2 and 3 share `team-bar.ts`, so its insets change is in the task 3 commit. Pending: merge to main.
- room-ux (branch `feat/room-ux`, tasks 1–5 done, `pnpm check` and `vite build` pass; decisions in the spec's design.md under "Decisions made while implementing"). Nothing was looked at in a browser. User to check with `RUNTIME=fake` engine or the world-server's fake engine (the fake engine now emits activity lines too):
  - Team bar (left): four rows with model, state, last activity, elapsed time; working/thinking rows highlighted with a bobbing icon; click a row: camera pans to the agent, tooltip for 2 s, camera returns after 3 s; collapse button.
  - Stepper (top centre): appears with the first job, steps Plan / Approve / Build / Test / Review / Report with durations; "Your turn" on Approve is a button that opens the mailbox without walking; failed or rejected jobs show a red step. Reload during a job: the stepper comes back (the world-server now sends `job_update` after `welcome`).
  - Toast under the stepper when a plan waits: "The Architect's plan is ready..." + Open mailbox; hides when the mailbox opens, returns if it is closed while pending; tab title "(1) AGENT LIFE". It replaces the old HUD line "Plan waiting for your approval".
  - Terminal (bottom): lines `HH:MM:SS  Role  text`, filter by agent, Hide/Show, drag the thin bar on top to resize, auto-scroll stops when you scroll up, reload keeps the last 50 lines. In a live run it shows Architect/Developer/QA tool calls (`Reading: src/...`), plan/approval/test lines and Builder lines during `pnpm session`.
  - Readability: A−/A+ in the HUD (12 to 18 px, remembered), wider centred panels, diff colouring in the report, name tags and badges at 11 px with a dark outline.
  - Not verified live: real kiro-cli `progress` text through the terminal (only unit tests with scripted runtimes). If the lines look noisy, tune `MAX_PROGRESS_CHARS`/mapping in `runtimes/kiro-cli.ts` `progressFor`.
  - Known gap: the Builder row has no model (welcome only carries role models).
  - Pending: merge to main.
- Live run 2/3, task-f29edbb9 on 2026-11-10: goal 'Add tests for the untested summarize function'; analyze 25 s, develop 19 s, tests 1.4 s (11 passed, 1 skipped), review 20 s; QA pass; delivered. Durations now recorded. User feedback: mailbox attention, readability, activity terminal and who-is-working are missing -> spec room-ux.
- room-hints (branch `feat/room-hints`, tasks 1–5 done, `pnpm check` and `vite build` pass; decisions in the spec's design.md): the client changes have not been looked at in a browser. User to check: hover computer/mailbox/board (tooltip after 300 ms, glow pulse, stronger on hover); hover each ghost (role line, state, model; model shows "fake" with RUNTIME=fake, real names otherwise, and only after a reload if the engine started after the world-server); mailbox badge with count while a plan waits, dot after a report until the mailbox is opened, HUD line "Plan waiting for your approval"; guide card on first load (clear localStorage `agentlife-guide-seen` to see it again), "?" button, Esc. Step durations: the engine now writes `durationMs` per step; confirm in live run 2 that the report shows real times (the report step's own line has none). Pending: merge to main.
- Live run 1/3 (agent-pipeline task 12), task-22799857 on 2026-11-10: real Architect found the 3 seeded issues in ~30 s; user approved in the mailbox; Developer fixed isOverdue (<= to <) and unskipped its test (2 files); Docker tests 8/8; QA pass; report delivered. Defect (step durations 0 s): addressed in room-hints task 1, to confirm live.
- agent-pipeline task 11 (done, not live-tested): `engine.ts` exports `buildRuntimes(config, fakeDelayMs, kiroHome)` (one `KiroCliRuntime` shared by kiro-cli roles, `models` from config) and uses `createPipelineSteps` (`steps/index.ts`) when any role is kiro-cli and `RUNTIME` is not `fake`; otherwise `createRuntimeSteps` (fake). With a custom `dataDir` the store's `runsDir` follows `data/runs`. No live kiro-cli job was run; tasks 12–13 remain. Unattended session note: branch `feat/agent-pipeline` already existed and is behind main, so a new branch `feat/agent-pipeline-wire` was cut from main.
- agent-pipeline tasks 6–10 (S9, S10), what exists and what to know for tasks 11–13 (all in `packages/agent-engine/src/steps/`, design details in the spec's design.md under "Decisions made while implementing"):
  - Steps are plain functions over `PipelineDeps` (`steps/deps.ts`: runtimes, store, `dataPaths`, repos, limits): `analyzeStep`, `developStep`, `testStep`, `reviewStep`, `reportStep`. Task 11 must compose them into a `Steps` object in `engine.ts` (pass `ctx` and the step inputs through) and give `buildRuntimes` a `KiroCliRuntime` per role (`kiroHome` = `dataPaths().kiroHome`, `models` from config). `createRuntimeSteps` (fake) stays the CI default; the real steps need fenced `json` replies, which `FakeRuntime` does not produce.
  - `Steps.develop` and `Steps.review` now take `task`, and `ReportInput` has `task`; `TestResult` has `exitCode`. JobRunner builds the first plan task (approval stays approve/reject; the `approval.requested` options list one entry per task and the summary says task 1 is built). Choosing another task needs a protocol and mailbox change; not done.
  - `DiffRejectedError` (errors.ts): the runner stores the rejected patch as `diff-rejected.patch` and the report shows it.
  - Docker Desktop was not running at the start of the session; `docker desktop start` brought it up. Image `agentlife-runner:1` was built with `pnpm --filter @agentlife/agent-engine runner:build` and the live Docker tests passed (`$env:AGENTLIFE_LIVE='1'` then `pnpm --filter @agentlife/agent-engine exec vitest run test/docker-runner.test.ts`): `D:\...` mounts work, no network, read-only `/src`, non-root, timeout kills the container. Anyone running live jobs must build the image first (otherwise the test step fails with `runner_image_missing`).
  - The test log artifact is `test_log-<attempt>.txt` (runner convention), not `test_log.txt`.
  - Not run live: the Architect, Developer and QA prompts with the real `kiro-cli` through these steps (only the unit tests with scripted runtimes). Task 12 is the first end-to-end run; expect prompt tuning.
- agent-pipeline tasks 2–5 (S8), what exists and what to know for tasks 6–9:
  - Fixture `fixtures/repos/haunted-todo` (outside the pnpm workspace; own `package-lock.json`, Vitest 5.1.0, 7 passing + 1 skipped test). `config/repos.json` source is now `fixtures/repos/haunted-todo`. `steps/materialise.ts` creates `data/repos/<id>` (single commit, author `AGENT LIFE Engine`, fixed date, so the commit id is stable). `git.ts` has the `git()` helper (no shell, no user/system git config, `NUL` as global config on Windows) and the `DEVELOPER_IDENTITY` for task 7. `paths.ts` has `dataPaths()` and `isInside()`.
  - Role agents in `packages/agent-engine/agents/*.json` (system prompt inline), task templates in `prompts/*.md` (placeholders goal, task, feedback, diff, testLog, testStatus; no retry placeholder, the retry appends the zod error). `prompts.ts` has `renderPrompt` (one pass) and `fence` (untrusted text in a fence the text cannot close). `installAgents()` runs from `startEngine` when a role uses `kiro-cli`.
  - `KiroCliRuntime` (`runtimes/kiro-cli.ts`): `--v3`, no trust flags, prompt on stdin, minimal env (live-checked on Windows), `RuntimeInput.rawLogPath` for raw JSONL. Steps in tasks 6, 7 and 9 must pass `rawLogPath` (`data/runs/<taskId>/<step>.raw.jsonl`) and `cwd`. `buildRuntimes` in `engine.ts` still rejects `kiro-cli`; task 11 wires it.
  - `kiro-cli agent validate` accepts unknown capabilities and invalid effects, so it is only a load check. The permission rules are tested by shape in `test/agents.test.ts`; behaviour is covered by the spike and the live runs. The agent-validate and live runtime tests run with `AGENTLIFE_LIVE=1` (key in the environment); the live architect test passed (22 s).
  - Sessions here cannot write under `data/` with the edit tools (permission rule); use scripts for anything that must land there.
- S2 spike resolved: with `--v3` and no trust flags, writes outside cwd are denied (the earlier failure came from V2 + `--trust-all-tools`). Product agents must always use `--v3` and never trust flags; engine-side containment check stays. Credits are not in stream-json: measure from the usage panel in the live runs.
- build-crew notes: `AgentId` now includes `builder`; the engine runtimes use `Role = Exclude<AgentId, "builder">`. Root `pnpm check` now also typechecks `scripts/crew-map.ts` + tests (`scripts/tsconfig.json`) and runs `vitest --root scripts`; `run-session.ts` itself is not typechecked. `started`/`finished` Builder speech bypasses the 3 s throttle (design.md). Reporting is on by default; `AGENTLIFE_CREW=0` disables it. Client/office changes (ghost figures, builder desk at tile 11,6) have not been looked at in a browser yet (task 5).
- Decided in agent-engine task 6 (recorded in the spec's design.md): the transition table gained `created -> failed`, `awaiting_plan_approval -> failed` and `reviewing -> failed` (review timeout and restart recovery, as recommended). Other conventions: plan rejection and cancel end in `cancelled` with no report; a step error or timeout ends `failed -> report_ready -> delivered` with a failure report; `report_ready`/`failed` are not cancellable (409). Not in risks-and-decisions.md because it is not architectural.
- agent-engine e2e check (agent-engine task 10): done with an in-process script (real engine + HttpEngineLink + gateway + WebSocket client, fake runtime): start_job -> approval -> approve -> delivered + report in ~1.3 s with 150 ms fake delay. Running the engine and world-server as two background processes from the unattended shell did not stay up, so the two-process run and the browser run are still for the user.
- Gateway change made in task 10: `jobActive` is cleared when the current task reaches `cancelled` or `delivered` (the real engine does not send task.failed/completed after a rejected plan, which would have left the UI on "Job running...").
- agent-engine notes: approval `note` is accepted by the API but not stored (the `approval.resolved` event has no note field). Per-step credits/tokens come from the run logs `data/runs/<taskId>/<step>.jsonl` and are summed in the export; no event carries them. The `test` step is a canned pass until agent-pipeline adds the Docker runner; `kiro-cli` runtime in config/agents.json is rejected at startup until agent-pipeline.
- Engine restarts: the HttpEngineLink starts from the engine's head (`/health.lastSeq`), so a world-server restart does not replay old jobs; it reconnects with the last seq and resets if the engine DB has a lower seq.
- agent-engine naming: the engine-side job view is `EngineJobViewSchema` (`JobView` already exists as the client-facing view in protocol.ts); recorded in design.md. Fold conventions (steps from state changes, verdict via reason `verdict:pass|fail` on the transition into `report_ready`) are in design.md. Token/credit per step is not in events yet (task 9).
- `pnpm-workspace.yaml` now has `allowBuilds: better-sqlite3: true` (needed for the prebuilt binary).
- Review suggestions not done yet (non-blocking): gateway sends some messages twice (`job_update`, `approval`); no in-flight state on approve (double click); engine error text is forwarded to the client (max 200 chars). `jobActive` timeout is partly covered (cleared on cancelled/delivered). Revisit with the next review.
- Server packages must avoid constructor parameter properties and enums (`--experimental-strip-types`). Mirrored avatar directions are 0↔6, 1↔5, 2↔4 (design.md).
- GitHub public repo not created yet (needs user).
- The other account's email is still in commit 4e16788; rewrite history before the first push if the user confirms.
- Codex CLI not on PATH; reviews can use the Codex app or extension.
- Discord: `pnpm notify` (free, Ollama summary, DM via the Crew bot); automatic session messages go to Discord only when the user last wrote from Discord (presence in data/presence.json). See docs/sessions.md.
- Model and effort per session: docs/sessions.md; runner `pnpm session next` (always starts from main).

## Key dates
- 2026-12-01 feature freeze
- 2026-12-04 14:00 PT submission deadline (aim for Dec 3)
