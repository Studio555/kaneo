import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { ProjectWithTasks } from "@/types/project";
import type Task from "@/types/task";
import BacklogTableView from "./index";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("@/components/project/task-view-keys/use-task-view-shortcuts", () => ({
  useTaskViewShortcuts: vi.fn(),
}));

vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({ canUpdateProjects: () => true }),
}));

vi.mock("../backlog-sections/backlog-section-menu", () => ({
  BacklogSectionMenu: ({ section }: { section: { name: string } }) => (
    <button type="button">menu:{section.name}</button>
  ),
}));

vi.mock("@/hooks/use-backlog-section-dnd", () => ({
  backlogSectionDropId: (slug: string) => `backlog-section:${slug}`,
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
    backlogSections: [
      {
        id: "planned",
        columnId: "column-planned",
        slug: "planned",
        name: "Planned",
        icon: null,
        color: null,
        systemKey: "planned" as const,
        tasks: [
          task("p1", "Draft the spec", "planned"),
          task("p2", "Spike the parser", "planned"),
        ],
      },
      {
        id: "archived",
        columnId: "column-archived",
        slug: "archived",
        name: "Archived",
        icon: null,
        color: null,
        systemKey: "archived" as const,
        tasks: [task("a1", "Old idea", "archived")],
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
            backlogSections: project().backlogSections.map((section) =>
              section.systemKey === "archived"
                ? { ...section, tasks: [] }
                : section,
            ),
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

  it("renders custom sections by name, with a menu only they get", () => {
    const base = project();
    const [planned, archived] = base.backlogSections;
    render(
      <BacklogTableView
        project={
          {
            ...base,
            backlogSections: [
              planned,
              {
                id: "icebox",
                columnId: "column-icebox",
                slug: "icebox",
                name: "Icebox",
                icon: null,
                color: null,
                systemKey: null,
                tasks: [task("i1", "Someday", "icebox")],
              },
              archived,
            ],
          } as unknown as ProjectWithTasks
        }
        sort={manualSort as never}
        onSortChange={vi.fn()}
      />,
    );

    expect(screen.getByText("Icebox")).toBeInTheDocument();
    expect(
      screen.getByText("tasks:backlog.sections.planned"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("tasks:backlog.sections.archived"),
    ).toBeInTheDocument();
    expect(
      screen
        .getAllByRole("button", { name: /^menu:/ })
        .map((b) => b.textContent),
    ).toEqual(["menu:Icebox"]);
    // Every live section takes new tasks; the archive does not.
    expect(screen.getAllByTitle("tasks:backlog.addTask")).toHaveLength(2);
  });
});
