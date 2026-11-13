# Design Document: waiting-fun

Small things to do while the agents work. Nothing here changes a job, a model or a permission, and the agent-engine does not change. The rules that can be pure live in `@agentlife/shared` (`fun.ts`, plus the seat and emote rules of `world/sim.ts`). The world-server decides what exists and what is granted (`wisps.ts`, `mood.ts`, gateway). The client draws and sends clicks. Task 1 (wisps) is first; task 2 (sit, emotes, cheer and glum, mood, coffee) is at the end.

## Vocabulary
- **Wisp**: a small catchable light that the server makes appear on the user's floor while a job runs there. Catching it pays 1 Ecto.
- **Seat**: a piece of furniture the avatar can sit on (`SEAT_DEFS`: chair, sofa, armchair, bench, beanbag, throne). One sitter per piece.
- **Emote**: a short animation of an avatar: `wave`, `dance`, `cheer` (the user) and `glum` (agents only).
- **Mood**: `rested`, `busy` or `tired`, of one desk agent. Visual only.

## Task 1: Wisp catching

### What the server decides (requirement 1.1, 1.2)
`Wisps` (`world-server/src/wisps.ts`) is the whole rule set and is tested without sockets. It owns one `wisp` at most (`{ id, roomId, taskId, x, y, expiresAt }`) and no timers; the gateway calls it.

- **Spawn** (`spawn(ctx)`): called by a timer that fires every 20 to 60 s (`WISP_MIN_MS`, `WISP_MAX_MS`, a random delay each time). It creates a wisp only when all of these hold, else it does nothing and the timer simply runs again:
  1. the hotel has an economy (a wisp that pays nothing is pointless, and the scripted engine's jobs are not real work, so by default there are no wisps there; a wallet file named in the environment turns it on for tests, as for the shop),
  2. a user is connected and stands on a project floor whose job is active (`jobActive`, the same flag the board uses),
  3. no wisp exists, or the existing one has expired,
  4. the job has paid fewer than 10 wisps and the user fewer than 50 today.
  The tile is a free floor tile of that room, picked at random (`WorldSim.freeTiles()`, new: floor tiles that no furniture blocks and nobody stands on or walks to). It is sent as a hint for where to draw; the server never trusts a position from the client.
- **Life**: a wisp lives `WISP_LIFE_MS` = 8000 ms. The server accepts a catch up to `WISP_GRACE_MS` = 1000 ms later (the click was sent before it faded; the network takes time). The wisp is also dropped when the user leaves the floor, disconnects, or the job ends.
- **Catch** (`catch(id, ctx)`): refused, with nothing paid, when there is no wisp, the id is not the current one, it expired, the user is not on its floor, its job is no longer the active one, or a limit is reached. Otherwise the wisp is consumed first (a second click on it finds nothing) and the grant is made.
- **Limits and memory**: no new file. The ref of a catch is `<taskId>.<n>` with `n` from 1 to 10, the first `n` whose grant is not in the wallet yet (`economy.hasGranted`), so 10 per job is a property of the keys and survives a restart. The daily count is the number of `wisp_caught` entries in the wallet's ledger whose time is today in local time (`wispsToday`, shared and pure). The ledger keeps the last 200 entries, far above 50 a day; a day with more than 150 other entries could hide a few catches, which only gives the user a few more. A catch whose write fails pays nothing and is not counted (the same rule as every grant).
- **Ecto**: `GRANT_REASONS` gets `wisp_caught` (label "wisp caught", toast "+1 Ecto: wisp caught"). The amount is the constant `WISP_REWARD` = 1, passed like the reward of a quest (`config/economy.json` keeps its five fixed reasons). Keys of the wallet's `granted` list grow by at most 10 per job; the 2000 kept are far above the replay window (50 jobs, 550 keys).
- **Test knobs**: `GatewayOptions.wisps` (`minMs`, `maxMs`, `lifeMs`, `graceMs`, `random`) and, in `main.ts`, `AGENTLIFE_WISP_MS` (`min,max` in ms, tests and Playwright only).

### Messages (`shared/src/protocol.ts`)
- Client to server: `wisp_catch { wispId }`.
- Server to client: `wisp { wispId, x, y, ttlMs }` when one appears and `wisp_gone { wispId, caught }` when it ends (`caught: false` also answers a refused catch, so the client forgets it; no error toast for a click that came too late). A catch pays through the existing `wallet { balance, grant }`, so the balance chip and the toast follow with no new code.
- A `welcome` clears the client's wisp (a new room or a reload); the server does not repeat a live wisp.

### Client (requirement 1.1, 1.3)
- `scene/wisp-fx.ts`: the drawing. A small glowing orb with two eyes, three trailing sparks and a soft halo, made of `Graphics` shapes (no images). `wispFrame(t, reduced)` (pure) gives its offset, scale and alpha at time `t` within its life: a gentle float and sway, a blink in the last second. With reduced motion it does not move or pulse and has no sparks; it only fades in the last second. `catchFrame(t, reduced)` (pure) is the catch effect (a ring of six sparks that spreads and fades over 600 ms; with reduced motion a still ring that fades).
- `ui/wisp.ts`: a real `<button class="al-wisp" aria-label="Catch the wisp">` over the stage, moved to the wisp's screen position every frame and hidden when there is none. The scene is canvas, so the button is what a keyboard or a screen reader can reach (and what Playwright clicks); a click or Enter sends `wisp_catch`. The button is transparent and about 44 px wide. `WorldView.wispPoint()` gives the screen position (the scene root's transform applied).
- The client forgets the wisp at `ttlMs` on its own clock, on `wisp_gone`, on `welcome` and on `error`.
- The recorded demo has no wisps (the server sends none).

## Task 2: Avatar actions, emotes and ghost mood

### Sitting (requirement 2.1)
- Clicking a seat sends the existing `use { itemId }`. `WorldSim.handleIntent` now knows seats: a piece whose def is in `SEAT_DEFS` is not "walk next to it" but "sit on it". The avatar walks to the use tile of the piece (as for any piece), takes one more step onto the seat tile (`seatTile(placed)`: the footprint tile next to the use tile) and faces the way the piece faces (`placed.dir`). `{ type: "sit", id, sitting: true, dir }` follows on arrival (deferred, like `face`); `sitting: false` is sent when the avatar gets up.
- **One sitter per piece.** `WorldSim` keeps `seatedBy` (item id to avatar id) and the seat of each avatar. The seat is claimed when the walk is ordered. A second avatar who tries gets `error` `seat_taken` ("Somebody is sitting there.") and does not move. In the product only the user sits; the rule is on the avatar id, and the tests seat a guest first.
- **Getting up.** Any new walk (`move`, `use` of something else, an agent's goto) first sends `sit { sitting: false }` and starts with the use tile (the seat tile is not on the path grid for a solid piece). `use` of the seat you are on gets you up too. A seat claimed but not reached yet is only released. If the piece moved, was picked up or no longer has the same seat tile (arrange mode), the claim is dropped; `updateRoom` does it for every claim and a walk never starts from a stale seat.
- `leave()` and `join()` release the user's seat.
- The sitting pose is drawn lower, with the legs forward (`figure.ts`, `AvatarPose` `sit`). Clicking a chair no longer counts as a plain move: `pickFurni` lets seats through like furniture with an interaction.
- `sit_toggle {}` (client to server, key 4 and the Sit button): gets up when sitting; otherwise sits on the nearest free seat of the floor that has a path (nearest by the length of the path to its use tile). No free seat: `error` `seat_taken` "There is no free seat here."

### Emotes (requirement 2.1, 2.2)
- Client to server: `emote { emote: "wave" | "dance" | "cheer" }`. The sim answers `emote { id, emote }` to the user's room; it keeps no state (an emote is a short animation, the client plays it for `EMOTE_MS`: wave 2400, cheer 2400, dance 5000, glum 3000). Starting a walk ends it. While sitting, wave and cheer are played seated and dance is ignored (a seated avatar does not dance).
- Server to client: `emote { id, emote }` with `emote` one of `wave`, `dance`, `cheer`, `glum`; `id` is an avatar id (the user, a desk role or a standing spot).
- **Agents cheer or look glum** (2.2). When a job reaches `delivered` and the `GrantTracker` knows it: verdict pass and never failed gives `cheer` to every ghost of that floor that is on it (desk roles and the team members at spots, not those who left by the elevator); a failed job or a `fail` verdict gives `glum`. A job the tracker did not see, or an event older than a minute (a replay after a restart), changes nothing. The tracker now observes every event also when the hotel has neither economy nor progress (it keeps no files).
- Ghosts get a drawing per emote: `cheer` hops higher with happy eyes and a few sparks, `glum` sinks, with sad eyes and one tear. The user's figure has `wave` (one arm up, the forearm swings), `cheer` (both arms up, a hop) and `dance` (sway, alternating arms, a hop). All are two-frame loops like the walk cycle, so `SpriteProvider.avatar(role, view, frame, pose?)` takes an optional pose and the baked frame is cached by it. With reduced motion an emote holds its first frame (no loop), and the cheer sparks are not drawn.
- **Keys and bar.** `ui/emotes.ts`: `emoteKey(event)` (pure) maps `1` wave, `2` dance, `3` cheer, `4` sit or stand. It ignores a key typed in a text field, with Ctrl, Alt or Meta, with a panel open and while arranging. `createEmoteBar` is a small row of four buttons at the bottom of the stage (label and key in the title, `aria-label`), shown only on the live hotel. The replay (recorded demo) routes unknown messages to the sim, so the bar works there too.

### Mood (requirement 3.1)
- `shared/fun.ts`: `Mood` (`rested`, `busy`, `tired`), `MOOD_BUSY_MS` = 20 min and `MOOD_TIRED_MS` = 60 min of work today, `moodOf(workedMs, limits)` (pure, monotonic), `moodLine(mood)` for the tooltip.
- `MoodKeeper` (`world-server/src/mood.ts`) measures work. It follows `agent.state_changed` of the three desk roles of each project: from `thinking` or `working` until any other state is one interval. An interval counts for the local day in which it ends, from its start or midnight, and an open interval counts for at most 2 h (an engine that died with an agent "working" must not tire it forever). Events that go back in time are ignored (a replay while connected counts once). `workedMs` of a role is the closed intervals plus the open one up to now, minus the amount at the last coffee. A new local day starts at zero.
- Mood is kept in memory only. It is a visual thing; after a restart the agents are rested, and the replay of the latest jobs rebuilds what happened today.
- Messages: `mood { roomId, moods: { architect, developer, qa } }` after the `welcome` of a project floor and whenever a mood changed. A poll every 15 s (`moodPollMs`) catches the crossing of a threshold between events.
- Client: `WorldView.setMoods`; the tag over a desk ghost gets a small face (`overlay.setMood`: two eyes and a mouth, one shape per mood, colour per mood); the tooltip gets "Mood: Tired. Only for show: it never changes a job, a model or a permission." (requirement 3.2).

### Coffee machine (requirement 3.2)
- A new decorative definition `coffee_machine` in `FURNI_CATALOG` and the shop (page Tables, 40 Ecto), with a drawing in `recipes.ts` for the four facings and the interaction `coffee` with the hint "Serve coffee to a tired agent". `InteractionSchema` and `PanelNameSchema` get `coffee`.
- **Changed from furni-shop.** The shop sold only definitions without an interaction. The rule meant "nothing sold starts work"; the coffee machine does not. `SHOP_INTERACTIONS = ["coffee"]` (shared, `shop.ts`) are the interactions a bought piece may have: `checkCatalogue` and `Hotel.placeFurniture` refuse any other. A piece with an interaction also keeps its use tile free (`checkMove`), so a coffee machine can never be walled in.
- `use` of the machine walks to it and, on arrival, the sim sends `open_panel { panel: "coffee" }`. The gateway answers it like it answers a door: it never reaches the client as a panel. `serveCoffee(roomId)` picks the most tired desk agent (the most work today; ties by role order) and resets its work counter, so it is `rested`. That ghost says "Thanks for the coffee!" and cheers; the user's avatar says "Nobody here needs coffee." when no desk agent is tired. The new moods are sent. One cup per use.
- The mood tooltip never says coffee changes anything else.

## Tests (requirement 4)
- shared (`fun.test.ts`, `sim.test.ts`): the wisp constants and `wispsToday`; `moodOf` monotonic (fast-check); the new messages; seats (sit, occupied refused, getting up, claim dropped when the piece moves, `sit_toggle` nearest and none free, emotes); catalogue and placing the coffee machine; `SHOP_INTERACTIONS`.
- world-server (`wisps.test.ts`, `wisp-gateway.test.ts`, `mood.test.ts`, `fun-gateway.test.ts`): spawn only during a job, only with an economy, only on the user's floor, one at a time; the catch pays once, a click on a missing, expired or foreign wisp pays nothing; 10 per job and 50 per day (also after a restart); a catch for the wrong floor; cheer and glum after a delivered job and nothing after a replay; mood thresholds with a fake clock, day roll-over, open interval cap; coffee on a tired and on a rested floor; sitting on a taken seat through the gateway.
- client (`wisp.test.ts`, `emotes.test.ts`, `mood-face.test.ts`): `wispFrame` and `catchFrame` with and without reduced motion; the wisp button; emote keys in text fields, with modifiers, with a panel open, while arranging; poses draw without error for every role, view and frame; the mood line and tag face.
- Playwright (`e2e/waiting-fun.spec.ts`): during a scripted job a wisp appears, clicking it raises the balance by 1 and shows the toast; a second click finds nothing. It has a world-server of its own (ports 8797 and 5197) with `AGENTLIFE_WISP_MS=300,500` and scratch files, so wisps do not leak into other specs. This machine has no Playwright Chromium: run with `E2E_CHANNEL=msedge`.
