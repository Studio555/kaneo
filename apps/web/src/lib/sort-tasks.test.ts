import { describe, expect, it } from "vite-plus/test";
import type Task from "@/types/task";
import { sortTasks } from "./sort-tasks";

function task(overrides: Partial<Task> & { id: string }): Task {
  return {
    title: "Task",
    number: 1,
    description: null,
    status: "to-do",
    priority: null,
    startDate: null,
    dueDate: null,
    position: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    userId: null,
    assigneeId: null,
    assigneeName: null,
    projectId: "project-1",
    ...overrides,
  };
}

function ids(tasks: Task[]) {
  return tasks.map((t) => t.id);
}

describe("sortTasks", () => {
  it("orders tasks by assignee name ascending", () => {
    const tasks = [
      task({ id: "charlie", assigneeName: "Charlie" }),
      task({ id: "alice", assigneeName: "Alice" }),
      task({ id: "bob", assigneeName: "Bob" }),
    ];

    const sorted = sortTasks(tasks, { field: "assignee", direction: "asc" });

    expect(ids(sorted)).toEqual(["alice", "bob", "charlie"]);
  });

  it("orders tasks by assignee name descending", () => {
    const tasks = [
      task({ id: "alice", assigneeName: "Alice" }),
      task({ id: "charlie", assigneeName: "Charlie" }),
      task({ id: "bob", assigneeName: "Bob" }),
    ];

    const sorted = sortTasks(tasks, { field: "assignee", direction: "desc" });

    expect(ids(sorted)).toEqual(["charlie", "bob", "alice"]);
  });

  it("keeps unassigned tasks last when sorting assignee ascending", () => {
    const tasks = [
      task({ id: "unassigned", assigneeName: null }),
      task({ id: "bob", assigneeName: "Bob" }),
      task({ id: "alice", assigneeName: "Alice" }),
    ];

    const sorted = sortTasks(tasks, { field: "assignee", direction: "asc" });

    expect(ids(sorted)).toEqual(["alice", "bob", "unassigned"]);
  });

  it("keeps unassigned tasks last when sorting assignee descending", () => {
    const tasks = [
      task({ id: "unassigned", assigneeName: null }),
      task({ id: "alice", assigneeName: "Alice" }),
      task({ id: "bob", assigneeName: "Bob" }),
    ];

    const sorted = sortTasks(tasks, { field: "assignee", direction: "desc" });

    expect(ids(sorted)).toEqual(["bob", "alice", "unassigned"]);
  });

  it("orders tasks by craft name ascending", () => {
    const tasks = [
      task({
        id: "engineering",
        craft: { id: "c1", name: "Engineering", color: "blue" },
      }),
      task({ id: "art", craft: { id: "c2", name: "Art", color: "red" } }),
      task({ id: "audio", craft: { id: "c3", name: "Audio", color: "teal" } }),
    ];

    const sorted = sortTasks(tasks, { field: "craft", direction: "asc" });

    expect(ids(sorted)).toEqual(["art", "audio", "engineering"]);
  });

  it("orders tasks by craft name descending", () => {
    const tasks = [
      task({ id: "art", craft: { id: "c2", name: "Art", color: "red" } }),
      task({
        id: "engineering",
        craft: { id: "c1", name: "Engineering", color: "blue" },
      }),
      task({ id: "audio", craft: { id: "c3", name: "Audio", color: "teal" } }),
    ];

    const sorted = sortTasks(tasks, { field: "craft", direction: "desc" });

    expect(ids(sorted)).toEqual(["engineering", "audio", "art"]);
  });

  it("keeps tasks with no craft last when sorting craft ascending", () => {
    const tasks = [
      task({ id: "none", craft: null }),
      task({
        id: "engineering",
        craft: { id: "c1", name: "Engineering", color: "blue" },
      }),
      task({ id: "art", craft: { id: "c2", name: "Art", color: "red" } }),
    ];

    const sorted = sortTasks(tasks, { field: "craft", direction: "asc" });

    expect(ids(sorted)).toEqual(["art", "engineering", "none"]);
  });

  it("keeps tasks with no craft last when sorting craft descending", () => {
    const tasks = [
      task({ id: "none", craft: null }),
      task({ id: "art", craft: { id: "c2", name: "Art", color: "red" } }),
      task({
        id: "engineering",
        craft: { id: "c1", name: "Engineering", color: "blue" },
      }),
    ];

    const sorted = sortTasks(tasks, { field: "craft", direction: "desc" });

    expect(ids(sorted)).toEqual(["engineering", "art", "none"]);
  });

  it("returns tasks untouched when sorting by position", () => {
    const tasks = [
      task({ id: "second", position: 1 }),
      task({ id: "first", position: 0 }),
    ];

    const sorted = sortTasks(tasks, { field: "position", direction: "asc" });

    expect(ids(sorted)).toEqual(["second", "first"]);
  });

  it("orders tasks with no due date last", () => {
    const tasks = [
      task({ id: "none", dueDate: null }),
      task({ id: "later", dueDate: "2026-03-01T00:00:00.000Z" }),
      task({ id: "sooner", dueDate: "2026-02-01T00:00:00.000Z" }),
    ];

    const sorted = sortTasks(tasks, { field: "dueDate", direction: "asc" });

    expect(ids(sorted)).toEqual(["sooner", "later", "none"]);
  });

  it("orders tasks by priority weight rather than alphabetically", () => {
    const tasks = [
      task({ id: "low", priority: "low" }),
      task({ id: "urgent", priority: "urgent" }),
      task({ id: "medium", priority: "medium" }),
    ];

    const sorted = sortTasks(tasks, { field: "priority", direction: "desc" });

    expect(ids(sorted)).toEqual(["urgent", "medium", "low"]);
  });
});
