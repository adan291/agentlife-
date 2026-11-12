# Review: feat/project-memory (spec project-memory, tasks 1-3)

Reviewed: `git diff main...HEAD` (51 files, 5 commits), `pnpm check` (passes: shared 224, agent-engine 646 + 7 skipped, world-server 149, client 472, scripts 16), `pnpm security:scan` (fails).
Read in detail: `agent-engine/src/memory/{safety,store,learn,retrieve,routes}.ts`, engine wiring in `engine.ts`, `runner.ts` hook, `steps/review.ts`, `team/service-agents.ts`, `world-server/src/gateway.ts` and `http-engine.ts` memory parts, the design and tasks. Test names of the memory test files were read; the client panel code was checked only for raw HTML insertion (none found).

## Verdict: request changes

## Blocking

1. **Publishing gate fails on this branch.** `pnpm security:scan` reports a MEDIUM finding (`email`, id 5c874b93cbc5) and a LOW finding (`user-home-path`, id 517c2856ec42), both in commit `43feeca` (`packages/agent-engine/test/memory-store.test.ts`). The working tree is clean; the history is not. The project rule says nothing leaves the machine and nothing merges while the scan reports medium or high findings. Fixing it needs a history rewrite or an accepted entry in `scripts/security-allow.json`. Both are the user's decision (security.md). Until then: no push, no merge.

No code defect that blocks the merge was found in the parts read.

## Requirements and spec

- Tasks 1-3 are marked done in tasks.md. The code matches design.md: JSONL per project, proposals file, settings file, checks on every text, one retry for the librarian, the Remember card, the Library tabs.
- Not verified, and the status file says so: the real librarian (Ollama and the `kiro-cli` fallback), the new `agentlife-memory` agent with `kiro-cli agent validate`, a real job whose prompts carry notes, and the Library in a browser. Tests use scripted runtimes.
- Requirement 3.2 (embeddings) is optional and was left out, as design.md records.

## Security and boundaries

- Boundaries hold: the client sends only `memory_*` messages to the world-server; the world-server calls the engine over HTTP and never a model; the engine's memory code does not mention tiles or sprites.
- Project ids are checked by regex before any file path is built (`store.ts` `file()`), and a test covers it.
- Memory text is checked by the same leak scanner and sanitiser as other outgoing text. Refused texts are not cleaned, and the error never repeats the text.
- The panel renders notes as text (no `innerHTML` in the new client files).
- Model output and repository text are treated as data: the memory block is fenced and the prompt says it is data.

## Missing tests

- No test feeds a note that contains an instruction into a role prompt and checks that it stays inside the fence after the template rules. `memoryBlock` fence length is tested, which covers the main break-out.
- No test for `removeProject` leaving the `.bad-*` copies of a damaged file. Low risk.

## Non-blocking suggestions

1. Persistent prompt injection. A note learned from a job can reach the Architect, Developer and QA prompts of later jobs. Auto-remember is off by default and the user approves each note, which limits it. Still, a note that reads like an instruction would reach the Developer, which can write files. Keep auto-remember off in the demo and say so in the README; consider not injecting notes into the Developer prompt until the user has accepted them (they already are, by definition, unless auto-remember is on).
2. `learn.ts` calls the runtime with `role: "qa"` for the `memory` step. The explicit `agent` and `system` decide what runs, so this works, but a reader may take it as QA doing the work. Use `role: "researcher"` (the Librarian's role in its template) or add a comment.
3. `store.ts` `removeProject` deletes the `.jsonl` and proposals but leaves `<file>.bad-<time>` copies. Remove them too, or document that they stay.
4. `gateway.ts` `sendMemory` runs an engine call on every mailbox open for non-lobby floors. Cheap, but a short cache would avoid a request per click if the panel is opened often.
5. Add a line to docs/HUMAN-CHECKS.md for the browser look at the Library tabs and the Remember card, which are the parts with no automated visual check.
