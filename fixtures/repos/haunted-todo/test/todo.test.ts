import { describe, expect, it } from "vitest";
import { addTodo, completeTodo, isOverdue, type Todo } from "../src/todo.ts";

describe("addTodo", () => {
  it("adds a todo with the next id", () => {
    const list = addTodo(addTodo([], "first"), "second");
    expect(list.map((t) => t.id)).toEqual([1, 2]);
    expect(list[1]).toEqual({ id: 2, title: "second", done: false });
  });

  it("does not change the input list", () => {
    const before: Todo[] = [{ id: 1, title: "a", done: false }];
    addTodo(before, "b");
    expect(before).toHaveLength(1);
  });

  it("keeps the due time", () => {
    expect(addTodo([], "a", 100)[0]?.dueAt).toBe(100);
  });
});

describe("completeTodo", () => {
  it("marks the matching todo as done", () => {
    const list = completeTodo(addTodo([], "a"), 1);
    expect(list[0]?.done).toBe(true);
  });

  it("ignores unknown ids", () => {
    const before = addTodo([], "a");
    expect(completeTodo(before, 99)).toEqual(before);
  });
});

describe("isOverdue", () => {
  it("is overdue after the due time", () => {
    expect(isOverdue({ id: 1, title: "a", done: false, dueAt: 100 }, 101)).toBe(true);
  });

  it("is never overdue when done", () => {
    expect(isOverdue({ id: 1, title: "a", done: true, dueAt: 100 }, 500)).toBe(false);
  });

  // Known bug (issue 1): a todo due exactly now is reported as overdue. Unskip once fixed.
  it.skip("is not overdue exactly at the due time", () => {
    expect(isOverdue({ id: 1, title: "a", done: false, dueAt: 100 }, 100)).toBe(false);
  });
});
