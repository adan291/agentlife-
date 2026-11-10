# Spike: kiro-cli (agent-pipeline task 1)

Status: BLOCKED. Not completed.

## Verified
- `kiro-cli --version` -> 3.1.0 (design.md assumed 2.34).
- `kiro-cli chat --list-models` lists `claude-haiku-5.5` (0.06x credits). All spike calls must use `--model claude-haiku-5.5`.
- `kiro-cli chat` supports `--agent`, `--model`, `--output-format stream-json` (implies `--no-interactive`), `--trust-tools`, `--trust-workspace`, `--agent-engine v1|v2|v3` (default v2), `--require-mcp-startup`.
- `kiro-cli whoami` -> logged in with Google (interactive login).

## Blocker
`KIRO_API_KEY` is not set (environment variable unset; no entry in any `.env*` file). The spike must verify API-key auth with `KIRO_HOME=data/kiro-home` (empty), so no `kiro-cli chat` call was made.

## Pending checks (after the key is configured)
1. Auth with `KIRO_API_KEY` and empty `KIRO_HOME`.
2. `--agent` lookup from `KIRO_HOME/agents` when cwd is another repo.
3. stream-json record shapes, exit codes.
4. Write outside cwd denied; shell denied.
5. Credits per run.
6. Whether `--agent-engine` default (v2) vs v3 changes stream-json or agent JSON syntax.

## Needed from the user
Set `KIRO_API_KEY` (env or git-ignored `.env`) and re-run task 1.
