# Spike: kiro-cli (agent-pipeline task 1)

Status: FAILED on one check (write outside cwd is not denied). Task 1 not marked done.

Script: `packages/agent-engine/spikes/kiro-cli-spike.mjs` (run with `node --env-file=.env ...`). Agent used: `data/kiro-home/agents/spike-ro.json` (git-ignored). All calls used `--model claude-haiku-5.5`, `--no-interactive --output-format stream-json --trust-all-tools`, `KIRO_HOME=data/kiro-home`, cwd = temp repo, minimal env.

## Results
| Check | Result |
|---|---|
| kiro-cli version | 3.1.0 (design assumed 2.34) |
| Auth with KIRO_API_KEY and empty KIRO_HOME | OK. Runs complete, exit 0 |
| `--agent` lookup from `KIRO_HOME/agents` with cwd in another repo | OK |
| Missing agent | exit 4, `runError` record: `agent "<name>" not found, stopping (exit 4)` (stage `init`) |
| `kiro-cli agent validate --path` | OK (silent, exit 0) with the reviewer-style syntax (`permissions.rules` with `capability`, `match`, `effect`) |
| Write inside cwd | OK, file created |
| Shell denied (`shell` rule `**` deny) | OK, `shell.txt` not created |
| Write outside cwd denied | FAIL. `outside.txt` was created in the temp dir despite rules `fs_write allow ./**` and no other fs_write allow |

## stream-json shape
One JSON object per line, `{"type": ..., "data": {...}}`. Types seen: `runStarted`, `sessionUpdate`, `runFinished`, `runError`. `sessionUpdate.data.update.sessionUpdate` carries sub-kinds: `available_commands_update`, `config_option_update`, `session_info_update` (context usage), `agent_thought_chunk`, `tool_call` (`title`, `kind`, `status`, `locations`, `rawInput`), `tool_call_update` (`status`: pending, ...). Exit code 0 on success, 4 on missing agent. Stdout per run is 25-60 KB, mostly session updates. Stderr is 69 bytes on success runs (content not inspected).

## Run timings (haiku-5.5)
read 13.4 s, write-cwd 17.8 s, write-outside 17.8 s, shell 14.0 s, missing agent 9.8 s.

## Not yet verified
- Credits per run (no credit field found yet in the records examined; check `runFinished`).
- Whether the outside write is blocked without `--trust-all-tools` (non-interactive denies unapproved tools?) or with an explicit `fs_write deny` for paths outside cwd.
- `--agent-engine v2|v3` differences.

## Impact
The security rule "Developer may write only inside its task worktree" cannot rely on the agent's fs_write allow rule under `--trust-all-tools`. Candidate mitigations to test next (not applied, needs user decision): drop `--trust-all-tools` and use `--trust-tools` with an explicit list; add an explicit deny for absolute/outside paths; or enforce containment in the engine (diff validation plus checking that nothing outside the worktree changed).
