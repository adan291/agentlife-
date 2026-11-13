# Design Document: furni-shop

Pure rules live in `@agentlife/shared` (`economy.ts`). The world-server owns the files and decides what is granted (`economy-store.ts`, `grants.ts`, gateway). The client only shows the balance and the shop and sends two messages. The agent-engine does not change. Tasks 1 and 2 are described here; task 3 (placing) is sketched at the end so the files written now do not have to change.

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
- Stock counts items not placed. Task 3 adds a `placed` map (project id to placed pieces) with a schema default, so a file written now stays valid.
- The cap is 200 items in stock (`INVENTORY_MAX`). A purchase that would make it 201 is refused.

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

## Task 3 (not built now)
Placing: the Inventory tray in arrange mode lists the stock; dragging one onto a floor sends a placement that the server checks with `checkMove`'s rules and records in `placed`; picking up returns it; removing a project returns its pieces; template pieces are never sold or picked up. The wire shape is decided in task 3's own session and recorded here.

## Tests (tasks 1 and 2)
- shared: grant rules and the purchase table, a fast-check property (any sequence of grants, replays and purchases keeps `0 <= balance <= BALANCE_MAX`, stock at most 200, and a replayed grant list changes nothing), catalogue checks (the shipped file passes; each refusal), schemas.
- world-server: `GrantTracker` (each reason, a failed job, a review that asks for changes, unknown kind), `Economy` (grants, idempotence, `since`, purchases, files survive a restart, a broken file is moved aside, write failure), gateway (wallet after welcome, toast data, shop panel data before `open_panel`, buy, refusals, no economy).
- client: balance and toast texts, panel state, shop panel render, previews, recipes (the existing test), balance chip.
- Playwright (`e2e/furni-shop.spec.ts`): the balance chip at 1366 and 375 px, and the shop counter (six tabs, 25 cards with a picture and a price, Escape closes it). The open page's tab is disabled, as in the HR and Library panels, so the test clicks only the other tabs. The flow buy, place, reload is task 3. This machine has no Playwright Chromium: run with `E2E_CHANNEL=msedge`.
