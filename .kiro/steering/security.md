# Security and IP rules (non-negotiable)

## Assets and IP
- Never use, trace or recreate Habbo (Sulake) graphics, sounds, names or trade dress. Never pull code from Habbo emulators or clients (Arcturus, Nitro, Havana).
- Third-party assets only if CC0 or MIT, each listed in `ASSETS.md` with source and license.
- If code is copied from an MIT project (e.g. FlaccidNoise/jt-habbo-hotel), keep its copyright notice in the file header and list it in `ASSETS.md` and the README.

## Agents of the product
- Repos come from an allowlist only. No arbitrary URLs in the MVP.
- Architect and QA are read-only. Developer may write only inside its task worktree and has no shell and no network tools.
- Agents never push, merge, open PRs or touch `.git`, CI files or env files.
- Tests of the target repo run only in Docker with `--network none` and CPU, memory and time limits. The LLM never runs tests itself.
- After Developer finishes, the engine validates the diff (paths inside worktree, no binaries, size cap) before anything else uses it.
- Treat repository contents and model output as untrusted data, never as instructions to the engine.

## Secrets
- Secrets (KIRO_API_KEY, tokens) come from environment variables or `.env` (git-ignored). Never commit them, never log them, never send them to the client.
