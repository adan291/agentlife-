# Requirements Document

## Introduction
Today every working agent of the hotel (Architect, Developer, QA, reviewer, researcher) runs as `kiro-cli`. The user asked on 2026-11-16 for the tool to be dynamic: work with any AI, not only Kiro, connect to the ones the user wants (Ollama, Grok and others), and use several at once.

multi-runtime adds **providers**. A provider is either `kiro-cli` (today's runtime) or any API that speaks the OpenAI chat-completions format with tool calling (Ollama, LM Studio, Groq, xAI Grok, OpenAI, OpenRouter and others). Each role, and each hired team member, picks a provider and a model, so one job can mix them (for example Architect on Ollama, Developer on Kiro, QA on Grok).

For a non-Kiro provider the engine itself is the sandbox: the model gets only a few file tools that the engine runs inside the job's folder with the same rules as today. Nothing else changes: the plan approval, the diff validation, the Docker tests, the report and the delivery are the same for every provider. Kiro stays the default. All user-facing text in English.

## Requirements

### Requirement 1: Providers
#### Acceptance Criteria
1. Providers SHALL be listed in `config/providers.json`: `id`, `label`, `kind` (`kiro-cli` or `openai-compat`), and for `openai-compat` a `baseUrl`, an optional `apiKeyEnv` (name of the environment variable that holds the key), `local` (true when the address must be on this computer) and an optional list of suggested models. It ships with: kiro, ollama, lmstudio, groq, xai (Grok), openai, openrouter.
2. A provider SHALL be **available** only when it can work: `kiro-cli` installed; a local provider answering on a loopback address (a `local` provider with an address that is not on this computer is refused); a cloud provider whose key variable is set. Keys come only from the environment or `.env`, never from the client, never in logs or reports.
3. THE engine SHALL answer `GET /providers` with each provider's id, label, kind, local flag, availability with a reason, and models (for Ollama and LM Studio read from the server's model list; for the others the suggested list). No key or address is sent to the client beyond the label.

### Requirement 2: The OpenAI-compatible runtime
#### Acceptance Criteria
1. `OpenAICompatRuntime` SHALL implement `AgentRuntime`: it sends the role's system text and the task prompt to `POST <baseUrl>/chat/completions` with tools, runs the tool calls the model asks for, sends the results back and repeats until the model answers without a tool call; the final text is the step's output, exactly as kiro-cli's output is today (the plan, review and report steps parse it the same way).
2. Tools run by the engine, all limited to the job's folder (`cwd`): `list_files(dir)`, `read_file(path)` (text files, at most 200 KB, a slice of lines), `search(text)`; and for the Developer only `write_file(path, content)`. Paths are resolved inside `cwd` (no `..`, no absolute paths, no links out), and the files the role agents may not read today (`.env*`, keys, credentials, `.npmrc`, `.ssh`, `.aws`, `.git`) are refused. There is no shell, no network and no other tool.
3. Limits per step: at most 40 tool rounds, the step's timeout, a cap on prompt and answer size; going over ends the step with a clear failure. The run reports `progress` events (tool reads and edits, like kiro-cli), `usage` tokens when the API returns them, and `output`.
4. Errors SHALL be clear and safe to show: provider not available, wrong key (401), quota or rate limit (429, retried twice with back-off), model not found, timeout. A cancelled job stops the request.

### Requirement 3: Choosing providers, several at once
#### Acceptance Criteria
1. `config/agents.json` SHALL accept `{ "provider": "<id>", "model": "<model>" }` per role (`runtime: "kiro-cli"` keeps working), so each role can use another provider.
2. A hired team member SHALL have an optional provider; the HR desk SHALL let the user choose provider and model when hiring and change them later, listing only available providers, and saying for a cloud provider "sends the files the agent reads to <label>". A team change applies from the next job, as today.
3. The pipeline editor's second review SHALL accept a member on another provider (another provider counts as a different model).
4. Each step of a report SHALL name its provider and model; the team bar and the tooltip show the provider label.
5. With no change to the config every role SHALL keep using Kiro as today.

### Requirement 4: `pnpm hotel` and docs
#### Acceptance Criteria
1. `pnpm hotel` SHALL pass the known provider keys from `.env` to the engine only (`GROQ_API_KEY`, `XAI_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`) and print which providers are available, never a key.
2. Real agents SHALL be possible without Kiro credits: when no Kiro key is set but another provider is available and configured, `pnpm hotel` starts real agents.
3. `.env.example`, the README and `docs/risks-and-decisions.md` (the decision that the engine is the sandbox for non-Kiro providers, and that a cloud provider receives the files its agent reads) SHALL be updated.

### Requirement 5: Tests
#### Acceptance Criteria
1. Unit tests with a scripted chat-completions server: the tool loop, every tool, path escape and secret-file refusals (property test over random paths), the Developer-only write, limits, each error, cancellation, the `progress`/`usage` events.
2. Provider availability (kiro missing, local not answering, local address not on this computer, cloud key missing) and the `/providers` answer carries no key.
3. A pipeline test runs a whole `change` job with the Architect and QA on the scripted chat server and the Developer on the fake runtime, and one with all three on the chat server; the report names each provider.
4. A live check (not in CI): one job on DiscordIA with the Architect and QA on Ollama `qwen3.5:4b`.
