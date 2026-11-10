# Spike: kiro-cli (agent-pipeline task 1)

Status: DONE (2026-11-10). One finding changed the design (see "Decisions").

Scripts: `packages/agent-engine/spikes/kiro-cli-spike.mjs` (first pass) and `packages/agent-engine/spikes/containment-spike.mjs` (re-check), both run with `node --env-file=.env ...`. Agents under `data/kiro-home/agents/` (git-ignored). All calls used `--model claude-haiku-5.5`, `KIRO_HOME=data/kiro-home`, cwd = a temp repo, minimal env.

## Results
| Check | Result |
|---|---|
| kiro-cli version | 3.1.0 (design assumed 2.34) |
| Auth with `KIRO_API_KEY` and empty `KIRO_HOME` | OK, runs complete with exit 0 |
| `--agent` lookup from `KIRO_HOME/agents` with cwd in another repo | OK |
| Missing agent | exit 4, `runError` record: `agent "<name>" not found, stopping (exit 4)` (stage `init`) |
| `kiro-cli agent validate --path` | OK with `permissions.rules` (`capability`, `match`, `effect`) |
| Write inside cwd (`fs_write allow ./**`) | OK, file created |
| Shell denied (`shell` deny) | OK, nothing ran |
| Write outside cwd, first pass (default V2 engine + `--trust-all-tools`) | NOT denied: the file was created |
| Write outside cwd, re-check (`--v3`, no `--trust-all-tools`) | Denied for an absolute path and for `../`; nothing created; the CLI reports "tool permission approval is not supported in non-interactive mode" |
| Credits per run | Not exposed in stream-json (no usage field in `runFinished` or session updates; only context-window percentages). Measure from the Kiro usage panel during the live runs (task 12) |

## stream-json shape
One JSON object per line, `{"type": ..., "data": {...}}`. Types: `runStarted`, `sessionUpdate`, `runFinished`, `runError`.
- `sessionUpdate.data.update.sessionUpdate` sub-kinds: `available_commands_update`, `config_option_update`, `session_info_update` (context usage), `agent_thought_chunk`, `tool_call` (`title`, `kind`, `status`, `locations`, `rawInput`), `tool_call_update` (`status`).
- `runFinished.data`: `{ sessionId, status: "success", stopReason: "end_turn", finalText, finalTextTruncated }`. The Architect/QA JSON block is read from `finalText`.
- Exit code 0 on success, 4 on missing agent. Stdout per run 25–60 KB.

## Timings (haiku-5.5)
10–21 s per small call (read 13 s, write 13–18 s, denied write 19–21 s, missing agent 10 s).

## Decisions (applied to the agent-pipeline design)
1. Always run `kiro-cli chat --v3`. The default engine is V2 when no flag is given.
2. Never pass `--trust-all-tools` or `--trust-tools` to product agents. Their grant surface is only the agent file's `allow` rules; anything else is denied in headless mode.
3. Keep the engine-side containment check after the Developer step (diff validation plus "nothing outside the worktree changed") as a second layer.
4. Cost is measured from the usage panel, not from the stream.

## Addendum (agent-pipeline task 4, 2026-11-10)
Script: `packages/agent-engine/spikes/stdin-spike.mjs`.
- The prompt can be written to stdin with no positional input: `kiro-cli chat --v3 --no-interactive --output-format stream-json --agent agentlife-architect` read it, exit 0, 340 stream lines (1 `runStarted`, 338 `sessionUpdate`, 1 `runFinished`), 27 s with haiku-5.5 on the haunted-todo fixture. The final message ended with one json block that parses as a plan.
- `kiro-cli agent validate --path` only checks that the file loads. It accepts an unknown capability and an invalid `effect`, and needs no API key. It is still run for each role agent, but the permission rules are checked by `test/agents.test.ts` (shape) and by the live runs (behaviour).
- Design doc says "a `deny` always wins"; the Developer agent still lists the allowed path and the denied paths as separate rules, so it does not depend on rule order.
