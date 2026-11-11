# Review: feat/build-board against main

Spec: `.kiro/specs/build-board` (tasks 1-2 marked done).
Commits: a2f85b4 (engine), cb095f8 (world and client), 985a7db (status).
`pnpm check`: passes (shared 183, world-server 98, client 361, agent-engine 305 + 6 skipped, scripts 16).

## Verdict: request changes

## Blocking issues

1. **The panel never says why the board has no data.** Requirement 3 and the gateway test "says so when the engine has no construction board" expect a message. The gateway and the replay transport send the `engine_unavailable` error before `open_panel`, because panel data precedes `open_panel` (`packages/world-server/src/gateway.ts:336-347`, `packages/client/src/replay/transport.ts`, build branch). In `PanelState.apply`, the `error` case stores `buildError` only when `this.open === "build"` (`packages/client/src/ui/panel-state.ts:104-106`). At that moment `open` is still null, so nothing is stored. Then the `open_panel` case clears `buildError` (`panel-state.ts:60-63`). The result: the scripted engine and the demo show "Loading the construction board..." forever. The client unit test only covers the error after the panel is open (`packages/client/test/build-board.test.ts:113`), so it misses this.
   Fix: store the build error whenever it arrives (not only when open), keep it across `open_panel`, and clear it on `build_board` and `close()`. Add a test that sends the error first, then `open_panel`, and expects `buildError` to be set. Also check the replay transport in the same way.

2. **Build errors leak into the Computer panel.** The same `error` case also sets `this.engineError` (`panel-state.ts:105`). Opening the board with no engine therefore sets the engine error shown by the Computer panel. The board error should not touch `engineError`.

## Requirements claimed as done but not met

- Requirement 3.2 and 3.3 are met in code. Requirement 4.2 (Builder phase bubbles) is covered by the engine test. Requirement 3.4 (verdict link, Markdown) is met through `renderMarkdown`.
- Requirement 3 "says so" is not met for the scripted engine and the demo, see blocking issue 1.

## Missing tests

- No test for the error-before-`open_panel` order (blocking issue 1).
- No client test that the Computer panel is unaffected by a build error (blocking issue 2).
- No test that a report request whose file is missing leaves the viewer in a state that can be closed. Today `renderBuild` shows "Loading the report..." forever when `build_report` fails (the error reaches `buildError` only while the board is open, and the report view ignores it). Covered by the fix for issue 1 if the error is shown in the report view too.
- The parser tests cover malformed TASKMAP rows, path tricks and malformed session lines. They are fixture-based, which the spec asks for. No property-based test was asked for this spec.

## Non-blocking suggestions

1. The conductor phase is kept in memory and never expires. If the conductor is killed without a `stopped` phase, the row stays "running" until the engine restarts. Consider a timeout (for example 30 minutes) after which the phase is ignored.
2. `sendBuildReport` (`gateway.ts:260-266`) reports every failure as "no verification report for that spec", including engine outages. Use the engine's message or a neutral text.
3. `readBuildBoard` reads about 40 files synchronously on the engine event loop for every `build_board` request. A short cache (2 to 5 s) or async reads would keep the engine responsive when the panel refreshes often.
4. `phaseGroup("merge")` maps to "running", so a merge shows as "Running" on the row. A separate "Merging" label would be clearer.
5. `buildInterval` in `panels.ts` is not cleared when the panel module is torn down. Harmless today, but worth a `dispose` for tests.
