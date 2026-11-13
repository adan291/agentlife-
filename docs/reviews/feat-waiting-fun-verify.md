VERDICT: PASS

Branch `feat/waiting-fun`, spec `waiting-fun`, tasks 1 and 2 (both `[x]`). Four commits over `main`: design, task 1, task 2, status.

Commands run:
- `pnpm check`: exit 0. shared 440, client 678, world-server 399, agent-engine 680 (7 skipped), scripts 16 tests, all passing.
- `E2E_CHANNEL=msedge pnpm --filter @agentlife/client exec playwright test e2e/waiting-fun.spec.ts`: 3 passed (wisp catch, wisp with reduced motion, emotes and sitting). Ports 8795 to 8797 were free before the run.

## Criteria

| Criterion | Result | Evidence |
|---|---|---|
| 1.1 wisp appears during a job on the user's floor | PASS | `world-server/src/gateway.ts` `trySpawnWisp` / `wispSpot` (spawns only when `jobActive` on a project floor); `wisp-gateway.test.ts` "appear while a job runs...", "do not appear when no job runs", "...in the lobby..."; e2e test 1. Note: a hotel without an economy has no wisps (`gateway.ts:288`, test "do not appear in a hotel without an economy"). Written in design.md, but narrower than the literal wording of 1.1. |
| 1.1 at most one at a time | PASS | `wisps.test.ts` "is one at a time..."; `wisp-gateway.test.ts` "are one at a time..." |
| 1.1 every 20 to 60 s | PASS | `shared/src/fun.ts:20-21` (`WISP_MIN_MS`, `WISP_MAX_MS`); `wisps.test.ts` "waits 20 to 60 s between tries"; `gateway.ts` `scheduleWisp` uses `nextDelay()` |
| 1.1 fades after 8 s, click before that catches it | PASS | `fun.ts:17` `WISP_LIFE_MS = 8000`; `wisps.test.ts` "refuses a wisp ... after the grace"; `wisp-gateway.test.ts` "pay 1 Ecto when caught", "pay nothing for a click that comes after the wisp faded"; e2e test 1 |
| 1.1 small catch effect | UNVERIFIABLE | `catchFrame` (`wisp-fx.ts:60`) is tested in `client/test/wisp.test.ts`, but how the effect looks needs a person. |
| 1.2 server decides when a wisp exists | PASS | `world-server/src/wisps.ts` `spawn`; client sends only `wisp_catch { wispId }`, no position or amount |
| 1.2 grant 1 Ecto per catch | PASS | `WISP_REWARD = 1` (`fun.ts:15`), `gateway.ts` `catchWisp`; `wisp-gateway.test.ts` "pay 1 Ecto when caught" (balance 1, grant amount 1); e2e test 1 (balance +1, toast "+1 Ecto: wisp caught") |
| 1.2 max 10 per job | PASS | `wisps.test.ts` "stops after ten paid catches of a job..."; `wisp-gateway.test.ts` "pay ten catches for a job and then stop appearing"; numbering survives a restart ("keep the numbering of a job across a restart") |
| 1.2 max 50 per day | PASS | `wisps.test.ts` "stops after 50 paid catches in a day...", "refuses a catch when the day filled up..."; `wisp-gateway.test.ts` "pay 50 catches a day, counted from the wallet, also after a restart" |
| 1.2 click on a missing wisp gives nothing | PASS | `wisps.test.ts` "refuses a wisp that is not there..."; `wisp-gateway.test.ts` "pay nothing for a second click on the same wisp or for a wisp that is not there"; "cannot be caught from another floor" |
| 1.3 reduced motion: wisp does not move, no particles | PASS | `client/test/wisp.test.ts` "does not move, pulse, blink or leave sparks under reduced motion"; `world-view.ts:233` passes `reducedMotion`; e2e test 2 (position unchanged under `reducedMotion: reduce`) |
| 2.1 sit on seating furniture (click sofa or chair) | PASS | `world-server/test/fun-gateway.test.ts` "sits on the sofa when it is clicked..."; `shared/test/fun.test.ts` seat tests; `pick.ts` lets seats through |
| 2.1 wave, dance, cheer, keys 1 to 4 outside text fields, emote bar | PASS | `fun-gateway.test.ts` "sends the emotes of the user back to the room..."; `waiting-fun-ui.test.ts` "the emote keys" and "the emote bar"; e2e test 3 (bar with 4 buttons, key 4 sits and stands, `4` typed in the palette input is not sent) |
| 2.1 shown with own art | UNVERIFIABLE | `waiting-fun-ui.test.ts` checks every pose, view and frame draws inside the 32x60 frame. The look needs a person (design.md says poses were checked only in lobby screenshots). |
| 2.2 agents cheer on a delivered pass | PASS | `fun-gateway.test.ts` "makes every ghost of the floor cheer when a job was delivered with a pass" (architect, developer, qa); `gateway.ts` `reactToDelivery` |
| 2.2 agents look glum on a fail | PASS | `fun-gateway.test.ts` "makes them look glum after a fail verdict and after a job that failed on the way"; `EMOTE_MS.glum = 3000` (`fun.ts:89`) |
| 3.1 mood rested/busy/tired from work today | PASS | `world-server/test/mood.test.ts` (20 and 60 min thresholds, intervals add up, 2 h cap); `fun.test.ts` `moodOf` monotonic property; `fun-gateway.test.ts` "changes with the work of the day..." |
| 3.1 mood in the tooltip and as a face on the name tag | PASS (code, tests) | `world-view.ts:201` adds `moodLine(mood)` to the tooltip; `world-view.ts:210` -> `overlay.setMood`; `waiting-fun-ui.test.ts` mood face drawing. Appearance of the face needs a person. |
| 3.2 coffee machine in the shop, "serve coffee" rests the most tired agent | PASS | `fun-gateway.test.ts` "serves the most tired agent, who is rested after it, thanks the user and cheers; the panel never opens", "says nobody needs coffee when nobody is tired"; `mood.test.ts` "coffee"; `catalogue.test.ts:29` (only sold piece with an interaction); `fun.test.ts` "the coffee machine" |
| 3.2 mood never changes a job, model or permission; tooltip says so | PASS | `fun.ts:117` `moodLine` text "Only for show: it never changes a job, a model or a permission."; the mood code (`mood.ts`, gateway mood block) sends only `mood`, `say` and `emote` messages and does not touch the engine link |
| 4.1 world-server: spawn only during a job | PASS | `wisps.test.ts` "never appears without a job...", `wisp-gateway.test.ts` "do not appear when no job runs" |
| 4.1 world-server: limits per job and per day | PASS | see 1.2 |
| 4.1 world-server: catch of a missing wisp refused | PASS | see 1.2 |
| 4.1 sitting on an occupied seat refused | PASS | `fun-gateway.test.ts` "refuses a seat somebody sits on with seat_taken, and the user does not move"; `shared/test/fun.test.ts:173` |
| 4.2 client: emote keys ignored in text fields | PASS | `waiting-fun-ui.test.ts` "are ignored in a text field, whatever kind" |
| 4.2 client: reduced motion | PASS | `client/test/wisp.test.ts` (wisp and catch effect), `waiting-fun-ui.test.ts` "loops the two frames of an emote, and holds the first one under reduced motion" |
| 4.3 Playwright: catch a wisp during a scripted job, balance rises | PASS | `e2e/waiting-fun.spec.ts` "a wisp appears during a job, and catching it adds 1 Ecto"; run above, passed |

## To fix

Nothing.

## Human checks

- Wisp in a browser: the orb, its blink in the last second and the catch ring (1.1). Check it can be clicked on a real, moving wisp (the e2e clicks with `force: true`).
- The figure art for sit, wave, dance and cheer, and the glum and cheer poses of the ghosts (2.1, 2.2). Look at them on a project floor, not only in the lobby, including the sitter's depth against a sofa and a chair.
- The mood face on the name tag and the tooltip line of each desk ghost (3.1).
- Buy the coffee machine (Tables, 40 Ecto), place it, and serve a tired agent in a live run. The test used small limits and a faked clock; a real 60 minutes of work was not run (3.2).
- A hotel with the plain scripted engine and no wallet file has no wisps. If the user expects wisps there, 1.1 needs a decision (design.md condition 1 of Spawn).
- Both specs state "first to cut if late": merge decision is the user's.
