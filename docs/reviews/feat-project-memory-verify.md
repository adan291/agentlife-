VERDICT: PASS

Branch `feat/project-memory`, spec `project-memory` (tasks 1-3, all `[x]`). 5 commits over main (task 1, a wip commit from S25, tasks 2 and 3, status).

Commands run:
- `pnpm check`: passes. shared 224, world-server 149, client 472, agent-engine 646 passed (7 skipped), scripts 16.
- No Playwright script covers this spec (the Library tests are Vitest with a DOM). I did not run `e2e`.
- `pnpm security:scan`: NOT clean (2 findings, both in history commit `43feeca`, file `packages/agent-engine/test/memory-store.test.ts`: MEDIUM email-shaped literal, LOW home-folder path). The working tree is clean. This is not an acceptance criterion of the spec, but the push gate blocks pushing this branch (see "Decisions for the user").

## Criteria

| Criterion | Result | Evidence |
|---|---|---|
| 1.1 JSONL per project at `data/memory/<projectId>.jsonl`, entry `{id, kind, text <= 500, sourceTaskId, createdAt}` | PASS | `paths.ts` (`memory: path.join(dataDir, "memory")`); `memory/store.ts` `file()` and `add()`; schema `MemoryEntrySchema`, `MEMORY_TEXT_MAX = 500` in `shared/src/memory.ts`. Test `memory-store.test.ts` "keeps one JSON line per entry in data/memory/<project>.jsonl, valid against the schema" |
| 1.2 Text passes leak scanner and `sanitize` before storing | PASS | `memory/safety.ts` `checkMemoryText` (sanitize as a check, `createLeakScanner`), called in `add`, `update`, `propose`. Tests "paths of any kind", "token formats and NAME=value...", "emails, home folders and the secrets of this machine", "refuses an unsafe text before anything is written", property test "whatever is stored survives sanitize unchanged and fits the cap" |
| 2.1 After `report_ready` a cheap read-only model (Ollama first, else claude-haiku-5.5) proposes at most 5 entries from plan, review, report, as schema-validated JSON | PASS (wiring and logic); model call UNVERIFIABLE live | `jobs/runner.ts` `announceFinished` after `deliver`; `engine.ts` `onFinished -> learner.start`; `memory/learn.ts` (`ReplySchema`, `runStructured` with one retry, `slice(0, MEMORY_PROPOSALS_MAX)`, prompt from plan, review and report digest); `team/service-agents.ts` read-only `memory` agent. Tests "proposes at most five entries, checked and not stored", "asks once more when the reply is not valid, then gives up", "the prompt holds the plan, the review and the sections of the report, as data, and not the diff", "works through the intern: the local model first, the cheap model when Ollama is down", "a delivered job leads to proposals..." (HTTP) |
| 2.2 Proposals shown in the report ("Remember this?"), stored only on accept, or automatically with auto-remember | PASS | Store: tests "accepting stores the entry...", "dismissing removes a proposal and stores nothing", "auto-remember is off until switched on, per project, and survives a restart"; learner: "proposes ... not stored", "stores the proposals at once when the project auto-remembers"; HTTP "with auto-remember the notes are stored without asking". UI: `client/src/ui/library.ts` `renderRememberCard`, wired in `mailbox.ts:38`; `client/test/library.test.ts` "Remember this? card" (4 tests), "shows in the open report of the mailbox, not in the list and not for the morning summary" |
| 3.1 Architect, Developer and QA prompts include the project's memory, newest first, capped at 4 000 chars, as data in a delimited block | PASS | All 10 role templates carry `{{memory}}` and list memory in the untrusted-content rule (checked with a grep of `prompts/*.md`). Architect: `steps/analyze.ts` (test `analyze.test.ts` "gives the Architect the project's memory, and says (none) without one"). QA: `steps/review.ts`, `steps/review-branch.ts` (test `review.test.ts` "puts the project's memory in the prompt as fenced data, relevant notes first"). Developer: `steps/develop.ts:53` calls `memoryBlock` (read; no test asserts the Developer prompt). Block: `memory/retrieve.ts` `memoryBlock` / `memoryLines` (cut between entries, fence longer than any backtick run); tests "memoryBlock is capped at 4 000 characters of notes, newest first, inside a fence", "memoryBlock cannot be closed by a note..." |
| 3.2 Retrieval ranks by keyword overlap with goal and files; embeddings optional | PASS | `memory/retrieve.ts` `keywords`, `rankMemories`; tests "ranks by shared keywords and keeps newest first among equals", "ranking never loses or invents an entry". Embeddings not implemented, allowed by "MAY" (recorded in design.md) |
| 4.1 Library shelf on each project floor opens a memory panel: list by kind, search, edit, delete, source job | PASS (logic); look UNVERIFIABLE | Shelf: `world-server/rooms/project-template.json:44` (`library_shelf_1`), panel `library` in `client/src/ui/panels.ts`; `ui/library.ts`; messages through gateway. Tests `client/test/library.test.ts` "lists the notes by kind with their source job...", "filters by every search word and by kind", "saves an edited note...", "asks twice before it deletes", "searches the notes without drawing the whole panel again", "links a note to its job's report..."; `world-server/test/library.test.ts` "edits, deletes, accepts, dismisses and switches auto-remember..."; `shared/test/memory-protocol.test.ts` |
| 5.1 Tests: rejects secrets and paths; caps and ordering; prompt block delimited and capped; ranking on fixtures; proposal JSON validated and limited to 5 | PASS | Rejection: `memory-store.test.ts` (`describe "what the Library refuses"`); caps and ordering: "lists newest first, also for entries added in the same millisecond", "refuses repeated text ... and a full Library"; block: `memory-learning.test.ts` retrieval tests; ranking fixture: "ranks by shared keywords..."; proposals: "proposes at most five entries" and `memory-store.test.ts` "keeps at most five per job, checks each one..." |

## To fix

None blocking.

Small gaps (not criteria failures):
- No test asserts that the Developer prompt (`steps/develop.ts`) carries the memory block, nor that every role template contains `{{memory}}`. Add one test in `develop.test.ts` (fake runtime, read the prompt) and one that loads all 10 templates.

## Human checks

1. Live librarian: after a real job (`RUNTIME` unset, Docker running), the report shows "Remember this?" with up to 5 notes. Test with Ollama `qwen3.5:4b` running and with it stopped (fallback to `agentlife-memory` on `claude-haiku-5.5`). The `agentlife-memory` agent file must pass `kiro-cli agent validate`; the engine only logs a warning if it does not.
2. A second job on the same project: the engine's raw log of the Architect prompt shows the notes in the fenced "Project memory" block.
3. Browser: shelf on a project floor opens the Library with the Memory and Write docs tabs; list by kind, search, edit, two-step delete, link to the source report, auto-remember switch, long notes, and the "Remember this?" card in the report viewer.
4. Removing a project from the Reception deletes its `data/memory/<id>.jsonl`.

## Decisions for the user

- `pnpm security:scan` fails because of history commit `43feeca` (email-shaped literal and home-folder path in a test file). The working tree no longer has them. Either rewrite that commit or add an entry to `scripts/security-allow.json`. Until then the push gate blocks pushing this branch. Do not merge or push before deciding.
