# Implementation Plan

- [x] 1. Memory store and safety
  - JSONL store per project, schema, leak scan and sanitize, caps
  - _Requirements: 1.1, 1.2, 5.1_

- [x] 2. Learning and retrieval
  - Post-job proposal with a cheap model (Ollama first), accept / auto-remember, keyword retrieval, memory block in role prompts
  - _Requirements: 2.1, 2.2, 3.1, 3.2, 5.1_

- [ ] 3. Library panel
  - List by kind, search, edit, delete, link to the source job; "Remember this?" in the report
  - _Requirements: 2.2, 4.1_
