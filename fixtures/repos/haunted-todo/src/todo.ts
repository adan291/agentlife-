export interface Todo {
  id: number;
  title: string;
  done: boolean;
  /** Due time in milliseconds since the epoch, if any. */
  dueAt?: number;
}

export interface Summary {
  total: number;
  open: number;
  done: number;
  overdue: number;
}

/** Adds a todo and returns a new list. Ids grow by one from the highest existing id. */
export function addTodo(todos: readonly Todo[], title: string, dueAt?: number): Todo[] {
  const id = todos.reduce((max, t) => Math.max(max, t.id), 0) + 1;
  const todo: Todo = { id, title, done: false };
  if (dueAt !== undefined) todo.dueAt = dueAt;
  return [...todos, todo];
}

/** Marks the todo with the given id as done and returns a new list. Unknown ids leave the list unchanged. */
export function completeTodo(todos: readonly Todo[], id: number): Todo[] {
  return todos.map((t) => (t.id === id ? { ...t, done: true } : t));
}

/** A todo is overdue when it is open and its due time has passed. */
export function isOverdue(todo: Todo, now: number): boolean {
  if (todo.done || todo.dueAt === undefined) return false;
  return todo.dueAt <= now;
}

/** Counts todos by status. */
export function summarize(todos: readonly Todo[], now: number): Summary {
  let open = 0;
  let done = 0;
  let overdue = 0;
  for (const t of todos) {
    if (t.done) done += 1;
    else open += 1;
    if (isOverdue(t, now)) overdue += 1;
  }
  return { total: todos.length, open, done, overdue };
}
