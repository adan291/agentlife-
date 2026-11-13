# Review: feat/ui-tidy against main

Verdict: approve. No blocking issues found. Two non-blocking points below.

`pnpm check` passes: shared 458 tests, client 706, world-server 415, agent-engine 682 (7 skipped), scripts 16. The Playwright e2e tests of ui-tidy were not run in this review.

## Blocking issues

None.

## Requirements claimed as done but not verified

- Requirement 6.1 (a moved piece selectable again, three moves and two turns without reload) has a Playwright test in `packages/client/e2e/edit-rooms.spec.ts`, and the pick fix is covered by `pickAllFurni` in `packages/client/src/scene/pick.ts`. The e2e run was not executed here, so the browser behaviour is unverified in this review.
- Requirement 1.3 (no overflow at 360, 800, 1366 px) has a Playwright loop in `packages/client/e2e/ui-tidy.spec.ts`. Not executed here.
- Requirement 4.1 (Builder idle after 10 minutes) is covered by `packages/world-server/test/builder-watch.test.ts` and the sweep in `gateway.ts`. The sweep only changes the lobby sim (`gateway.ts`, `sweepBuilder`). Builder events that carry the id of a known job are routed to that job's floor by `roomOfEvent`, and a stale Builder state there would not be reset. The branch does not show whether a build session ever sends such events, so this is unverified, not a known defect.

## Missing tests

- The property-based tests the spec asks for exist for the layout rules (`packages/shared/test/layout.test.ts`, `packages/client/test/arrange.test.ts`). The new legacy key conversion (`roomKeyOf`) has no test with a project id that matches a room name.

## Boundaries and security (checked)

- Client talks only to the world-server: the new menu, edit and Actions code sends the existing messages (`ClientMsgSchema`). No new fetch or socket.
- World-server does not call a model: no model call in the diff.
- Agent-engine: no change under `packages/agent-engine`.
- Layout keys come from the server side (`userRoom()`), not from the client message, so a client cannot write a layout for another room. The `LayoutsFileSchema` validates the file keys.
- Names of furniture and agents go into refusal reasons (`layout.ts`). The diff adds no `innerHTML` or `insertAdjacentHTML` call.
- No `new URL(...).pathname` as a file path and no bash-only scripts in the diff.

## Non-blocking suggestions

1. `packages/shared/src/layout.ts`, `roomKeyOf`: an old layout keyed by a bare project id is read as a room id when the id is `lobby` or `hr`. A project named `hr` would then apply its arrangement to the HR office. Prefer a rule that reads bare keys as projects unless they are exactly the names of the fixed rooms written in the new form, or migrate once on load. Add a test for a project named `hr`.
2. `packages/shared/src/layout.ts`, `LayoutsFileSchema` transform: if a file has both `haunted-todo` and `project:haunted-todo`, the later key silently overwrites the earlier one. Reject the duplicate or keep the newer one on purpose, and say which.
3. `packages/world-server/src/gateway.ts`, `sweepBuilder`: decide whether a Builder state on a project floor should also go stale. Either add the case or write in the design why it cannot happen.
