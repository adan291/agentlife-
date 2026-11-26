# Implementation Plan
- [ ] 1. Design
  - Write design.md from the client's answers (GNAT version, build tool, test runner): the stack entry, the sandbox image with GNAT and gprbuild, vendoring Alire crates, the log intake. Ask the user for a yes before building
  - _Requirements: all_
- [ ] 2. Ada projects in the sandbox
  - `ada-gnat` detection and default command, GNAT and gprbuild in the kit's sandbox image, vendored crates, Ada files as text for the agents; tests
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 3.1_
- [ ] 3. Ada failures in the bug suite
  - Log folder intake, GNAT exception and traceback parser, app bugs with the shared grouping and masking, Diagnose and Fix on them; tests; live check; README and the decision record
  - _Requirements: 2.1, 2.2, 2.3, 3.1, 3.2, 3.3_
