# Review: feat/furni-shop against main

Spec: `.kiro/specs/furni-shop` (tasks 1-3, all marked done).
Commits: 6 on the branch, one per task plus a wip commit and a STATUS update.
`pnpm check`: passes (typecheck, shared 362 tests, world-server 279, client 624, agent-engine 678 with 7 skipped, scripts 16).

## Verdict: request changes

One blocking issue, small fix.

## Blocking

1. `packages/world-server/src/gateway.ts:331-332` (and `economy-store.ts:235-236`): the visible-piece set is built from `hotel.sim(roomId)?.room.furni`. If the sim is missing, `visible` is an empty set, and `returnHidden` moves every bought piece of that project back to the stock. The user's pieces leave the floor without a reason. This is a fail-open path on a data-moving call. Fix: skip the project when `hotel.sim(...)` is undefined (`continue` before calling `returnHiddenPieces`). Add a test where the room is absent.

## Requirements claimed as done but not verified in this review

- Requirement 4.3 (Playwright: buy, place, reload, still there): `packages/client/e2e/furni-place.spec.ts` and `furni-shop.spec.ts` exist. I did not run them (Playwright needs a browser; STATUS says Edge via `E2E_CHANNEL=msedge`). Run them before merge and check that the test reloads the page.
- Requirement 2.1 (shop counter on the lobby, pages, previews drawn by the room renderer): the client code exists, but I did not check the `shop_counter` furniture or the preview rendering.

## Checked and fine

- Boundaries: the client sends only `shop_*` and `furni_*` messages to the world-server. The world-server does not call a model. Engine-side wording stays in semantic terms.
- Ecto is granted only from engine events (`GrantTracker` in `grants.ts`) or from the verified memory accept and morning summary. No client message adds Ecto (`ClientMsgSchema` has `shop_buy` and `furni_*` only).
- Idempotency: `applyGrant` keys by `reason:ref`; replayed events do not change the balance (property test in `shared/test/economy.test.ts`, 40 generated sequences).
- Purchases: refused with reasons and no change (`shop-gateway.test.ts`). Inventory file is written before the wallet and rolled back if the wallet write fails.
- Files: `data/wallet.json` and `data/inventory.json` are under `data/` (git-ignored). Writes are atomic (`json-file.ts`, temp file and rename). An unreadable file is moved aside, not overwritten.
- Config: `catalogue-furni.json` is checked against `FURNI_CATALOG` (`checkCatalogue`) at startup.
- Portability: no `new URL(...).pathname` for file paths; paths use `node:path` and `fileURLToPath`. No bash-only scripts in the diff.
- Security: no Habbo names or assets in the diff. No secrets in logs.

## Missing tests

- The blocking case above has no test.
- No test for a corrupt `wallet.json` at startup (the file is moved aside and the balance starts at 0; the spec asks for this rule, but the test is not visible in the diff).

## Non-blocking suggestions

1. `gateway.ts` (memory accept): `grantEcto("memory_accepted", source, Date.now())` uses `Date.now()` while the rest of the gateway uses the injected `clock`. Use `clock()` so tests control the time.
2. `economy.ts`: `granted` keeps the last 2000 keys. A replay of events older than that window could pay again if their timestamp is after `since`. Low risk with today's replay size; note it in design.md.
3. A corrupt `wallet.json` resets the balance to 0 and only logs a warning. Consider a visible message to the user on the next welcome.
4. `economy-store.ts`: `grant()` and `buy()` each write the file on every call. Fine at this volume; no change needed now.
