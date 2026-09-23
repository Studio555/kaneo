import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Task from "@/types/task";
import { getVisibleTableColumns } from "./columns";
import TaskTableRow from "./task-table-row";

const navigate = vi.fn();
const useGetColumns = vi.fn();
const useGetLabelsByTask = vi.fn((_taskId: string) => ({ data: [] }));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/lib/i18n/domain", () => ({
  getPriorityLabel: (priority: string) => `priority:${priority}`,
  getStatusDisplayLabel: (status: string, columnName?: string) =>
    columnName ?? status,
}));

vi.mock("@/hooks/queries/column/use-get-columns", () => ({
  useGetColumns: (projectId: string) => useGetColumns(projectId),
}));

vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "workspace-1" } }),
}));

vi.mock(
  "@/hooks/queries/workspace-users/use-get-active-workspace-users",
  () => ({
    useGetActiveWorkspaceUsers: () => ({
      data: {
        members: [
          {
            userId: "user-1",
            user: { name: "Ada Lovelace", image: null },
          },
        ],
      },
    }),
  }),
);

vi.mock("@/hooks/queries/label/use-get-labels-by-workspace", () => ({
  default: () => ({ data: [] }),
}));

vi.mock("@/hooks/queries/craft/use-get-crafts-by-workspace", () => ({
  default: () => ({
    data: [
      { id: "craft-1", name: "Engineering", color: "blue" },
      { id: "craft-2", name: "Art", color: "red" },
    ],
  }),
}));

vi.mock("@/hooks/mutations/task/use-update-task-craft", () => ({
  useUpdateTaskCraft: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("@/hooks/queries/label/use-get-labels-by-task", () => ({
  default: (taskId: string) => useGetLabelsByTask(taskId),
}));

vi.mock("@/hooks/mutations/task/use-delete-task", () => ({
  useDeleteTask: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("@/hooks/mutations/task/use-update-task-status", () => ({
  useUpdateTaskStatus: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("@/hooks/mutations/task/use-update-task-assignee", () => ({
  useUpdateTaskAssignee: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("@/hooks/mutations/task/use-update-task-status-priority", () => ({
  useUpdateTaskPriority: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("@/hooks/mutations/task/use-update-task-due-date", () => ({
  useUpdateTaskDueDate: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("@/hooks/mutations/label/use-attach-label-to-task", () => ({
  default: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("@/hooks/mutations/label/use-detach-label-from-task", () => ({
  default: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("@/hooks/mutations/label/use-create-label", () => ({
  default: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("@/hooks/use-numbered-shortcuts", () => ({
  useNumberedShortcuts: vi.fn(),
}));

vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canUpdateTasks: () => true,
    canDeleteTasks: () => true,
    canAssignTasks: () => true,
    canCreateLabels: () => true,
    canUpdateLabels: () => true,
  }),
}));

vi.mock(
  "../kanban-board/task-card-context-menu/task-card-context-menu-content",
  () => ({ default: () => null }),
);

const task: Task = {
  id: "task-1",
  title: "Wire up the table view",
  number: 3,
  description: null,
  status: "to-do",
  priority: "high",
  startDate: null,
  dueDate: "2026-09-20T00:00:00.000Z",
  position: 0,
  createdAt: "2026-09-01T00:00:00.000Z",
  userId: "user-1",
  assigneeId: "user-1",
  assigneeName: "Ada Lovelace",
  projectId: "project-1",
  labels: [{ id: "label-1", name: "frontend", color: "blue" }],
  craftId: "craft-1",
  craft: { id: "craft-1", name: "Engineering", color: "blue" },
};

const allColumns = getVisibleTableColumns({
  showAssignees: true,
  showDueDates: true,
  showLabels: true,
  showPriority: true,
});

beforeEach(() => {
  useGetColumns.mockReturnValue({
    data: [
      {
        id: "to-do",
        slug: "to-do",
        name: "To Do",
        icon: null,
        isFinal: false,
      },
      { id: "done", slug: "done", name: "Done", icon: null, isFinal: true },
    ],
    isLoading: false,
    isError: false,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderRow(overrides: Partial<Task> = {}, columns = allColumns) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <TaskTableRow
        task={{ ...task, ...overrides }}
        projectSlug="KAN"
        columns={columns}
      />
    </QueryClientProvider>,
  );
}

function cell(key: string) {
  return document.querySelector<HTMLElement>(`[data-column="${key}"]`);
}

function cellTrigger(key: string) {
  const element = cell(key);
  if (!element) throw new Error(`no ${key} cell rendered`);
  return within(element).getByRole("button");
}

describe("TaskTableRow", () => {
  it("shows the task number and title in the name cell", () => {
    renderRow();

    expect(screen.getByText("KAN-3")).toBeInTheDocument();
    expect(screen.getByText("Wire up the table view")).toBeInTheDocument();
  });

  it("shows the current assignee name in the assignee cell", () => {
    renderRow();

    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
  });

  it("shows an unassigned affordance when the task has no assignee", () => {
    renderRow({ userId: null, assigneeId: null, assigneeName: null });

    expect(screen.getByText("tasks:assignee.unassigned")).toBeInTheDocument();
  });

  it("shows the current priority in the priority cell", () => {
    renderRow();

    expect(screen.getByText("priority:high")).toBeInTheDocument();
  });

  it("shows the current craft in the craft cell", () => {
    renderRow();

    expect(screen.getByText("Engineering")).toBeInTheDocument();
  });

  it("shows a no-craft affordance when the task has no craft", () => {
    renderRow({ craftId: null, craft: null });

    expect(screen.getByText("tasks:popover.craft.none")).toBeInTheDocument();
  });

  it("opens the craft picker from the craft cell", async () => {
    renderRow();

    fireEvent.click(cellTrigger("craft"));

    expect(await screen.findByText("Art")).toBeVisible();
  });

  it("shows the task labels in the labels cell", () => {
    renderRow();

    expect(screen.getByText("frontend")).toBeInTheDocument();
  });

  it("renders no assignee cell when the assignee column is hidden", () => {
    renderRow(
      {},
      getVisibleTableColumns({
        showAssignees: false,
        showDueDates: true,
        showLabels: true,
        showPriority: true,
      }),
    );

    expect(cell("assignee")).toBeNull();
    expect(screen.queryByText("Ada Lovelace")).not.toBeInTheDocument();
  });

  it("opens the status picker from the status cell", async () => {
    renderRow();

    fireEvent.click(cellTrigger("status"));

    expect(await screen.findByText("Done")).toBeVisible();
  });

  it("opens the assignee picker from the assignee cell", async () => {
    renderRow();

    fireEvent.click(cellTrigger("assignee"));

    expect(
      await screen.findByText("tasks:popover.assignee.unassigned"),
    ).toBeVisible();
  });

  it("opens the priority picker from the priority cell", async () => {
    renderRow();

    fireEvent.click(cellTrigger("priority"));

    expect(await screen.findByText("priority:urgent")).toBeVisible();
  });

  it("opens the label picker on the first click of the labels cell", async () => {
    renderRow();

    fireEvent.click(cellTrigger("labels"));

    expect(
      await screen.findByPlaceholderText(
        "tasks:popover.labels.searchPlaceholder",
      ),
    ).toBeVisible();
    expect(useGetLabelsByTask).toHaveBeenCalledWith("task-1");
  });

  it("does not query labels for a row whose picker was never opened", () => {
    renderRow();

    expect(useGetLabelsByTask).not.toHaveBeenCalled();
  });

  it("does not open the task detail sheet when an editable cell is clicked", () => {
    renderRow();

    fireEvent.click(cellTrigger("assignee"));

    expect(navigate).not.toHaveBeenCalled();
  });

  it("opens the task detail sheet when the name cell is clicked", () => {
    renderRow();

    fireEvent.click(screen.getByText("Wire up the table view"));

    expect(navigate).toHaveBeenCalledWith(
      expect.objectContaining({ search: { taskId: "task-1" } }),
    );
  });

  describe("subtasks", () => {
    function renderTreeRow(
      props: Partial<ComponentProps<typeof TaskTableRow>>,
    ) {
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      render(
        <QueryClientProvider client={queryClient}>
          <TaskTableRow
            task={task}
            projectSlug="KAN"
            columns={allColumns}
            {...props}
          />
        </QueryClientProvider>,
      );
    }

    it("toggles a parent's subtasks without opening the task", () => {
      const onToggleExpanded = vi.fn();
      renderTreeRow({ childCount: 2, onToggleExpanded });

      const toggle = screen.getByRole("button", {
        name: "tasks:listView.expandSubtasks",
      });
      expect(toggle).toHaveAttribute("aria-expanded", "false");

      fireEvent.click(toggle);

      expect(onToggleExpanded).toHaveBeenCalledOnce();
      expect(navigate).not.toHaveBeenCalled();
    });

    it("marks an expanded parent as expanded", () => {
      renderTreeRow({ childCount: 1, isExpanded: true });

      expect(
        screen.getByRole("button", { name: "tasks:listView.collapseSubtasks" }),
      ).toHaveAttribute("aria-expanded", "true");
    });

    it("renders a nested row as an openable, non-draggable button", () => {
      renderTreeRow({ depth: 1, rowId: "parent/task-1" });

      const row = document.querySelector<HTMLElement>(
        '[style*="grid-template-columns"]',
      );
      expect(row).toHaveAttribute("role", "button");
      // dnd-kit's attributes would carry aria-roledescription "sortable".
      expect(row).not.toHaveAttribute("aria-roledescription");
      expect(
        screen.getByText("tasks:listView.subtaskLevel"),
      ).toBeInTheDocument();

      fireEvent.click(row as HTMLElement);
      expect(navigate).toHaveBeenCalled();
    });
  });
});
