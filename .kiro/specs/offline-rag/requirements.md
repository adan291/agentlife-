# Requirements Document
## Introduction
offline-rag lets the user load documentation (for example the Ada reference manual, the GNAT user's guide, the client's own manuals) and ask questions about it with no network, with answers that cite where they come from. The same knowledge reaches the agents. It also adds skills: Markdown instructions that an agent loads only when it needs them. Builds on field-kit and on the Library of the hotel (project-memory). Plan: `docs/roadmap-field-kit.md`. User-facing text in English.

## Requirements
### Requirement 1: Loading documents
#### Acceptance Criteria
1. The user SHALL add a document library from a folder: PDF (text layer), HTML and Markdown. The engine SHALL split them into passages that keep the document, the section heading and the page or line.
2. Embeddings SHALL be made by the local model of the kit (default an embedding model served by Ollama) and stored with the passages in one SQLite file per library (sqlite-vec), under `data/`.
3. Loading SHALL be resumable and incremental: a changed file is indexed again, an unchanged one is skipped, a removed one is dropped.
4. Document text is untrusted data, the same as repository content: it is fenced in every prompt and never followed as instructions.

### Requirement 2: Asking with citations
#### Acceptance Criteria
1. A question SHALL be answered from the passages found (vector search plus keyword search on the same file), and each statement of the answer SHALL cite a passage.
2. The engine SHALL check every citation: the passage exists and the quoted words appear in it. A citation that does not hold is shown as not checked, and an answer with no checked citation says so.
3. The Library panel of the hotel SHALL have an "Ask" tab with the question, the answer, and the cited passages, each one opening the document at that place.

### Requirement 3: Knowledge for the agents
#### Acceptance Criteria
1. A project SHALL be able to attach libraries. The Architect and QA SHALL get a `search_docs` tool (read-only) on them, with the provider-independent tools of multi-runtime, and their citations go into the report.
2. Skills: folders `skills/<name>/SKILL.md` with a name and a one-line description in front matter. The engine SHALL offer the agents the list (name and description only) and SHALL load the full text only when an agent asks for it with `load_skill`.
3. The kit SHALL ship a few skills (Ada and GNAT basics, how AGENT LIFE plans and reports), and the user SHALL be able to add skills to a project or to the kit.

### Requirement 4: Tests and docs
#### Acceptance Criteria
1. Unit tests: splitting (each format), incremental loading, the search, citation checking (property test over random quotes), skills discovery and loading.
2. A pipeline test where the Architect answers with `search_docs` and a skill on the fake runtime.
3. README section, and the decision record (store, embedding model, citation rule).
