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

## Known limits

- `tier` (cheap / normal) is stored on the job and shown, but not applied yet: the role runtimes take their model from `config/agents.json`, not per job. Needs a per-job model override in the runtime; left for the client task or a follow-up.
- Not run live: a real night with `kiro-cli`, `audit-deps` in the real Docker image (npm cache contents unknown), delivery of a night job on a registered project.
- Morning summary, Discord and the client (tasks 3 and 4) are not done.
