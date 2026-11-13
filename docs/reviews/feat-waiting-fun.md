# Review: feat/waiting-fun against main

Verdict: request changes (one correctness issue in the daily wisp limit; the rest is non-blocking).

`pnpm check` passes: shared 440, client 678, world-server 399, agent-engine 680 (7 skipped), scripts 16 tests.

## Blocking issues

1. Daily wisp limit can be exceeded (packages/shared/src/fun.ts:45, packages/world-server/src/wisps.ts `canPay` and `take`).
   `wispsToday` counts `wisp_caught` entries in `wallet.ledger`. The ledger keeps only the newest `LEDGER_MAX` = 200 entries (packages/shared/src/economy.ts:10). On a busy day, other grants (`job_passed`, `branch_delivered`, `quest_done`, ...) push old wisp entries out of the ledger, so the count drops and catches above 50 per day can pay. Why it matters: the 50 per day limit is a stated requirement (task 1, requirement 4.x) and an economy rule; Ecto is the currency of the shop.
   Fix: keep a day counter in the wallet (for example `wispsDay` and `wispsCount`, reset on a new local day), or count from `grantedKeys` with the day in the key. Add a test that fills the ledger with 200 other grants and checks that the 51st catch does not pay.

## Requirements claimed as done but not verified

- Task 2 says "mood from work time". The mood lives only in memory (`MoodKeeper`, packages/world-server/src/mood.ts). This is documented in the spec and STATUS.md, so it is not a defect, but the requirement wording should say "for this session" if it is accepted as written.
- Requirement check: I did not compare every acceptance criterion in `.kiro/specs/waiting-fun/requirements.md` line by line with the code. The review covered the server rules (`wisps.ts`, `mood.ts`), the protocol (`protocol.ts`) and the test results.

## Boundaries and security (checked)

- Client sends only to the world-server: the client changes use the existing WebSocket protocol (`wisp_catch`, `emote`, `shop_buy`). No new client fetch to another host was found (grep over client/shared/world-server src).
- The world-server does not call a model: no new model calls in the diff.
- Agent-engine is not changed in this branch (no diff under packages/agent-engine).
- Client messages go through `ClientMsgSchema` (zod) in the gateway, so the new `wisp_catch` and `emote` payloads are validated.
- No `new URL(...).pathname` as a file path and no bash-only scripts in the diff.
- The grant reason `wisp_caught` is a shared enum value and is validated by `GrantReasonSchema`.

## Missing tests

- No test for the ledger-trim case described in blocking issue 1.
- Property-based tests exist for the mood rule (`packages/shared/test/fun.test.ts`, "more work is never a better mood"). No fast-check property covers the wisp limits (per job, per day, one wisp at a time) or the mood time arithmetic (day roll, open interval cap, backwards timestamps) in `wisps.test.ts` or `mood.test.ts`. Those are the next candidates.

## Non-blocking suggestions

1. `mood.ts` `observe`: an event with an older timestamp is ignored only per slot (`lastTs`). Events from a restarted replay can still switch state early; a short note in the design would make that explicit.
2. `wisps.ts` `take`: when the spot differs (another floor or job), the wisp stays. That is correct, but a comment saying so would help the next reader.
3. `Wisps.spawn` calls `sweep` before checking `this.wisp`; a single `current` read would be easier to follow.
4. The e2e tests need the three test servers stopped (ports 8795 to 8797) because of in-memory wallets. Add that to the e2e README section, not only to STATUS.md.
5. `fun.ts` hard-codes 20 to 60 s and 8 s defaults in two places (`wisps.ts` imports constants, the gateway doc comment repeats the numbers). Keep one source.
