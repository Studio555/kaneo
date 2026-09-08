import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectWithTasks } from "@/types/project";
import type Task from "@/types/task";
import TableView from "./index";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("@/hooks/use-keyboard-shortcuts", () => ({
  useRegisterShortcuts: vi.fn(),
}));

vi.mock("@/hooks/mutations/task/use-update-task", () => ({
  useUpdateTask: () => ({ mutate: vi.fn() }),
}));

vi.mock("@/hooks/use-dates-enabled", () => ({
  useDatesEnabled: () => true,
  useShowDueDates: () => true,
}));

vi.mock("@/hooks/use-task-column-dnd", () => ({
  useTaskColumnDnd: () => ({
    sensors: [],
    activeId: null,
    activeTask: null,
    overColumnId: null,
    handleDragStart: vi.fn(),
    handleDragOver: vi.fn(),
    handleDragEnd: vi.fn(),
  }),
}));

vi.mock("./task-table-row", () => ({
  default: ({ task }: { task: Task }) => (
    <div data-testid="task-row">{task.title}</div>
  ),
}));

vi.mock("../bulk-selection/bulk-toolbar", () => ({ default: () => null }));
vi.mock("../shared/modals/create-task-modal", () => ({ default: () => null }));
vi.mock("../shared/modals/archive-tasks-modal", () => ({
  ArchiveTasksModal: () => null,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function task(id: string, title: string, status: string): Task {
  return {
    id,
    title,
    number: 1,
    description: null,
    status,
    priority: null,
    startDate: null,
    dueDate: null,
    position: 0,
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
    columns: [
      {
        id: "to-do",
        slug: "to-do",
        name: "To Do",
        icon: null,
        isFinal: false,
        tasks: [
          task("a", "First task", "to-do"),
          task("b", "Second task", "to-do"),
        ],
      },
      {
        id: "done",
        slug: "done",
        name: "Done",
        icon: null,
        isFinal: true,
        tasks: [task("c", "Third task", "done")],
      },
    ],
  } as unknown as ProjectWithTasks;
}

const manualSort = { field: "position", direction: "asc" } as const;

function renderTable(
  onSortChange = vi.fn(),
  sort: { field: string; direction: string } = manualSort,
) {
  render(
    <TableView
      project={project()}
      sort={sort as never}
      onSortChange={onSortChange}
    />,
  );
  return onSortChange;
}

describe("TableView", () => {
  it("renders a header for every visible column", () => {
    renderTable();

    expect(screen.getByText("tasks:table.columns.name")).toBeInTheDocument();
    expect(screen.getByText("tasks:status.label")).toBeInTheDocument();
    expect(screen.getByText("tasks:assignee.label")).toBeInTheDocument();
    expect(screen.getByText("tasks:priority.label")).toBeInTheDocument();
    expect(screen.getByText("tasks:dueDate.label")).toBeInTheDocument();
    expect(screen.getByText("tasks:properties.labels")).toBeInTheDocument();
    expect(screen.getByText("tasks:properties.craft")).toBeInTheDocument();
  });

  it("sorts by craft when the craft header is clicked", () => {
    const onSortChange = renderTable();

    fireEvent.click(screen.getByText("tasks:properties.craft"));

    expect(onSortChange).toHaveBeenCalledWith({
      field: "craft",
      direction: "asc",
    });
  });

  it("groups tasks into a section per status with a task count", () => {
    renderTable();

    expect(screen.getByText("To Do")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("renders a row for every task across sections", () => {
    renderTable();

    expect(screen.getAllByTestId("task-row")).toHaveLength(3);
  });

  it("hides the rows of a collapsed section", () => {
    renderTable();

    fireEvent.click(screen.getByRole("button", { name: /To Do/ }));

    expect(screen.queryByText("First task")).not.toBeInTheDocument();
    expect(screen.getByText("Third task")).toBeInTheDocument();
  });

  it("sorts by the clicked column header", () => {
    const onSortChange = renderTable();

    fireEvent.click(screen.getByText("tasks:priority.label"));

    expect(onSortChange).toHaveBeenCalledWith({
      field: "priority",
      direction: "desc",
    });
  });

  it("flips direction when the active sort column is clicked again", () => {
    const onSortChange = renderTable(vi.fn(), {
      field: "title",
      direction: "asc",
    });

    fireEvent.click(screen.getByText("tasks:table.columns.name"));

    expect(onSortChange).toHaveBeenCalledWith({
      field: "title",
      direction: "desc",
    });
  });

  it("does not make the status header sortable, since status is the grouping", () => {
    const onSortChange = renderTable();

    fireEvent.click(screen.getByText("tasks:status.label"));

    expect(onSortChange).not.toHaveBeenCalled();
  });

  it("does not make the labels header sortable", () => {
    const onSortChange = renderTable();

    fireEvent.click(screen.getByText("tasks:properties.labels"));

    expect(onSortChange).not.toHaveBeenCalled();
  });

  it("announces the active sort direction on the sorted column", () => {
    renderTable(vi.fn(), { field: "dueDate", direction: "asc" });

    const dueDateHeader = screen
      .getByText("tasks:dueDate.label")
      .closest("button");

    expect(dueDateHeader).toHaveTextContent("tasks:sort.ascending");
  });

  it("announces the reversed direction when sorted descending", () => {
    renderTable(vi.fn(), { field: "priority", direction: "desc" });

    const priorityHeader = screen
      .getByText("tasks:priority.label")
      .closest("button");

    expect(priorityHeader).toHaveTextContent("tasks:sort.descending");
  });

  it("does not announce a sort direction on unsorted columns", () => {
    renderTable(vi.fn(), { field: "dueDate", direction: "asc" });

    const priorityHeader = screen
      .getByText("tasks:priority.label")
      .closest("button");

    expect(priorityHeader).not.toHaveTextContent("tasks:sort.ascending");
    expect(priorityHeader).not.toHaveTextContent("tasks:sort.descending");
  });

  it("shows an empty message for a status with no tasks", () => {
    render(
      <TableView
        project={
          {
            ...project(),
            columns: [
              {
                id: "to-do",
                slug: "to-do",
                name: "To Do",
                icon: null,
                isFinal: false,
                tasks: [],
              },
            ],
          } as unknown as ProjectWithTasks
        }
        sort={manualSort as never}
        onSortChange={vi.fn()}
      />,
    );

    expect(screen.getByText("tasks:listView.noTasks")).toBeInTheDocument();
  });
});
