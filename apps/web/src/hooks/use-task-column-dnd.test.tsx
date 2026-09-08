import type {
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
} from "@dnd-kit/core";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectWithTasks } from "@/types/project";
import type Task from "@/types/task";
import { useTaskColumnDnd } from "./use-task-column-dnd";

const updateTask = vi.fn();
const setProject = vi.fn();

vi.mock("@/hooks/mutations/task/use-update-task", () => ({
  useUpdateTask: () => ({ mutate: updateTask }),
}));

vi.mock("@/store/project", () => ({
  default: () => ({ setProject }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

function task(id: string, status: string, position: number): Task {
  return {
    id,
    title: id,
    number: 1,
    description: null,
    status,
    priority: null,
    startDate: null,
    dueDate: null,
    position,
    createdAt: "2026-01-01T00:00:00.000Z",
    userId: null,
    assigneeId: null,
    assigneeName: null,
    projectId: "project-1",
  };
}

function project(): ProjectWithTasks {
  return {
    id: "project-1",
    name: "Project",
    slug: "KAN",
    workspaceId: "workspace-1",
    icon: null,
    isPublic: false,
    columns: [
      {
        id: "to-do",
        name: "To Do",
        slug: "to-do",
        icon: null,
        isFinal: false,
        tasks: [task("a", "to-do", 0), task("b", "to-do", 1)],
      },
      {
        id: "done",
        name: "Done",
        slug: "done",
        icon: null,
        isFinal: true,
        tasks: [task("c", "done", 0)],
      },
    ],
  } as unknown as ProjectWithTasks;
}

const start = (id: string) => ({ active: { id } }) as DragStartEvent;
const over = (id: string | null) =>
  ({ over: id === null ? null : { id } }) as DragOverEvent;
const end = (activeId: string, overId: string | null) =>
  ({
    active: { id: activeId },
    over: overId === null ? null : { id: overId },
  }) as DragEndEvent;

describe("useTaskColumnDnd", () => {
  it("moves a task to the column it was dropped on and takes that column's status", () => {
    const { result } = renderHook(() => useTaskColumnDnd(project()));

    act(() => {
      result.current.handleDragStart(start("a"));
      result.current.handleDragEnd(end("a", "done"));
    });

    expect(updateTask).toHaveBeenCalledWith(
      expect.objectContaining({ id: "a", status: "done" }),
    );
  });

  it("reindexes the destination column so positions stay contiguous", () => {
    const { result } = renderHook(() => useTaskColumnDnd(project()));

    act(() => {
      result.current.handleDragStart(start("a"));
      result.current.handleDragEnd(end("a", "done"));
    });

    const destinationUpdates = updateTask.mock.calls
      .map(([payload]) => payload)
      .filter((payload) => payload.status === "done");

    expect(destinationUpdates.map((payload) => payload.position)).toEqual([
      0, 1,
    ]);
  });

  it("reorders within a column without changing status", () => {
    const { result } = renderHook(() => useTaskColumnDnd(project()));

    act(() => {
      result.current.handleDragStart(start("a"));
      result.current.handleDragEnd(end("a", "b"));
    });

    const updates = updateTask.mock.calls.map(([payload]) => payload);

    expect(updates.every((payload) => payload.status === "to-do")).toBe(true);
    expect(updates.map((payload) => payload.id)).toEqual(["b", "a"]);
  });

  it("leaves the order untouched when a task is dropped on itself", () => {
    const { result } = renderHook(() => useTaskColumnDnd(project()));

    act(() => {
      result.current.handleDragStart(start("a"));
      result.current.handleDragEnd(end("a", "a"));
    });

    expect(updateTask).not.toHaveBeenCalled();
    expect(setProject).not.toHaveBeenCalled();
  });

  it("clears the drag state when a drag is cancelled", () => {
    const { result } = renderHook(() => useTaskColumnDnd(project()));

    act(() => {
      result.current.handleDragStart(start("a"));
    });
    act(() => {
      result.current.handleDragOver(over("done"));
    });
    act(() => {
      result.current.handleDragCancel();
    });

    expect(result.current.activeId).toBeNull();
    expect(result.current.overColumnId).toBeNull();
  });

  it("withholds the keyboard sensor while dragging is disabled", () => {
    const enabled = renderHook(() => useTaskColumnDnd(project()));
    const disabled = renderHook(() =>
      useTaskColumnDnd(project(), { disabled: true }),
    );

    // A keyboard drag has no activation constraint to push out of reach, so the
    // sensor has to be absent or a sorted list stays keyboard-reorderable.
    expect(disabled.result.current.sensors.length).toBe(
      enabled.result.current.sensors.length - 1,
    );
  });

  it("ignores a drop outside any column", () => {
    const { result } = renderHook(() => useTaskColumnDnd(project()));

    act(() => {
      result.current.handleDragStart(start("a"));
      result.current.handleDragEnd(end("a", null));
    });

    expect(updateTask).not.toHaveBeenCalled();
    expect(setProject).not.toHaveBeenCalled();
  });

  it("tracks the column under the cursor while dragging over a task", () => {
    const { result } = renderHook(() => useTaskColumnDnd(project()));

    act(() => {
      result.current.handleDragStart(start("a"));
    });
    act(() => {
      result.current.handleDragOver(over("c"));
    });

    expect(result.current.overColumnId).toBe("done");
  });

  it("tracks the column under the cursor while dragging over the column itself", () => {
    const { result } = renderHook(() => useTaskColumnDnd(project()));

    act(() => {
      result.current.handleDragStart(start("a"));
    });
    act(() => {
      result.current.handleDragOver(over("done"));
    });

    expect(result.current.overColumnId).toBe("done");
  });

  it("clears the drag state once the drop completes", () => {
    const { result } = renderHook(() => useTaskColumnDnd(project()));

    act(() => {
      result.current.handleDragStart(start("a"));
    });
    act(() => {
      result.current.handleDragOver(over("done"));
    });
    act(() => {
      result.current.handleDragEnd(end("a", "done"));
    });

    expect(result.current.activeId).toBeNull();
    expect(result.current.overColumnId).toBeNull();
  });

  it("exposes the task being dragged so a drag overlay can render it", () => {
    const current = project();
    const { result } = renderHook(() => useTaskColumnDnd(current));

    act(() => {
      result.current.handleDragStart(start("b"));
    });

    expect(result.current.activeTask?.id).toBe("b");
  });
});
