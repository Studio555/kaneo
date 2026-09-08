import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectWithTasks } from "@/types/project";
import type Task from "@/types/task";
import BacklogTableView from "./index";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("@/hooks/use-keyboard-shortcuts", () => ({
  useRegisterShortcuts: vi.fn(),
}));

vi.mock("@/hooks/use-backlog-section-dnd", () => ({
  useBacklogSectionDnd: () => ({
    sensors: [],
    activeId: null,
    activeTask: null,
    overSectionId: null,
    handleDragStart: vi.fn(),
    handleDragOver: vi.fn(),
    handleDragEnd: vi.fn(),
    handleDragCancel: vi.fn(),
  }),
}));

vi.mock("../table-view/task-table-row", () => ({
  default: ({ task }: { task: Task }) => (
    <div data-testid="task-row">{task.title}</div>
  ),
}));

vi.mock("../bulk-selection/backlog-bulk-toolbar", () => ({
  default: () => null,
}));
vi.mock("../shared/modals/create-task-modal", () => ({ default: () => null }));

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
    columns: [],
    plannedTasks: [
      task("p1", "Draft the spec", "planned"),
      task("p2", "Spike the parser", "planned"),
    ],
    archivedTasks: [task("a1", "Old idea", "archived")],
  } as unknown as ProjectWithTasks;
}

const manualSort = { field: "position", direction: "asc" } as const;

function renderTable(
  onSortChange = vi.fn(),
  sort: { field: string; direction: string } = manualSort,
) {
  render(
    <BacklogTableView
      project={project()}
      sort={sort as never}
      onSortChange={onSortChange}
    />,
  );
  return onSortChange;
}

describe("BacklogTableView", () => {
  it("renders a header for every column it shows", () => {
    renderTable();

    expect(screen.getByText("tasks:table.columns.name")).toBeInTheDocument();
    expect(screen.getByText("tasks:assignee.label")).toBeInTheDocument();
    expect(screen.getByText("tasks:priority.label")).toBeInTheDocument();
    expect(screen.getByText("tasks:dueDate.label")).toBeInTheDocument();
    expect(screen.getByText("tasks:properties.craft")).toBeInTheDocument();
    expect(screen.getByText("tasks:properties.labels")).toBeInTheDocument();
  });

  it("omits the status column, since the section already is the status", () => {
    renderTable();

    expect(screen.queryByText("tasks:status.label")).not.toBeInTheDocument();
  });

  it("groups tasks into a planned and an archived section", () => {
    renderTable();

    expect(
      screen.getByText("tasks:backlog.sections.planned"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("tasks:backlog.sections.archived"),
    ).toBeInTheDocument();
  });

  it("renders a row for every task across both sections", () => {
    renderTable();

    expect(screen.getAllByTestId("task-row")).toHaveLength(3);
  });

  it("hides the rows of a collapsed section", () => {
    renderTable();

    fireEvent.click(screen.getByText("tasks:backlog.sections.planned"));

    expect(screen.queryByText("Draft the spec")).not.toBeInTheDocument();
    expect(screen.getByText("Old idea")).toBeInTheDocument();
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

  it("does not make the labels header sortable", () => {
    const onSortChange = renderTable();

    fireEvent.click(screen.getByText("tasks:properties.labels"));

    expect(onSortChange).not.toHaveBeenCalled();
  });

  it("announces the active sort direction on the sorted column", () => {
    renderTable(vi.fn(), { field: "dueDate", direction: "asc" });

    expect(
      screen.getByText("tasks:dueDate.label").closest("button"),
    ).toHaveTextContent("tasks:sort.ascending");
  });

  it("shows an empty message for a section with no tasks", () => {
    render(
      <BacklogTableView
        project={
          {
            ...project(),
            archivedTasks: [],
          } as unknown as ProjectWithTasks
        }
        sort={manualSort as never}
        onSortChange={vi.fn()}
      />,
    );

    expect(
      screen.getByText("tasks:backlog.noTasksInSection"),
    ).toBeInTheDocument();
  });
});
