# Requirements Document
## Introduction
The user wants AGENT LIFE to work where there is no internet, for example at a client with air-gapped Linux terminals, and to carry it on a USB drive. field-kit is the base: one portable folder with everything AGENT LIFE needs, a start script that never reaches the network, and the checks a client's security team asks for. The other offline specs (offline-rag, command-deck, ada-stack) build on it. Plan: `docs/roadmap-field-kit.md`. User-facing text in English.

Precondition, not a requirement of the code: the kit is used at a client only with the client's written approval.

## Requirements
### Requirement 1: One portable folder
#### Acceptance Criteria
1. `pnpm kit build --target linux-x64` SHALL produce `dist/agentlife-kit/` with a Node.js runtime, AGENT LIFE (engine, world-server, built client), its production dependencies, an Ollama binary, the chosen models and the default config. Nothing is downloaded when the kit runs.
2. Every path inside the kit SHALL be relative to the kit folder. No absolute path and no user name may be written into it.
3. The models SHALL be chosen in `kit.json` (default: one chat model with tool calling and one embedding model), and the build SHALL print the size of the kit.
4. When the drive is mounted without execute permission, `install-to-home.sh` SHALL copy the kit to `~/agentlife-kit` and run from there.

### Requirement 2: Start without the network
#### Acceptance Criteria
1. `start.sh` SHALL start Ollama from the kit, then the engine with all three roles on it (`AGENTLIFE_PROVIDER=ollama`), the world-server and the client, all on loopback only, and print the address to open.
2. The kit SHALL make no outbound connection: every provider other than the kit's Ollama is off, and nothing reports telemetry. A test SHALL run the kit with the network blocked (a network namespace or an empty Docker network) and do one scripted job and one real job end to end.
3. The step timeouts SHALL be configurable in the kit's config, because a model on a CPU is slower.
4. `stop.sh` SHALL stop everything the kit started, and nothing else.

### Requirement 3: A test sandbox without Docker
#### Acceptance Criteria
1. When Docker is present the sandbox SHALL work as today. When it is not, the engine SHALL use rootless podman, and if that is missing too, bubblewrap. Each SHALL keep today's rules: no network, CPU, memory and time limits, the checkout mounted read-only, and no root.
2. With none of the three, the test step SHALL fail with a clear message. It SHALL never run the tests without isolation.
3. The test images SHALL be built when the kit is built and shipped in it as archives (`docker save` or OCI), so no image is pulled at the client.

### Requirement 4: What a security review needs
#### Acceptance Criteria
1. The build SHALL write `SBOM.json` (CycloneDX) with every component, its version and its license, and SHALL refuse a component whose license is not on the allowed list in `kit.json`.
2. The build SHALL write `SHA256SUMS` of every file, and `verify.sh` SHALL check it before `start.sh` runs anything.
3. The build SHALL run `pnpm audit --prod --audit-level high` and the leak scanner (`pnpm security:scan`), and SHALL refuse to build when either reports a finding.
4. `KIT.md` in the kit SHALL say in plain words what the kit contains, what it can and cannot do (no network, no push, no change to the user's working copy), and how to remove it.

### Requirement 5: Tests and docs
#### Acceptance Criteria
1. Unit tests for the build steps (paths, SBOM, checksums, license refusal) and for the sandbox choice (Docker, podman, bubblewrap, none).
2. The network-blocked run of 2.2 as a script that can be run on Linux (not in the Windows `pnpm check`).
3. README section "Offline kit" and a decision record in `docs/risks-and-decisions.md`.
