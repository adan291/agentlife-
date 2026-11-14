# Requirements Document

## Introduction
Errors in the hotel are lost today: a browser error shows in the dev tools only, a server exception in a terminal window, a step that breaks inside the engine in a log file. The user asked on 2026-11-15 for something like the BugSack / BugGrabber add-ons known from games: one part that catches every error by itself, split in two components, **Game** (what the browser and the scene show) and **Code** (world-server, agent-engine, Docker, kiro-cli, the conductor), and one place where the errors are kept and can be read at any moment.

bug-sack adds the grabber, a manual "Report a bug" for what no machine notices, and the Bug sack panel. It is a diagnostic tool: it never changes a job, never sends anything to a model on its own, and is off in the recorded demo. All user-facing text in English.

## Requirements

### Requirement 1: Grabber, Game component
#### Acceptance Criteria
1. THE client SHALL catch `window.onerror`, `unhandledrejection`, `console.error`, PixiJS and asset load failures, and server messages that fail the protocol schema, and send each to the world-server as a `bug_report` message with: component `game`, kind, message, stack (cut), floor, open panel, view (hotel or list) and client time.
2. Sending SHALL be limited: at most 20 reports a minute and 8 KB each; an identical report within 10 s is counted, not sent again. The client never stops working because a report fails.

### Requirement 2: Grabber, Code component
#### Acceptance Criteria
1. THE world-server SHALL record its own uncaught exceptions and rejections, gateway handler errors, and engine link failures; THE agent-engine SHALL record its own exceptions, steps that end with an internal error (not a legitimate FAIL verdict), Docker and image build failures, and `kiro-cli` runs that exit with an error. Component `code`, with the process (`world-server`, `agent-engine`) and, when known, task id and step.
2. THE conductor and `pnpm session` SHALL record a session that stops on an error (not a planned STOP), with the session id and spec.
3. A logged error in these places SHALL still be logged as today; recording it is an addition.

### Requirement 3: Report a bug by hand
#### Acceptance Criteria
1. A **Report a bug** item in the Menu and the F8 key (outside text fields) SHALL open a small form: a note (up to 500 characters) and a checkbox "attach a screenshot of the room" (on by default). It records a `game` bug of kind `manual` with the note, the floor, the open panel, the view and the screenshot (PNG of the stage, at most 1 MB).
2. A short toast SHALL confirm "Bug saved. Open the Bug sack to see it."

### Requirement 4: Storage
#### Acceptance Criteria
1. Bugs SHALL be stored in `data/bugs.jsonl` (git-ignored; screenshots in `data/bugs/<id>.png`), grouped by a fingerprint (component, kind, message without numbers and ids, first stack frame): one entry per group with count, first and last time, last context and up to 5 samples.
2. Every text SHALL pass the shared leak scanner before it is stored: secrets, emails and private paths are masked. Text from the client is untrusted: capped, stored and shown as plain text only.
3. At most 500 groups are kept (oldest fixed or ignored first); the file is written atomically, and an unreadable file is moved aside, never overwritten.

### Requirement 5: The Bug sack
#### Acceptance Criteria
1. THE lobby SHALL get a **bug jar** (own art: a glass jar with small ghost bugs, drawn in code) that opens the Bug sack panel; the Menu SHALL show "Bugs (n)" with the number of open groups, and the top bar a small dot when a new one arrives.
2. The panel SHALL have two tabs, **Game** and **Code**, each listing groups newest first with count, first and last time, where (floor, panel, process, task, step) and a details view with the stack, the samples and the screenshot.
3. Each group SHALL be markable **Fixed** or **Ignored** (and back to open); a fixed group that happens again reopens. Filters: open / fixed / ignored, and a search.
4. **Copy for Kiro** SHALL copy one group, or all open groups of a tab, as Markdown (no screenshot), ready to paste into the chat.
5. `pnpm bugs` SHALL list the open groups in the terminal (`--all`, `--component game|code`, `--md`), so a Kiro session can read them.

### Requirement 6: Tests
#### Acceptance Criteria
1. Fingerprint and grouping (property test: the same error with other numbers lands in one group), limits, leak masking, file rules.
2. world-server: `bug_report` validated and rate-limited, groups updated, status changes, reopen on repeat; engine: an internal step error is recorded, a FAIL verdict is not.
3. Playwright: an error thrown in the page appears in the Game tab; F8 with a note saves a manual bug with a screenshot; Fixed and Copy for Kiro work. The regression suite's rules (requirement 2 of regression-suite) apply to the new panel and the visual baselines include it.
4. The recorded demo has no bug jar, no menu item and sends no report.
