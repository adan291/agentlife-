# Design notes (night-shift)

Decisions made while implementing tasks 1 and 2. The requirements stay as written.

## Engine pieces

- `shared/src/night.ts`: schemas for the schedule (`NightJob`, `NightJobInput`, `NightFile`), the window config and `GET /night`. A job also keeps its result (`status`, `reason`, `verdict`, `branch`).
- `night/store.ts`: `data/night.json`, written to a temporary file and renamed. An unreadable file is moved aside as `night.json.bad-<time>`; it is never overwritten. At most 50 jobs; a full schedule drops the oldest finished one.
- `night/window.ts`: the window in the local time of the machine, end exclusive, may cross midnight. A night is named by the day its window started.
- `night/scheduler.ts`: `tick()` decides from the clock and the schedule, never blocks on a job. Injectable clock and port; the engine wires the real runner (`engine.ts`). The timer runs only when `startEngine` gets `night.run: true` (the real process does, tests do not).
- `night/routes.ts`: `GET /night`, `POST /night/jobs`, `DELETE /night/jobs/:id`, `POST /night/jobs/:id/move`. The window and limits come from `config/night.json` and are shown, not edited, through the API.

## Rules of the scheduler

- One night job at a time; a job of the user's own (any state except `awaiting_plan_approval`) keeps the night from starting anything.
- A job that stops at an approval it may not give itself is marked `waiting` and the night moves on. The plan stays pending in the mailbox, so the user can still approve it in the morning.
- The time limit cancels the job; the final status is `timed_out` when the job's recorded reason is the timeout text.
- When the window ends, scheduled jobs are skipped with a reason (limit reached, daytime job, window ended); a job still running is allowed to finish, and the night closes after it.
- Jobs added after the window ended wait for the next night.

## Pre-approval (requirement 2)

- `JobRunner.start(..., { preApproval })` carries a policy: `check(plan)` and the `paths` rule. A plan is approved only if it names at least one file and every file is inside the scope. Files are normalised first; absolute paths, drive letters and `..` are never inside a scope.
- Scope of a `change`: the entries the user typed (a folder ends with `/`, otherwise one file; case-sensitive). `write-tests` and `document` use the fixed rule of the kind, never a typed one.
- When a pre-approval approved the plan, the same scope is passed to the Developer step as `pathRule`, and `validateDiff` refuses a diff that touches anything outside it. A plan inside the scope cannot grow outside it.
- A policy that throws never approves. An out-of-scope plan leaves the approval pending with the reason in its summary ("Night shift: not approved automatically (...)"); nothing is built.
- Delivery (requirement 2.3): the scheduler calls `deliverJob` only for a passing job of a kind that writes files and only if the user turned `deliver` on. It never pushes or merges. A failed delivery leaves the job `done` with the reason.

## audit-deps (requirement 3.3)

- Pipeline `created -> testing -> report_ready`: no plan, no approval, no model. The state is `testing` because that is the step that runs a command in Docker; the QA ghost walks to the computer and the report is built from the audit.
- Choice between the two options in the requirement: **offline**. The sandbox keeps `--network none` (Docker cannot limit a container to one host name, and an open network would let a dependency's scripts talk to anyone). The command runs `npm outdated --json --offline` and `npm audit --json --offline`; every audit report carries the note that the lists come from npm's local cache and may be stale or incomplete.
- Consequence: `npm audit --offline` can only answer from what the image's cache holds, so on a fresh image the vulnerability list may be empty with a note. A live network option would need a separate, allowlisted egress (proxy); not done.
- Verdict: `fail` when npm gave no list at all or a high/critical vulnerability is listed; outdated packages alone pass.
- `runInSandbox` (extracted from `testStep`) is shared by the test step and the audit step, so both use the same flags.

## Morning summary and Discord (task 3)

- `night/summary.ts` (pure): `buildSummary(night, jobs, writtenAt)` takes the jobs whose `nightKey` is the night's, counts them by status (`countJobs`) and writes the Markdown for the mailbox (headline numbers, "Waiting for you", "Jobs", "To do"). `discordFacts` writes the plain-text facts for Discord from the same data. No model computes a number.
- `night/summary-store.ts`: `data/night-summaries.json` (override `AGENTLIFE_NIGHT_SUMMARIES_FILE`), atomic write, the last 14 nights, one summary per night, an unreadable file is moved aside. `GET /night/summaries` answers them newest first.
- `night/morning.ts`: `createMorningReporter` is the scheduler's `onClose`. It stores the summary, then, only if `discord` is true in `config/night.json` (default false), calls the notifier. A failing notifier is logged and never undoes the summary. The scheduler calls `onClose` once, when it closes the night, outside the tick (a slow Discord call cannot delay the next tick); a throwing hook is logged and the night stays closed.
- The real notifier spawns `node --experimental-strip-types scripts/notify.ts --overview` with no shell, the facts on standard input and an allowlisted environment (`PATH`, home folders, `DISCORD_*`, `OLLAMA_*`; no `KIRO_API_KEY`, no engine token). `notify.ts --overview` asks the local Ollama for a three-sentence English overview of the facts and posts facts and overview; without Ollama the facts go alone. Presence ("here"/"away") does not apply: the user turned the message on in the config.
- Lobby mailbox: the lobby got a mailbox (`mailbox_lobby`, north wall, x=4). The gateway copies the summaries into the lobby floor as reports (`kind: "night"`, id `night-<key>`, no verdict). A summary written in the last 24 hours is announced like a delivered report when the gateway first sees it (badge, toast "Your morning summary is ready") and again on every welcome into the lobby until the lobby mailbox is opened; older ones only appear in the list. The gateway looks at the engine on every connection, when the lobby mailbox opens and every 60 s (`nightPollMs`).
- `ReportSchema.kind = "night"` is the only protocol change of this task; the client shows a "Night" badge instead of a verdict.

## Known limits

- `tier` (cheap / normal) is stored on the job and shown, but not applied yet: the role runtimes take their model from `config/agents.json`, not per job. Needs a per-job model override in the runtime; left for the client task or a follow-up.
- Not run live: a real night with `kiro-cli`, `audit-deps` in the real Docker image (npm cache contents unknown), delivery of a night job on a registered project, a real Discord message with the Ollama overview (the notifier process is tested with stub scripts; `notify.ts --overview` itself is not).
- The summary names projects by id, not by display name (the engine's night schedule keeps ids).
- The `discord` switch lives in `config/night.json`; the night board only shows it, it does not change it.
- Morning summary, Discord and the client (tasks 3 and 4) are not done.
