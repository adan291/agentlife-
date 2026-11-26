# Requirements Document
## Introduction
At the client the user may work in Ada on air-gapped Linux. ada-stack lets the hotel's agents work on Ada projects (tests in the sandbox, as Node and Maven projects) and lets the bug suite take the failures of Ada programs, for which no Sentry SDK exists. Builds on field-kit and app-bugs. Plan: `docs/roadmap-field-kit.md`. User-facing text in English.

## Requirements
### Requirement 1: Ada projects
#### Acceptance Criteria
1. A project with a `.gpr` file or `alire.toml` at the root SHALL be detected as `ada-gnat`, with a default test command taken from `config/stacks.json` (for example `gprbuild -P tests.gpr && ./bin/test_runner`), which the user can change at the Reception.
2. The field kit SHALL ship a GNAT toolchain and gprbuild in the sandbox image, and the Alire crates a project needs SHALL be vendored when the kit is built, so nothing is fetched at the client.
3. Tests SHALL run in the field-kit sandbox with today's rules, the build output in a writable folder inside it.
4. The agents' file tools SHALL treat `.ads`, `.adb` and `.gpr` as text, and the default deny list stays as it is.

### Requirement 2: Ada failures in the bug suite
#### Acceptance Criteria
1. The bug suite SHALL read failures of Ada programs from a log folder the user names: GNAT exception messages ("raised CONSTRAINT_ERROR : file.adb:42 ..."), and the traceback of `GNAT.Traceback.Symbolic` when present.
2. Each failure SHALL become an app bug of the project with the same grouping, masking and limits as the Sentry intake, its frames mapped to the project's files.
3. Diagnose and Fix SHALL work on them as on any app bug, with the red-green check running the Ada tests.

### Requirement 3: Tests and docs
#### Acceptance Criteria
1. Unit tests: detection, the log parser on real GNAT message shapes (including no traceback), frame mapping.
2. A live check on the kit: a small Ada project with a deliberate Constraint_Error, from the log to a fix branch whose test failed before the fix.
3. README section and the decision record.
