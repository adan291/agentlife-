# Requirements Document
## Introduction
The user wants an IDE in the spirit of Kiro with a Warp-style terminal: buttons for the commands used every day and for custom ones, and a direct line to AGENT LIFE and to the bug suite, all offline. command-deck is a VSCodium extension (VSCodium is the open build of VS Code and runs portable; Kiro itself cannot be redistributed), shipped in the field kit with a portable VSCodium. Plan: `docs/roadmap-field-kit.md`. User-facing text in English.

## Requirements
### Requirement 1: Command buttons
#### Acceptance Criteria
1. A project SHALL define its buttons in `.agentlife/commands.json`: label, command, working folder, optional icon and group. Examples shipped: build, test, start the hotel, open the bug suite.
2. The deck SHALL show the buttons as a bar above the terminal. The user SHALL add, edit, reorder and remove buttons from the deck itself; changes are written back to the file.
3. A button with `${input:name}` SHALL ask for that value before it runs. A button SHALL never run on its own; every run is a click or a key.
4. Commands come from the user's file. A file that is not the user's (a cloned repository's) SHALL be shown for review before its buttons can run, the same rule as HR imports.

### Requirement 2: Runs as blocks
#### Acceptance Criteria
1. Each run SHALL be a block with the command, its output, the exit code, the duration and the time. Blocks can be folded, searched, copied and run again.
2. A failed block SHALL offer "Explain" (the kit's local model reads the command and the end of the output and answers in the panel) and "Send to the hotel" (opens a new job on the project's floor with the failure fenced as data, waiting for the user to start it).
3. Output is plain text everywhere; nothing from a command is rendered as HTML.

### Requirement 3: The hotel and the bug suite in the editor
#### Acceptance Criteria
1. A side panel SHALL show the project's floor: the running job and its step, plans waiting for approval (Approve and Reject), and the latest reports, opening the report and its diff in the editor.
2. The panel SHALL list the project's open app bugs (spec app-bugs) and open the in-app frames at their file and line; Diagnose and Fix work as on the floor.
3. The extension SHALL talk only to the world-server over its WebSocket and protocol (`@agentlife/shared`), the same contract as the browser client, never to the engine.

### Requirement 4: Portable and offline
#### Acceptance Criteria
1. The field kit SHALL contain a portable VSCodium (data folder inside the kit), the extension as a `.vsix`, and settings that turn off telemetry, updates and the extension marketplace.
2. The editor SHALL start from `start.sh` with the project open, and nothing in it SHALL reach the network.

### Requirement 5: Tests and docs
#### Acceptance Criteria
1. Unit tests: the commands file (schema, edits, review of a foreign file), the block model, the input prompts.
2. Extension tests with `@vscode/test-electron` against a scripted world-server: a button run, a failed block sent to the hotel, an approval from the panel.
3. README section and the decision record (VSCodium, protocol reuse).
