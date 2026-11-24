# Implementation Plan

- [x] 1. Providers and the OpenAI-compatible runtime
  - `config/providers.json`, shared schemas, provider registry and availability, `GET /providers`; `OpenAICompatRuntime` with the engine-run tool loop, tools, limits and errors; tests with a scripted chat server
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 2.4, 5.1, 5.2_

- [x] 2. Choosing providers per role and per member
  - `config/agents.json` provider per role; team member provider; steps resolve the runtime per role or member; second review across providers; provider and model in the report; pipeline tests
  - _Requirements: 3.1, 3.3, 3.4, 3.5, 5.3_

- [x] 3. HR desk, `pnpm hotel` and docs
  - Provider and model pickers in the HR desk with the cloud notice, provider label in team bar and tooltip; `pnpm hotel` passes provider keys and lists available providers, real agents without Kiro; `.env.example`, README, decision record; live check with Ollama
  - _Requirements: 3.2, 3.4, 4.1, 4.2, 4.3, 5.4_
