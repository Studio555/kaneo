import type {
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
} from "@dnd-kit/core";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectWithTasks } from "@/types/project";
import type Task from "@/types/task";
import { useBacklogSectionDnd } from "./use-backlog-section-dnd";

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
    columns: [],
    plannedTasks: [
      task("p1", "planned", 0),
      task("p2", "planned", 1),
      task("p3", "planned", 2),
    ],
    archivedTasks: [task("a1", "archived", 0)],
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

function payloads() {
  return updateTask.mock.calls.map(([payload]) => payload);
}

describe("useBacklogSectionDnd", () => {
  it("archives a planned task dropped on the archived section", () => {
    const { result } = renderHook(() => useBacklogSectionDnd(project()));

    act(() => {
      result.current.handleDragStart(start("p1"));
      result.current.handleDragEnd(end("p1", "archived"));
    });

    expect(updateTask).toHaveBeenCalledWith(
      expect.objectContaining({ id: "p1", status: "archived" }),
    );
  });

  it("un-archives a task dropped back on the planned section", () => {
    const { result } = renderHook(() => useBacklogSectionDnd(project()));

    act(() => {
      result.current.handleDragStart(start("a1"));
      result.current.handleDragEnd(end("a1", "planned"));
    });

    expect(updateTask).toHaveBeenCalledWith(
      expect.objectContaining({ id: "a1", status: "planned" }),
    );
  });

  it("reindexes the destination section so positions stay contiguous", () => {
    const { result } = renderHook(() => useBacklogSectionDnd(project()));

    act(() => {
      result.current.handleDragStart(start("p1"));
      result.current.handleDragEnd(end("p1", "archived"));
    });

    const archived = payloads().filter(
      (payload) => payload.status === "archived",
    );

    expect(archived.map((payload) => payload.position)).toEqual([0, 1]);
  });

  it("reorders within the planned section without changing status", () => {
    const { result } = renderHook(() => useBacklogSectionDnd(project()));

    act(() => {
      result.current.handleDragStart(start("p1"));
      result.current.handleDragEnd(end("p1", "p2"));
    });

    const updates = payloads();

    expect(updates.every((payload) => payload.status === "planned")).toBe(true);
    expect(updates.map((payload) => payload.id)).toEqual(["p2", "p1", "p3"]);
  });

  it("leaves the order untouched when a task is dropped on itself", () => {
    const { result } = renderHook(() => useBacklogSectionDnd(project()));

    act(() => {
      result.current.handleDragStart(start("p1"));
      result.current.handleDragEnd(end("p1", "p1"));
    });

    expect(updateTask).not.toHaveBeenCalled();
    expect(setProject).not.toHaveBeenCalled();
  });

  it("ignores a drop outside any section", () => {
    const { result } = renderHook(() => useBacklogSectionDnd(project()));

    act(() => {
      result.current.handleDragStart(start("p1"));
      result.current.handleDragEnd(end("p1", null));
    });

    expect(updateTask).not.toHaveBeenCalled();
    expect(setProject).not.toHaveBeenCalled();
  });

  it("ignores a drop on a task that is in neither section", () => {
    const { result } = renderHook(() => useBacklogSectionDnd(project()));

    act(() => {
      result.current.handleDragStart(start("p1"));
      result.current.handleDragEnd(end("p1", "not-a-task"));
    });

    expect(updateTask).not.toHaveBeenCalled();
  });

  it("tracks the section under the cursor while dragging over a task", () => {
    const { result } = renderHook(() => useBacklogSectionDnd(project()));

    act(() => {
      result.current.handleDragStart(start("p1"));
    });
    act(() => {
      result.current.handleDragOver(over("a1"));
    });

    expect(result.current.overSectionId).toBe("archived");
  });

  it("tracks the section under the cursor while dragging over the section itself", () => {
    const { result } = renderHook(() => useBacklogSectionDnd(project()));

    act(() => {
      result.current.handleDragStart(start("p1"));
    });
    act(() => {
      result.current.handleDragOver(over("planned"));
    });

    expect(result.current.overSectionId).toBe("planned");
  });

  it("clears the drag state once the drop completes", () => {
    const { result } = renderHook(() => useBacklogSectionDnd(project()));

    act(() => {
      result.current.handleDragStart(start("p1"));
    });
    act(() => {
      result.current.handleDragOver(over("archived"));
    });
    act(() => {
      result.current.handleDragEnd(end("p1", "archived"));
    });

    expect(result.current.activeId).toBeNull();
    expect(result.current.overSectionId).toBeNull();
  });

  it("clears the drag state when a drag is cancelled", () => {
    const { result } = renderHook(() => useBacklogSectionDnd(project()));

    act(() => {
      result.current.handleDragStart(start("p1"));
    });
    act(() => {
      result.current.handleDragOver(over("archived"));
    });
    act(() => {
      result.current.handleDragCancel();
    });

    expect(result.current.activeId).toBeNull();
    expect(result.current.overSectionId).toBeNull();
  });

  it("exposes the task being dragged so a drag overlay can render it", () => {
    const { result } = renderHook(() => useBacklogSectionDnd(project()));

    act(() => {
      result.current.handleDragStart(start("a1"));
    });

    expect(result.current.activeTask?.id).toBe("a1");
  });

  it("withholds the keyboard sensor while dragging is disabled", () => {
    const enabled = renderHook(() => useBacklogSectionDnd(project()));
    const disabled = renderHook(() =>
      useBacklogSectionDnd(project(), { disabled: true }),
    );

    expect(disabled.result.current.sensors.length).toBe(
      enabled.result.current.sensors.length - 1,
    );
  });
});
