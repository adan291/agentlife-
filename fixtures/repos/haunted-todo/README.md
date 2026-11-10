# haunted-todo

A tiny todo-list module used as the practice repository for AGENT LIFE. It is small on purpose and has three known problems.

## Code

- `src/todo.ts`: `addTodo`, `completeTodo`, `isOverdue`, `summarize`.
- `test/todo.test.ts`: Vitest tests.

Run the tests with `npm test`.

## Known issues

1. **Bug.** `isOverdue` treats a todo due exactly now as overdue. A skipped test in `test/todo.test.ts` describes the expected behaviour.
2. **Untested function.** `summarize` has no tests.
3. **Missing validation.** `addTodo` accepts an empty or whitespace-only title and titles of any length. Titles should be trimmed, must not be empty and must be at most 100 characters.
