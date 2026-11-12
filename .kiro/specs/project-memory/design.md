# Design: project-memory (The Library)

Decisions made while implementing tasks 1 to 3. The requirements did not need a design before; this records what the code does.

## Store (task 1)
- `packages/agent-engine/src/memory/store.ts`: `data/memory/<projectId>.jsonl` (entries, oldest first on disk, newest first from `list`), `<projectId>.proposals.json` (suggestions waiting for the user, at most 50), `_settings.json` (per-project auto-remember, off by default).
- Every text goes through `checkMemoryText` (`safety.ts`): one line, at most 500 characters, refused (not cleaned) when `sanitize` would change it, and refused when the shared leak scanner finds a key format, an email, a home folder or a secret of this machine's environment. A project holds at most 200 entries; a repeat (case-insensitive) is refused.
- A damaged line is skipped; before the file is rewritten the original is copied to `<file>.bad-<time>`.

## Learning (task 2)
- `MemoryLearner` (`memory/learn.ts`) runs from `JobRunner.onFinished`, after the report is delivered, without being awaited. It reads the goal, plan, review and the Summary / Failure / Findings / Review / Notes sections of the report (never the diff or the test log) and asks for at most 5 entries as a fenced JSON block, validated by `MemoryDraftSchema` (one retry, as for the plan). A failed or invalid answer costs nothing: it is logged.
- Model: the Night intern runtime. Step name `memory` is on `INTERN_STEPS`, so Ollama (`night-intern` template model) answers first and `agentlife-memory` (a new read-only service agent, "Librarian") on `claude-haiku-5.5` answers when Ollama cannot. `EngineOptions.memory.runtime` replaces it in tests. Under `RUNTIME=fake` there is no learner.
- Proposals are stored in `proposals.json`. The user accepts (optionally with an edited text and kind), dismisses, or switches auto-remember: then `learn` accepts each proposal itself and leaves in the list only those the store refuses (Library full).
- Jobs of kind `audit-deps` are not learned from (they list today's package versions).
- Not done: embeddings (`nomic-embed-text`). Requirement 3.2 makes them optional; keyword overlap is enough for a few hundred short notes.

## Retrieval (task 2)
- `memory/retrieve.ts`: keywords of the goal and of the files (camelCase split, stop words, plural folded), score = number of shared keywords, ties keep newest first. `memoryBlock` cuts at 4 000 characters between entries and wraps the lines in a fence longer than any backtick run inside, so a note cannot close it.
- The nine role templates (`architect`, `developer`, `qa` and the kind variants) carry `{{memory}}` and say in their untrusted-content rule that the project memory is data and may be out of date. `memory-propose.md` is the template of the librarian.
- A Library that cannot be read gives "(none)": a job never fails because of its memory.

## HTTP (task 2)
- `GET /projects/:id/memory` returns `{ entries, proposals, autoRemember, learning }` (`learning` = ids of jobs the librarian is still reading). `PATCH` and `DELETE /projects/:id/memory/:entryId`, `POST /projects/:id/memory/proposals/:id/accept`, `DELETE .../proposals/:id`, `PUT .../memory/settings`. A refused text is a 400 with code `memory_<reason>` and a message that never repeats the text. Removing a project deletes its Library.

## Library panel (task 3)
- Protocol: client `memory_state` and `memory_do { act }` (`edit`, `delete`, `accept`, `dismiss`, `auto`), server `memory { projectId, state }`, error code `memory_error`. The project is always the user's floor; in the lobby and the HR office the gateway answers `bad_message`. The scripted engine and the demo have no `memory` link: the gateway answers `engine_unavailable` and the panel says the Library is off in the demo.
- The shelf keeps its interaction `library` (it is the furniture of the `document` job). The panel now has two tabs: "Memory" (proposals waiting for a decision, a search box, a kind filter, notes grouped by kind with their source job and a button to its report while the floor still has it, edit, two-step delete, auto-remember) and "Write docs" (the form it had before). Decision: reuse the shelf instead of adding a second piece of furniture, so the floor does not get another sprite and the name "Library" fits both.
- "Remember this?" is a card in the report viewer (`renderRememberCard`): this job's proposals with Remember and Skip, and the auto-remember switch. It says "reading this job" while the librarian works and is absent when there is nothing. The client asks for the state when a report is opened and every 4 s while the librarian is still reading the job on screen. The morning summary (kind `night`) has no card.
- Not looked at in a browser. The gateway pushes no memory message on its own: a proposal that arrives while the user looks at another panel shows when the report or the shelf is opened.
