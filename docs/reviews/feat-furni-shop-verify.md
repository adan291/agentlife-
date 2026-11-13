VERDICT: PASS

Spec: furni-shop (tasks 1, 2, 3, all marked `[x]`). Branch: `feat/furni-shop`, 6 commits ahead of `main`.

Commands run:
- `pnpm check`: exit 0. shared 362 tests, world-server 279, client 624, agent-engine 678 (7 skipped), scripts 16. All pass.
- `E2E_CHANNEL=msedge pnpm --filter @agentlife/client e2e`: 61 passed (includes `furni-shop.spec.ts` 5 tests and `furni-place.spec.ts` 3 tests, and the job-insight and shell tests that the balance chip once broke).

## Criteria

| Criterion | Result | Evidence |
|---|---|---|
| 1.1 wallet in `data/wallet.json`, git-ignored | PASS | `.gitignore:7` (`data/`), `git check-ignore` matches `data/wallet.json` and `data/inventory.json`; `economy-store.ts` `defaultWalletFile` |
| 1.1 atomic write | PASS | `json-file.ts` `writeJsonFile` (tmp file then rename); test `economy-store.test.ts` "writes through a temporary file: no .tmp is left behind" |
| 1.1 unreadable file moved aside, never overwritten | PASS | `json-file.ts` `readJsonFile`; tests `economy-store.test.ts` "moves an unreadable file aside, starts empty and never overwrites the old content" and "moves a file that fails the schema aside too" |
| 1.1 ledger of last 200 entries (amount, reason, task id, time) | PASS | `shared/src/economy.ts` `LEDGER_MAX`, `LedgerEntrySchema`, `applyGrant`; test `economy.test.ts` "keeps the last 200 ledger entries and the last 2000 keys" |
| 1.2 grants only from engine events, once per task and reason | PASS | `gateway.ts:947` feeds `GrantTracker.observe` from `onEngineEvent`; `applyGrant` key `<reason>:<ref>`; tests `economy.test.ts` "counts each reason and ref once", `wallet-gateway.test.ts` "adds nothing when the same events come again, also after a restart of the gateway" |
| 1.2 delivered job with verdict pass | PASS | `grants.ts` (`job_passed`); tests `grants.test.ts` "pays job_passed when a job is delivered with a pass verdict", "pays nothing for a fail verdict...", "...a job that failed on the way..."; `wallet-gateway.test.ts` "pays a delivered job with a pass verdict once..." |
| 1.2 branch delivered to the user's repository | PASS | `grants.ts` `delivery.done`; `wallet-gateway.test.ts` "pays a branch review that asked for changes, and the delivery of a branch" |
| 1.2 branch review finished | PASS | `grants.ts` (`review_finished`); `grants.test.ts` "pays review_finished for a delivered branch review whatever it found", "pays nothing for a branch review that failed" |
| 1.2 memory note accepted | PASS | `gateway.ts:865-873` (grant after `memory.accept` succeeds, ref = `sourceTaskId`); tests `wallet-gateway.test.ts` "pays an accepted note once per job", "pays nothing for a dismissed note or an unknown proposal" |
| 1.2 morning summary with at least one finished night job | PASS | `gateway.ts:401` (`s.counts.done >= 1`); tests `wallet-gateway.test.ts` "pays a morning summary in which a job finished, and not one in which none did", "announces a night grant that arrives while the user is connected" |
| 1.2 amounts in `config/economy.json` | PASS | `packages/world-server/config/economy.json`; `EconomyConfigSchema` requires all five reasons; test `economy-store.test.ts` "ships a config that passes the schema", "grants the amount from the config for each reason and saves it" |
| 1.3 no client message adds Ecto | PASS | Client messages in `protocol.ts` are only `shop_state` and `shop_buy` for the economy; test `wallet-gateway.test.ts` "lets no client message add Ecto" (forged `wallet`/`grant` get `bad_message`, balance stays 0) |
| 1.3 replayed event adds nothing | PASS | `economy-store.test.ts` "counts a grant once, also across a restart (a gateway replay)"; `economy.test.ts` property "replaying the sequence changes nothing" |
| 1.4 balance chip top left of the stage, always visible | PASS | `hud.ts:18` (`.al-balance` absolute, top/left), `hud.ts:151` mounted in `stage`; e2e `furni-shop.spec.ts` "is visible on the stage at 1366x768" and "...375x667", "does not overflow the top bar at 1366 px"; full e2e suite passes (stepper tests included). Chip is hidden before the first `wallet` message by design (no economy); see human checks |
| 1.4 grant toast "+20 Ecto: branch delivered" | PASS | `client/src/main.ts:427-429` (`hud.toast(grantToastText(msg.grant), GRANT_TOAST_MS)`); text asserted in `economy.test.ts` "has a label for every reason, and the toast reads like the spec" and `client/test/wallet.test.ts`. The toast display itself is not asserted by a browser test |
| 2.1 shop counter in the lobby opens the Shop panel | PASS | `rooms/lobby.json:31` (`shop_counter` at 4,4), `furni.ts:63` (`interaction: "shop"`); e2e `furni-shop.spec.ts` "opens the Shop panel with 25 pictures..."; `catalogue.test.ts` "stands in the lobby only, facing south..." |
| 2.1 pages Seating, Tables, Lights, Plants, Spooky, Walls | PASS | `shop.ts` `SHOP_PAGES`/`PAGE_LABELS`; e2e asserts the six tab names and at least 4 cards per page |
| 2.1 price, size, preview from the room's renderer | PASS | price: e2e checks `.al-shop-price` `^\d+ Ecto$`; size: `client/src/ui/shop.ts` `sizeText`, test `shop.test.ts` "writes the size of the footprint..."; preview: `scene/previews.ts` uses `sprites.furni(defId, 4)` through the renderer's extract, e2e checks each `img` is a PNG data URL with width > 8 |
| 2.2 at least 24 items, each mapped to a `FURNI_CATALOG` definition with own art | PASS | `config/catalogue-furni.json` has 25 items; `checkCatalogue` (`shop.ts`); tests `catalogue.test.ts` "sells at least 24 items, each mapped to a decorative definition with its own drawing", `shop.test.ts` "has 25 decorative pieces and the shop counter", "asks for at least 24 items"; recipes test checks all four facings (cited in design.md; `pnpm check` passes) |
| 2.2 decorative only | PASS | `checkCatalogue` refuses any def with an `interaction` and `agent_desk`; tests `shop.test.ts` "refuses a duplicate id, an unknown piece...", `catalogue.test.ts` "is checked at load: a duplicate or a template piece stops the shop from opening", `inventory.test.ts` "every item of the shipped catalogue can be shown on a floor, and none is a piece that starts work" |
| 2.3 purchase is a server-checked client message (known item, enough Ecto, below 200) | PASS | `gateway.ts:246-253` `buyItem`; `shop.ts` `applyPurchase`; tests `shop.test.ts` "answers the first rule that fails and changes nothing", "allows the 200th item and refuses the 201st", `shop-gateway.test.ts` "refuses with the reason and changes nothing" |
| 2.3 refusal says why and changes nothing | PASS | `shop-gateway.test.ts` "refuses with the reason and changes nothing"; `economy-store.test.ts` "refuses with the reason and changes nothing and writes nothing" |
| 3.1 bought items go to `data/inventory.json` | PASS | `economy-store.ts` `buy`; tests `economy-store.test.ts` "takes the price, adds the item to the stock and writes both files", "keeps the balance and the stock across a restart"; `shop-gateway.test.ts` "keeps what was bought when the world-server restarts" |
| 3.1 inventory tray in arrange mode; place on a project floor with the move checks | PASS | `ui/arrange-tray.ts`, `ui/arrange.ts`; `hotel.ts` `placeFurniture` runs `checkMove`; tests `placing.test.ts` "places an item from the stock...", "a wall piece goes on a wall only, and a piece that blocks the way is refused", `inventory.test.ts` "places a piece through the checks of a move..."; client `arrange-shop.test.ts`; e2e `furni-place.spec.ts` (drag from tray, click-then-click) |
| 3.1 pick up returns it to the inventory | PASS | `placing.test.ts` "picks a bought piece up into the stock..."; e2e `furni-place.spec.ts` first test ends with Pick up and the tray count restored |
| 3.2 template furniture not sold | PASS | `checkCatalogue` (template/interaction pieces refused); `shop.test.ts` / `catalogue.test.ts` as above |
| 3.2 template furniture not picked up or removed | PASS | `hotel.ts` `pickUpFurniture` answers `not_removable` for non-extras; tests `placing.test.ts` "...refuses every piece of the template", `inventory.test.ts` "picks up a bought piece, never a piece of the template" and the property "never touches the template"; e2e `furni-place.spec.ts` "a piece of the template cannot be picked up" |
| 3.3 removed project returns its placed items | PASS | `gateway.ts:325-333` (`returnAbsentFloors`); tests `placing.test.ts` "a removed project gives its placed pieces back, also when it was removed while the world-server was off", "a project that vanished while the world-server was off returns its pieces on the first look at the engine", `inventory.test.ts` "a removed project gives its pieces back and leaves the other floors alone" |
| 4.1 property test: balance never negative, replay changes nothing | PASS | `shop.test.ts` "never makes the balance negative, never passes the stock cap, and replaying the grants changes no balance" (fast-check, grants and purchases); `economy.test.ts` "any sequence of grants keeps 0 <= balance <= BALANCE_MAX, and replaying the sequence changes nothing" |
| 4.2 each grant reason | PASS | `grants.test.ts` and `wallet-gateway.test.ts` (all five reasons) |
| 4.2 refused purchases | PASS | `shop.test.ts`, `shop-gateway.test.ts`, `economy-store.test.ts` |
| 4.2 place and pick up | PASS | `placing.test.ts` |
| 4.2 removed project returns items | PASS | `placing.test.ts` (two tests, see 3.3) |
| 4.2 files survive a restart | PASS | `economy-store.test.ts` "keeps the balance and the stock across a restart", "keeps the pieces and the numbering across a restart"; `placing.test.ts` "a restart builds the floor with the pieces and the stock the user left" |
| 4.3 Playwright: buy, place on a floor in arrange mode, reload, still there | PASS | `e2e/furni-place.spec.ts` "buy a fern, drag it from the tray onto the floor, reload: it is still there; pick it up" passed (ran 2026-11-13 with Edge). Purchase is done through the UI (`buyFern`) |

## To fix

Nothing.

## Human checks

- Open the app against the real engine, look at the balance chip in the top left of the stage and confirm it does not cover the Arrange button, the floor label or the tray at your usual window size. The e2e tests prove it is visible and does not push the top bar, not that it looks right.
- Earn a grant for real (for example deliver a branch) and confirm the "+N Ecto: ..." toast shows for about 4 s. No browser test asserts the toast; the wiring is `client/src/main.ts:429`.
- Look at the 25 previews in the Shop panel and the placed pieces on a floor, to judge the art (own recipes, drawn in code). The e2e only checks that each preview is a non-empty PNG.
- With the real wallet (not the Playwright scratch wallet), confirm the first run starts at 0 Ecto and old jobs pay nothing (`since` rule). Covered by `wallet-gateway.test.ts` "does not pay for events older than the wallet", but not run against real history.
- Note, not a failure: `docs/reviews/feat-furni-shop.md` (an earlier, untracked review) already exists; this report is a separate file.
