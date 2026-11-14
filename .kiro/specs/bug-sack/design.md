# Design Document: bug-sack

Same split as ghost-skins. Pure rules and schemas live in `@agentlife/shared` (`bugs.ts`, usable by the client). Everything that touches files or the leak scanner is node-only (`bugs-node.ts`, `leaks.ts`). The world-server owns the store and the file. The other processes (agent-engine, conductor, `pnpm session`) never touch `data/bugs.jsonl`; they append to an inbox that the world-server drains. Task 1 is the store, the Code grabber and the terminal command; task 2 is the client (Game grabber, Report a bug, the panel).

## Vocabulary
- **Report**: one error as a process sees it (`BugInput`).
- **Group**: all reports with the same fingerprint (`BugGroup`). This is what the panel lists.
- **Sample**: one stored report of a group (at most 5 per group).
- **Component**: `game` (what the browser and the scene show) or `code` (world-server, agent-engine, Docker, kiro-cli, conductor, session).
- **Process**: who saw it: `client`, `world-server`, `agent-engine`, `conductor`, `session`.

## Shared (`packages/shared/src/bugs.ts`, in the index; no node imports)

### Report (`BugInputSchema`)
| Field | Rule |
|---|---|
| `component` | `game` or `code` |
| `process` | one of the five above |
| `kind` | `^[a-z][a-z0-9-]{0,39}$`. Game: `uncaught`, `unhandled-rejection`, `console-error`, `asset-load`, `pixi`, `protocol`, `manual`. Code: `uncaught`, `unhandled-rejection`, `handler`, `engine-link`, `step-error`, `step-timeout`, `kiro-cli`, `docker`, `http-500`, `startup`, `session-failed`, `conductor-stop` |
| `message` | 1..1000 characters |
| `stack` | optional, up to 4000 characters |
| `note` | optional, up to 500 characters (manual reports) |
| `context` | optional object, every value a string up to 100 characters: `floor`, `panel`, `view`, `task`, `step`, `session`, `spec` |
| `clientTime` | optional epoch ms (game reports) |

### Fingerprint
`bugFingerprint(input)` returns a 16 hex character id from the key `component | process | kind | normalised message | first frame`. The requirement lists four parts; `process` is added because the Code component spans five processes and an `uncaught` error with the same text in the engine and in the world-server are two bugs.

- **Normalised message**: first line only, then in this order: query strings of URLs removed (`?t=123`), ISO timestamps to `<time>`, UUIDs to `<id>`, hex runs of 8 or more characters that contain a digit to `<id>`, every remaining number to `#`, whitespace collapsed, cut at 300 characters. Quoted names stay (`reading 'x'` is the signal).
- **First frame**: the first line of the stack that looks like a frame (V8 `at fn (file:line:col)` or `fn@file:line:col`), reduced to `fn@basename`: line and column removed, query removed, and the hash that Vite puts in a built file name removed (`index-AbC123de.js` becomes `index.js`). No frame gives an empty string.
- The hash is two FNV-1a 32-bit runs with different seeds (no `node:crypto`, so the client can compute it too).
- Property test: the same error with other numbers, ids and line numbers lands in one group; a different kind, process or message does not.

### Group (`BugGroupSchema`) and the book
```
id, component, process, kind,
message        the first sample's message, first line, cut at 300 (what the list shows)
frame          the first frame, normalised
status         open | fixed | ignored
count          every report ever received for the group
firstSeen, lastSeen        epoch ms of the server
reopened       how many times a fixed group came back (0 at first)
last           context of the latest report (+ process)
samples        up to 5, newest last: { id, at, message, stack?, note?, context, clientTime?, shot? }
```
`BugBook` (pure, in memory) holds the groups and is the only code that changes them, so the world-server and `pnpm run bugs` agree:
- `record(input, now, sampleId, shot?)` finds or makes the group, bumps `count`, `lastSeen`, `last`, appends the sample and drops the oldest when there are more than 5. Returns what happened: `created`, `reopened` and `dropped`, the ids of samples that left the book (past the cap of 5, or inside an evicted group), so their screenshots can go.
- A **fixed** group that gets a new report becomes `open` and `reopened` goes up by one. An **ignored** group stays ignored (count and samples still grow).
- At most **500 groups**. A new group over the limit evicts the oldest `lastSeen` among fixed and ignored groups first; when all 500 are open, the oldest open one.
- `setStatus(id, status)`, `get(id)`, `list({ component?, status?, search? })` newest `lastSeen` first, `openCount(component?)`.
- `groupsToMarkdown(groups)` makes the text of `pnpm run bugs --md` (and, in task 2, Copy for Kiro). No screenshot, no absolute path (the text was masked before it was stored).

## Masking (`@agentlife/shared/leaks`, `@agentlife/shared/bugs-node`)
Every text goes through `cleanBugInput(input, { secrets?, roots? })` before it is stored or appended anywhere: `message`, `stack`, `note`, every `context` value. It never throws and is idempotent (masking a masked text changes nothing, a property test checks it).

1. Fields are capped to the lengths above (a client cannot grow a record) and control characters other than newline and tab are removed.
2. `maskLeaks(text, { secrets })`, new in `leaks.ts` and built on the same `LEAK_PATTERNS`, `SAFE_EMAIL` and `SAFE_PATH` as the scanner, so a text the scanner would flag cannot be stored: keys and tokens become `[kind]` (for example `[github-token]`), emails `[email]`, `C:\Users\name` becomes `<home>`, and the exact values of the known secret variables (`envSecretValues()`) become `[secret]`. A `NAME=value` or `"name":"value"` where the name contains KEY, TOKEN, SECRET or PASSWORD keeps the name and masks the value.
3. Private paths: the repository root becomes `<repo>` (stack frames stay readable), the allowed project roots (`config/hotel.json`, default `D:\AgentHotel`) become `<projects>`, then any other absolute path (`C:\...`, `\\server\...`, `/home/...`, `/Users/...`, `file:///C:/...`) becomes `<path>/` plus its last two segments. Both slash directions are handled.
4. The text is plain text everywhere: the panel (task 2) uses `textContent`, never HTML.

A test feeds the scanner itself with the stored file: after a report full of key-shaped fixtures (built at runtime, none written in source), `createLeakScanner().scanText` finds nothing in `data/bugs.jsonl`.

## Files
`data/bugs.jsonl` (git-ignored; `AGENTLIFE_BUGS_FILE` overrides it, for tests and Playwright).

- Line 1: `{"format":"agentlife-bugs","version":1,"savedAt":<ms>}`. Every other line is one group (`BugGroupSchema`). Groups are written newest `lastSeen` first.
- The whole file is rewritten on a change: a temporary file in the same folder, then a rename (`writeTextAtomic`), so a reader sees the old file or the new one. Writes are debounced by 500 ms (a link that fails every 5 seconds changes `count` only) and `flush()` writes at once; `flush` runs on `exit` and from the process error hook.
- Loading: a missing file is an empty book. A file with a missing or foreign header, a line that is not JSON or a group that fails the schema is renamed `bugs.jsonl.bad-<time>` and the book starts empty, as `readJsonFile` does. The old content is never overwritten. A failed write is logged and kept in memory; the next change tries again.
- Screenshots: `data/bugs/<sampleId>.png`, written by the store only when the bytes start with the PNG signature and are at most 1 MiB. They go when their sample or group goes. How the bytes reach the world-server (the 16 KB message limit does not fit 1 MiB) is decided in task 2; the store takes bytes.
- Sample ids: `b<time in base 36><4 random characters>`.

### The inbox
Other processes cannot rewrite the file without racing the world-server, and they run when it does not (the conductor). They append one JSON line `{ "at": <ms>, "report": <BugInput> }` to `data/bugs-inbox.jsonl` with `appendFileSync` (a line is at most 8 KB, so one write). The report is already masked. `createBugReporter({ process })` (in `bugs-node.ts`) does this, never throws, and writes nothing when the inbox is larger than 1 MiB (a world-server that is not running for days must not fill the disk; the first skipped report prints one warning to stderr).

The world-server `drainInbox()` (at start and every 2 s):
1. If `bugs-inbox.draining` exists (a crash in the middle), read it first.
2. Rename `bugs-inbox.jsonl` to `bugs-inbox.draining`; on failure (a writer holds it, `EBUSY` on Windows) try again at the next tick.
3. Record every line (a line that is not valid is skipped and counted), save the file, then delete `.draining`. When the save fails the reports stay in memory, `.draining` stays on disk, and the next tick only retries the save and then deletes it (nothing is read or counted twice). A crash between the rename and the save leaves `.draining`, which the next start reads again (the only case that can count a report twice).

`pnpm run bugs` reads `bugs.jsonl` and applies the inbox (and a leftover `.draining`) in memory, without writing, so it shows errors of a stopped hotel too.

## World-server (`packages/world-server/src/bug-store.ts`)
`BugStore` wraps `BugBook` with the file, the screenshots, the masking and the debounce: `record(input, { screenshot? })`, `recordError(kind, error, context?)` (builds the report from an `Error`: message, stack, process `world-server`), `setStatus`, `get`, `list`, `summaries()`, `openCount()`, `drainInbox()`, `startDraining()`, `flush()`, `close()`, `screenshotPath(sampleId)`, `onChange(listener)` (task 2 uses it to tell the client). `record` always masks (the input may come from a client). A store with `enabled` false does not exist: `main.ts` creates it only with `ENGINE=http` or `AGENTLIFE_BUGS_FILE`, like the wallet and the progress file, so the scripted engine used by Playwright never writes into `data/`.

### Messages (`protocol.ts`)
| Direction | Message | Answer |
|---|---|---|
| client to server | `bug_report` (game kinds only, `message`, `stack?`, `note?`, `floor?`, `panel?`, `view?`, `clientTime?`) | `bug_saved { id, count }`, or `error` `bug_error` |
| client to server | `bugs_state` | `bugs { groups (no samples), open: { game, code } }` |
| client to server | `bug_get { id }` | `bug_detail { group }` (with samples) |
| client to server | `bug_status { id, status }` | `bugs` |
| world-server to client | `error` code `bug_error` (new `ErrorCode`) | |

The server fixes `component` to `game` and `process` to `client` for `bug_report` (the client cannot claim to be the engine) and fills `floor` from the room of the user when the message has none. A message over 8192 bytes (`BUG_REPORT_BYTES`) is refused. At most 20 reports a minute per connection (`BUG_RATE_PER_MINUTE`, a sliding window that tests can drive with the gateway's `clock`); over that the answer is `bug_error` and nothing is stored. The general 16 KB message limit and 20 messages a second still apply.

### Where the grabbers hook in
Hooks are additions: the error is logged and thrown as before. Nothing in a hook may throw (each is in a `try`).

| Where | How | Kind |
|---|---|---|
| world-server process | `process.on("uncaughtExceptionMonitor")` in `main.ts`: it only observes, so the crash is as today. Node routes an unhandled rejection through it too (`origin`), so one hook covers both | `uncaught`, `unhandled-rejection` |
| gateway outbox (`enqueue`) | its `.catch(() => undefined)` swallowed every error of a queued send; it now records and still carries on | `handler` |
| `HttpEngineLink` stream | new option `onError(error)` at the single place where the stream loop logs `engine stream: ...`; in `main.ts` it calls `recordError`. The fingerprint folds the reconnect loop of an engine that is down into one group with a count | `engine-link` |
| agent-engine process | `uncaughtExceptionMonitor` in `main.ts`, and the `engine failed to start` catch | `uncaught`, `unhandled-rejection`, `startup` |
| `JobRunner.handleError` | new option `onBug(input)`. Recorded: every thrown error except a cancel (`JobCancelledError`) and a rejected diff (`DiffRejectedError`: the Developer's change failed the engine's checks, a legitimate FAIL). Classified by `classifyStepError`: `KiroCliError` is `kiro-cli`, `DockerUnavailableError` and `RunnerImageBuildError` are `docker`, `StepTimeoutError` is `step-timeout`, anything else `step-error`. Context: `task`, `step` (`a.lastStep`). A QA FAIL verdict or failing tests never get here: they end in `report_ready` | see left |
| engine HTTP server | the `request failed` catch (the 500) | `http-500` |
| `pnpm session` | when the run ends `failed` (kiro-cli exit code or `pnpm check`). A `blocked` run is a planned stop of the unattended protocol and is not recorded. Context: `session`, `spec` | `session-failed` |
| conductor | `stop()` records its message, except the dirty working tree (a planned stop) and `session ... did not finish cleanly` (the session recorded itself). Context: `spec` | `conductor-stop` |

Not recorded on purpose: errors the engine handles and recovers from (the Night intern falling back to the cheap model, a catalogue source that does not answer, HR suggestions that fall back to the fixed rules). They are warnings, not bugs. Failures of the service agents surface when a job fails because of them.

## Terminal (`scripts/bugs.ts`, `pnpm run bugs`)
```
pnpm run bugs                      open groups, newest first
pnpm run bugs --all                every group (open, fixed, ignored)
pnpm run bugs --component game|code
pnpm run bugs --md                 Markdown, ready to paste into a chat
```
One block per group: id, `[component/process] kind`, status, `x<count>`, first and last time, where (`floor`, `panel`, `task`, `step`, `session`), message, first frame. An unknown flag prints the usage and exits with 2. The command never writes. It exits 0 with "No open bugs." when there is none.

**The name.** The requirement says `pnpm bugs`, but `bugs` is a built-in pnpm command (the npm passthrough that opens a repository's issue page), and a built-in wins over a script of the same name: `pnpm bugs --md` fails with "Unknown option". The script is still called `bugs` in `package.json` and is run with `pnpm run bugs` (flags after the name reach the script). If the user prefers a bare command, the script only needs another name (for example `bugsack`) and the usage text in `scripts/bugs.ts`.

## Limits (all in `bugs.ts`)
`BUG_MESSAGE_MAX` 1000, `BUG_STACK_MAX` 4000, `BUG_NOTE_MAX` 500, `BUG_FIELD_MAX` 100, `BUG_REPORT_BYTES` 8192, `BUG_RATE_PER_MINUTE` 20, `BUG_SAMPLES_MAX` 5, `BUG_GROUPS_MAX` 500, `BUG_SHOT_MAX_BYTES` 1 MiB, `BUG_INBOX_MAX_BYTES` 1 MiB, `BUG_SAVE_DEBOUNCE_MS` 500, `BUG_DRAIN_MS` 2000.

## Tests
- shared: fingerprint (property: the same error with other numbers, ids and line numbers is one group; different kind or process is not), normalisation examples, `BugBook` (samples cap, eviction order, fixed reopens, ignored stays, filters, search), masking (fixtures of every leak kind and every path shape, idempotent, the scanner finds nothing afterwards), markdown.
- world-server: store file round trip, atomic write, a damaged file moved aside, debounce and `flush`, screenshot rules, the inbox (drain, leftover `.draining`, a save that fails keeps the file and counts nothing twice, bad lines), the gateway (`bug_report` validated, forced `component`, size and rate limit with a fake clock, `bugs_state`, `bug_get`, `bug_status`, a fixed group reopens, no store means `bug_error`), outbox error recorded, the engine link's `onError`. A rename that fails because a writer holds the inbox (`EBUSY`) is not simulated: the code returns and the next tick retries.
- agent-engine: an internal step error is recorded with task and step, kinds follow the classes, a cancel and a rejected diff are not, a FAIL verdict and failing tests are not; the 500 of the HTTP server.
- scripts: `pnpm run bugs` output and flags, the inbox shown without writing, an unreadable file left in place. The hooks in `run-session.ts` and `conduct.ts` run when the file is loaded, so they have no unit test; they are one call each, and the reporter they use is tested.

## Decisions to record
- The inbox instead of the engine writing the file or sending the errors over its SSE stream: the conductor and the session run without any service, and two writers of one file would race. Recorded in `docs/risks-and-decisions.md` as D17.
