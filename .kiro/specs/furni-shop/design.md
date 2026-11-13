# Design Document: furni-shop

Pure rules live in `@agentlife/shared` (`economy.ts`). The world-server owns the files and decides what is granted (`economy-store.ts`, `grants.ts`, gateway). The client only shows the balance and the shop and sends two messages. The agent-engine does not change. Tasks 1 and 2 are described first; task 3 (placing) is at the end.

## Vocabulary
- **Ecto**: the currency. One balance per user, whole numbers, never negative.
- **Grant**: Ecto added because of a verified event. A grant has a **reason** and a **ref** (the thing it was earned for). The pair is its **key**, `<reason>:<ref>`.
- **Catalogue item**: something the shop sells, `config/catalogue-furni.json`. It names a **furniture definition** (`defId`) of `FURNI_CATALOG`, which the client draws with a recipe.
- **Stock**: the bought items that are not placed on a floor, `{ [itemId]: count }`.

## Wallet (`data/wallet.json`)
`AGENTLIFE_WALLET_FILE` overrides the path (tests, Playwright).

```json
{ "version": 1, "since": 1763000000000, "balance": 120,
  "ledger":  [{ "ts": 1763000100000, "amount": 20, "reason": "job_passed", "ref": "task-1a2b" }],
  "granted": ["job_passed:task-1a2b"] }
```

- `ledger` keeps the last 200 entries (`LEDGER_MAX`), oldest dropped. `amount` is negative for a purchase (`reason: "purchase"`, `ref` = item id).
- `granted` is the list of keys already counted, last 2000 (`GRANTED_KEYS_MAX`). The ledger is too short to be the memory of what was counted: the gateway replays the latest five jobs of each project (50 at most) every time it starts, and a night summary is looked at every minute. 2000 keys is far above that window. Oldest key dropped first.
- `since` is when the wallet was created. An event older than `since` earns nothing: the history of jobs that ran before the shop existed (or before a lost wallet file was replaced) does not become a windfall. Events that happened while the world-server was off are newer than `since` and are granted when the replay brings them.
- `balance` is between 0 and 1 000 000 (`BALANCE_MAX`). A grant that would pass the maximum is cut to it; its key is still counted.
- Writes: temporary file in the same folder, then rename. A file that cannot be read or fails the schema is renamed `wallet.json.bad-<time>` and the store starts empty (new `since`); it is never overwritten. Same for `inventory.json`. Both go through `json-file.ts`, which `layout-store.ts` does not use (it is not refactored).

## Grants (requirements 1.2, 1.3)
Amounts live in `config/economy.json` (`{ "version": 1, "grants": { "<reason>": <whole number 1..1000> } }`, all five reasons required). Defaults: job_passed 15, branch_delivered 20, review_finished 10, memory_accepted 5, night_summary 25.

| Reason | Event | Ref | Rule |
|---|---|---|---|
| `job_passed` | `task.state_changed` to `delivered` | task id | kind is not `review-branch`, the job never failed, the verdict seen at `report_ready` (`verdict:pass`) is pass |
| `review_finished` | `task.state_changed` to `delivered` | task id | kind is `review-branch`, the job never failed. The verdict is not required: a review that asks for changes is still a finished review |
| `branch_delivered` | `delivery.done` | task id | the engine recorded that the branch was fetched into the user's repository |
| `memory_accepted` | the user accepted a proposal in the Library and the engine took it | `sourceTaskId` of the proposal | once per job, however many of its proposals are accepted |
| `night_summary` | a morning summary with `counts.done >= 1` | night key | read by the gateway when it copies the engine's summaries into the lobby mailbox |

- "Never failed": a job that went through `failed` (or got `task.failed`) ends in `report_ready` and `delivered` as well, with a report. It did no work worth paying for, so it earns nothing. A `delivered` event of a task whose creation, kind or verdict the gateway did not see earns nothing (no guessing).
- `grants.ts` (`GrantTracker`) follows the events and says which grants an event makes. It keeps kind, verdict and failure of the latest 500 tasks. It does not know floors or sockets and is tested alone. The gateway feeds it every engine event before it looks at rooms, so a job on a floor that has no room yet still counts.
- `applyGrant(wallet, { reason, ref, amount, ts })` (shared, pure) adds nothing, and says why, when the key is already in `granted`, when `ts < since`, or when `ref` is not an identifier. Otherwise it adds the amount, appends the ledger entry and records the key. The same list of grants applied twice gives the same wallet as applied once (property test).
- No client message adds Ecto. The only client messages of this spec are `shop_state` and `shop_buy`; `shop_buy` can only lower the balance.
- If the file cannot be written, the grant is undone in memory, logged, and not counted; the next replay or poll tries again.

## Catalogue (`config/catalogue-furni.json`)
```json
{ "version": 1, "items": [ { "id": "armchair", "name": "Velvet armchair", "page": "seating", "price": 30, "defId": "armchair" } ] }
```
- `id`: `^[a-z][a-z0-9_]{0,39}$`, unique. `name`: 1 to 40 characters. `price`: whole number 1..10 000. `page`: `seating`, `tables`, `lights`, `plants`, `spooky` or `walls` (shown as Seating, Tables, Lights, Plants, Spooky, Walls).
- Size and look come from the definition, not from the file. `checkCatalogue(items, catalog)` (shared) refuses: a duplicate id, a `defId` that is not in `FURNI_CATALOG`, a definition with an `interaction` (decorative only: nothing sold starts work), a definition that is part of the template (`computer_desk`, `mailbox`, ... any with an interaction, plus `agent_desk`), fewer than 24 items. The world-server calls it at start and exits with the message when the file is wrong, as it does for room files.
- 25 definitions are added to `FURNI_CATALOG` (`furni.ts`), none with a hint (the hints test says decorative pieces have none). Wall pieces use `mount: "wall"`. Each has a recipe in `client/src/scene/recipes.ts`; an existing test already checks that every definition has a drawing in all four facings.
- The shop counter is a new definition `shop_counter` with `interaction: "shop"` (added to `InteractionSchema` and `PanelNameSchema`). It stands in the lobby at (4, 4) facing south, use tile (4, 5).
- The preview of an item is the room's own sprite: `ProceduralSprites.furni(defId, 4)` read back to a PNG data URL with the renderer's extract (`scene/previews.ts`). Nothing else draws furniture.

## Inventory (`data/inventory.json`)
`AGENTLIFE_INVENTORY_FILE` overrides the path.
```json
{ "version": 1, "stock": { "armchair": 2 } }
```
- Stock counts items not placed. Task 3 added `placed` (project id to placed pieces) and `seq` with schema defaults, so a file written by task 2 stays valid (see Task 3 below).
- The cap is 200 items in stock (`INVENTORY_MAX`) for purchases: a purchase that would make it 201 is refused. Pieces that come back from a floor may take the stock above it.

## Purchase (`applyPurchase`, requirement 2.3)
Checks in this order; the first that fails answers and changes nothing:

| Code | Rule | Text |
|---|---|---|
| `unknown_item` | the id is not in the catalogue | "That item is not in the shop." |
| `not_enough_ecto` | balance below the price | "You need 30 Ecto and have 12." |
| `inventory_full` | stock already holds 200 items | "Your inventory is full (200 items)." |

Then the balance goes down by the price, a ledger entry (`purchase`, negative) is added and the stock goes up by one. The balance can only fall by what it holds, so it never goes below zero.

`Economy.buy` writes the inventory file first and the wallet second. A crash between them gives the user an item for free, never an empty wallet for nothing. If the second write fails the first is written back (best effort), memory is reverted, and the answer is "Could not save your purchase." Buying is accepted only in the lobby (the counter is there); reading the shop (`shop_state`) works on every floor, because the inventory tray of task 3 needs it.

## Messages (`shared/src/protocol.ts`)
- Client to server: `shop_state {}` and `shop_buy { itemId }` (`itemId` matches the id pattern above).
- Server to client:
  - `wallet { balance, grant? }`: sent after every `welcome`, after each grant (with `grant: { amount, reason }`, which the client shows as a toast, "+20 Ecto: branch delivered") and after each purchase (no `grant`). Sent only to the connected user; a grant while nobody is connected is simply in the balance next time.
  - `shop { balance, items, stock, stockMax }`: the whole shop: catalogue items (`id, name, page, price, defId`), the stock as `{ itemId, count }` and the cap. Sent when the shop panel opens, on `shop_state` and after a purchase.
- Error code `shop_error`, message = the text of the table above (or "The shop is closed: it needs the real engine.", "The shop counter is in the lobby."). A refused purchase sends nothing else.
- Without an economy (fake engine and no `AGENTLIFE_WALLET_FILE`) the gateway sends no `wallet`, the balance chip is hidden, and the shop answers `shop_error`. The fake engine's jobs are not real work, so they must not pay into the user's real wallet. `main.ts` builds the economy when `ENGINE=http`, or when `AGENTLIFE_WALLET_FILE` is set (tests and Playwright).

## Client
- `ui/wallet.ts` (pure): `balanceText`, `grantToastText`. The balance is a chip in the top left corner of the stage (hud `setBalance`), not in the top bar. Measured with the chip in the left slot of the bar: the job stepper lost its labels at 1366 px (`job-insight.spec.ts`, "labels when there is room") and overflowed at 800 px (5 tests). The labels need 657 px and the bar had about 20 px to spare. The Arrange button went to the stage for the same reason (furni-move), and requirement 1.4 is reworded. The chip is hidden until the first `wallet` message, and so hidden in the recorded demo. It has `role="status"` and the label "120 Ecto". A grant toast uses the stage's bottom toast for 4 s.
- `ui/shop.ts`: pages as tabs, items as cards (preview, name, size, price, Buy), balance and stock count in the header, the refusal text in an alert. The buy button of an item the user cannot afford is disabled with the missing amount in its title. In the recorded demo the panel says the shop is off.
- `PanelState` keeps `shop`, `shopError` and `balance`; `wallet` and `shop` update the balance.

## Task 3: placing bought furniture
Where each thing lives: a bought piece is a record in `data/inventory.json` (the world-server's file, decided in the server), the template and its layout (`data/layouts.json`) do not know it. The hotel builds a floor from three things: the template, the saved layout of template pieces, and the bought pieces (`HotelOptions.extrasOf`). `roomForProject` and `addExtras` put each bought piece on through `checkMove`, in the order they were placed; a piece that no longer fits (the template or the catalogue changed) is left out, and the gateway gives it back to the stock (`returnHiddenPieces`, after every look at the engine's projects).

### Inventory file, widened
```json
{ "version": 1, "stock": { "fern": 1 }, "seq": 3,
  "placed": { "haunted-todo": [ { "id": "bought_3", "itemId": "fern", "x": 2, "y": 1, "dir": 4 } ] } }
```
- `placed` (project id to pieces, at most 60 a floor, `PLACED_PER_FLOOR_MAX`) and `seq` have schema defaults, so the file written by task 2 stays valid.
- `id` is the room item id, `bought_<n>`, with `n` from `seq`, which only goes up: an id is never reused, so a stale undo entry or a reload cannot point at another piece. `isBoughtId` is how the client labels a piece; the server decides by what it stored and by what the template has (`Hotel.isExtra`: on the floor and not in the template's own pieces).
- Changed from task 2: the cap of 200 items (`INVENTORY_MAX`) limits **purchases** only. Pieces that come back (picked up, or from a removed project) always fit, so the per-item count of the file is bounded by `STOCK_COUNT_MAX` (100 000) and not by 200. Otherwise `buy 200, place 1, buy 1, pick up` would write a file that fails its own schema and is moved aside at the next start.
- `inventory.ts` (shared, pure): `placeFromStock`, `pickUpToStock`, `movePlaced`, `returnFloors`, `returnHidden`, `furniOf` (record to `PlacedFurni`; undefined when the item left the catalogue). Each returns a new inventory.

### Two-step changes (`Economy`)
`planPlace`, `planPickUp` and `planMove` work out the new inventory and return `commit()`. The hotel runs its own checks first and calls `commit` as its `save` step, between the checks and the change of the room (the same slot the layout store uses). `commit` writes the file, then updates memory; if the write fails it throws, the hotel answers "The layout could not be saved." and nothing changed. So a floor and the inventory file never disagree.

### Hotel
- `placeFurniture(roomId, piece, save)`: the piece is added to a copy of the room and run through `checkMove` (floor, wall, overlap, standing spots, people, paths), so the refusals and their texts are the ones of a move. Refused for the lobby and HR office (`not_editable`), a piece that is already there (`duplicate`) and a definition with an interaction or the agent desk (`unknown_item`).
- `pickUpFurniture(roomId, itemId, save)`: only a piece that is not in the template. A template piece answers `not_removable`: "That piece belongs to the room. You can move it, not pick it up." Nothing needs a path check, taking a piece away cannot cut a path.
- `moveFurniture` is unchanged for the checks. A bought piece's move is saved to the inventory (`planMove`), a template piece's to the layout store.
- `resetLayout` puts the template pieces back and leaves the bought ones. If a bought piece stands where a template piece goes back to, the reset is refused: "A piece you placed is in the way. Pick it up first." (a reset that returned the user's furniture would lose it silently, or overflow the stock).
- `removeProject` is unchanged. Requirement 3.3 is done in the gateway: every look at the engine's project list (`syncProjects`) gives back the pieces of floors the engine no longer lists (`returnAbsentFloors`). That also covers a project removed while the world-server was off, which never had a floor to remove.

### Messages
- Client to server: `furni_place { itemId, x, y, dir }` (`itemId` is the catalogue id, the same pattern as `shop_buy`) and `furni_pickup { itemId }` (the room item id). `furni_move` also moves bought pieces.
- Server to client: the same `room_layout` as for a move, then `shop` (the new stock, for the tray), both scoped to the user's floor. A refusal is `error` `layout_error` with the reason, as for a move: "You do not have that item.", "This floor is full (60 placed pieces).", "You have nothing to place: the shop is closed.", the rule texts of `checkMove`, "That piece is not in this room.".
- `shop_state` works on every floor (task 2), and the client sends it when arrange mode starts.

### Client
- `ArrangeModel` carries the new behaviour. `onShop` gives it the stock, `tray()` lists the items. `carry(itemId)` takes one out of the tray; while carrying, `pointerMove` / `pointerDown` run `checkMove` on the room plus a stand-in piece and show the green or red preview and the reason; a release over the floor (`pointerUp`) sends `furni_place` when the check passes; the answer selects the new piece. `R` turns the carried item, `Esc` puts it back first (`escape()`) and leaves arrange mode second. `pointerLeave` forgets the tile, so a click on a bar button after the pointer left the floor places nothing. `pickUp()` sends `furni_pickup` for the selected piece when it is a bought one (`canPickUp`) and drops that piece's undo entries.
- Drag and click both work. The tray button takes the item on `pointerdown`, so the same press can be dragged onto the floor and released there. A press and release on the button leaves the item in hand: the next click on the floor places it. A key press on a button (`click` without a pointer) takes it too.
- `ui/arrange-tray.ts` (the tray, right side of the stage under the Arrange button, items with a picture from `scene/previews.ts` and a count; an empty tray says to buy furniture at the shop counter in the lobby). The bar got a Pick up button (`ui/arrange-bar.ts`).
- Out of scope, as planned: the tray does not sell, and the recorded demo has no tray (arrange mode is off there).

### Tests
- shared (`inventory.test.ts`): the inventory rules, the file format and its defaults, the two messages, the hotel's place, pick up, move and reset with the refusal table and failing saves, every piece of the template refused for pick up, a floor built with extras, and a fast-check property (any sequence of places, moves, pick-ups and project removals keeps every floor valid, shows exactly the placed pieces, never touches the template and never makes or loses an item).
- world-server: `Economy` plans and commits, write failure, restart, returned floors and hidden pieces, a file from task 2 (`economy-store.test.ts`); gateway (`placing.test.ts`): place, refusals, wall and path, lobby and no economy, pick up and the template protected, move kept in the right file, reset, write failure, restart keeps pieces and numbering, a removed project, a project removed while the server was off, a piece the template no longer lets stand.
- client: carry, preview, place, refusal, turn, Esc, pointer left, last item, pick up, undo dropped, tray and bar render (`arrange-shop.test.ts`).
- Playwright (`e2e/furni-place.spec.ts`): buy a fern at the lobby counter, drag it from the tray onto the floor, reload, it is still there, pick it up; click-then-click placing, a taken tile in red, the template's plant cannot be picked up, Esc. `playwright.config.ts` seeds a scratch wallet with 500 Ecto and an empty inventory before the web servers start (not in workers).

## Tests (tasks 1 and 2)
- shared: grant rules and the purchase table, a fast-check property (any sequence of grants, replays and purchases keeps `0 <= balance <= BALANCE_MAX`, stock at most 200, and a replayed grant list changes nothing), catalogue checks (the shipped file passes; each refusal), schemas.
- world-server: `GrantTracker` (each reason, a failed job, a review that asks for changes, unknown kind), `Economy` (grants, idempotence, `since`, purchases, files survive a restart, a broken file is moved aside, write failure), gateway (wallet after welcome, toast data, shop panel data before `open_panel`, buy, refusals, no economy).
- client: balance and toast texts, panel state, shop panel render, previews, recipes (the existing test), balance chip.
- Playwright (`e2e/furni-shop.spec.ts`): the balance chip at 1366 and 375 px, and the shop counter (six tabs, 25 cards with a picture and a price, Escape closes it). The open page's tab is disabled, as in the HR and Library panels, so the test clicks only the other tabs. The flow buy, place, reload is task 3 (`e2e/furni-place.spec.ts`). This machine has no Playwright Chromium: run with `E2E_CHANNEL=msedge`.
