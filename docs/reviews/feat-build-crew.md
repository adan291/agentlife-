# Review: feat/build-crew (spec: build-crew, tasks 1-4)

Reviewed commits: 977209c..6a3ea28 against main. `pnpm check` passes (typecheck and 226 tests across shared, client, world-server, agent-engine and scripts).

## Verdict: request changes

One blocking issue: the runner can send environment values to the engine and, from there, to every connected client.

## Blocking

### 1. Environment values leak into crew text (scripts/crew-map.ts:49-60, 111-112)

`commandLabel` returns the first word of a shell command when it is not a known tool. A command that starts with an environment assignment therefore returns the assignment itself, value included:

```
command: "ENGINE_TOKEN=s3cret-value pnpm check"
-> activity "run", text "running ENGINE_TOKEN=s3cret-value"
```

`sanitize` (line 14) removes drive paths, rooted paths and `ksk_` tokens, but not `NAME=value`. PowerShell forms such as `$env:KIRO_API_KEY='...'` pass through the same way. The text is then posted to the engine, stored in the event log, streamed over SSE to the world-server and shown in a speech bubble. This breaks design.md ("no environment values") and requirement 3.2, and the security rule that secrets are never sent to the client. The property test (`scripts/test/crew-map.test.ts`) does not catch it because its `FORBIDDEN` pattern covers only drive paths and `ksk_`.

Fix: in `commandLabel`, skip leading `NAME=value` and `$env:...` tokens, and accept a tool name only if it matches `/^[A-Za-z][\w.-]*$/`. Otherwise return "" so the text becomes "running a command". Add unit tests for `ENGINE_TOKEN=... pnpm check`, `$env:X='...'; pnpm test` and a quoted value, and extend the property test with an `=` and `$env:` alphabet.

## Requirements claimed done but not fully met

- Requirement 3.4 says reporting "never delays" a session. `scripts/run-session.ts:263` and `:283` `await` the `started` POST before kiro-cli spawns. With the engine down, a connection refusal is immediate, but a hung engine adds up to 1 s per POST. Either fire-and-forget these calls or accept the 1 s and correct the wording.
- Requirement 2.5 says at most one `agent.say` every 3 s. `packages/agent-engine/src/crew.ts:52` (`finished`) and the `started` say bypass the throttle. This is recorded in design.md ("Implementation notes"), so it is an accepted deviation, but the requirement text should say so too.
- Task 5 (manual check) is open, as STATUS.md says. Client ghost rendering and the builder desk have not been seen in a browser.

## Missing tests

- No test for the env-assignment case above (blocking fix).
- No test for `crew()` in run-session.ts: best-effort behaviour, one warning, `AGENTLIFE_CREW=0`. `scripts/run-session.ts` is not typechecked (noted in STATUS.md), so a type error there would pass `pnpm check`.
- Requirement 1b.2 (ghost bob) and the mirrored directions have no client test that I could find in the diff; `ghostFrame` is only exercised through the avatar view.

## Checked and fine

- Boundaries: the client only talks to the world-server; the engine uses anchors (`desk`, `home`) and no tiles or sprites; no model call in the world-server.
- Engine route `POST /crew/events` goes through the shared token check and the 64 KB body limit, and it validates with `CrewEventSchema`. It emits only `agent.*` events under `build:<session>`, and a test confirms no job view is created.
- The store redacts every appended event, so the engine side has a second filter.

## Non-blocking suggestions

1. `scripts/crew-map.ts:14`: `sanitize` runs a fixed five passes. Fine for now, but a single regex pass with a lookbehind would be simpler to reason about.
2. `packages/client/src/scene/crew-label.ts`: the `R` label rule also matches a say text that starts with a lone `R` word. Low risk, but a stricter prefix like `R ` followed by a known marker would be safer.
3. `packages/client/src/palette.ts`: builder colour `0xc9b6ff` is close to QA `0xb06bff`. Check them side by side in the browser (task 5) before the demo.
4. `scripts/run-session.ts`: the review run reuses `session.spec`, so the review label shows the spec of the build session. Intended, but worth a comment.
