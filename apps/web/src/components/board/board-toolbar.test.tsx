import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectWithTasks } from "@/types/project";
import BoardToolbar from "./board-toolbar";

const datesEnabled = vi.hoisted(() => ({ value: true }));

vi.mock("@/hooks/use-dates-enabled", () => ({
  useDatesEnabled: () => datesEnabled.value,
  useShowDueDates: () => datesEnabled.value,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/lib/i18n/domain", () => ({
  getPriorityLabel: (priority: string) => priority,
}));

vi.mock("@/hooks/queries/craft/use-get-crafts-by-workspace", () => ({
  default: () => ({ data: [] }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  datesEnabled.value = true;
});

const project = {
  id: "project-1",
  name: "Project",
  slug: "KAN",
  workspaceId: "workspace-1",
  columns: [],
} as unknown as ProjectWithTasks;

function renderToolbar(
  viewMode: "board" | "list" | "table",
  setViewMode = vi.fn(),
) {
  render(
    <BoardToolbar
      project={project}
      filters={{
        status: null,
        priority: null,
        assignee: null,
        dueDate: null,
        labels: null,
        craft: null,
      }}
      updateFilter={vi.fn()}
      updateLabelFilter={vi.fn()}
      clearFilters={vi.fn()}
      hasActiveFilters={false}
      workspaceLabels={[]}
      viewMode={viewMode}
      setViewMode={setViewMode}
      sort={{ field: "position", direction: "asc" }}
      onSortChange={vi.fn()}
    />,
  );
  return setViewMode;
}

describe("BoardToolbar view switcher", () => {
  it("offers a table view alongside board and list", () => {
    renderToolbar("board");

    expect(screen.getByText("tasks:view.board")).toBeInTheDocument();
    expect(screen.getByText("tasks:view.list")).toBeInTheDocument();
    expect(screen.getByText("tasks:view.table")).toBeInTheDocument();
  });

  it("switches to the table view when the table button is clicked", () => {
    const setViewMode = renderToolbar("board");

    fireEvent.click(screen.getByText("tasks:view.table"));

    expect(setViewMode).toHaveBeenCalledWith("table");
  });

  it("marks the table button as current when the table view is active", () => {
    renderToolbar("table");

    expect(
      screen.getByText("tasks:view.table").closest("button"),
    ).toHaveAttribute("aria-current", "page");
  });

  it("does not mark the table button as current for another view", () => {
    renderToolbar("list");

    expect(
      screen.getByText("tasks:view.table").closest("button"),
    ).not.toHaveAttribute("aria-current");
  });
});

describe("BoardToolbar with dates disabled", () => {
  it("omits the due date filter subject", async () => {
    datesEnabled.value = false;
    renderToolbar("board");
    fireEvent.click(screen.getByText("common:actions.filter"));
    expect(
      await screen.findByText("tasks:boardFilters.subjects.priority"),
    ).toBeVisible();
    expect(
      screen.queryByText("tasks:boardFilters.subjects.dueDate"),
    ).not.toBeInTheDocument();
    datesEnabled.value = true;
  });

  it("still shows a stale due date filter as a clearable chip", () => {
    datesEnabled.value = false;
    const updateFilter = vi.fn();
    render(
      <BoardToolbar
        project={project}
        filters={{
          status: null,
          priority: null,
          assignee: null,
          dueDate: ["dueThisWeek"],
          labels: null,
          craft: null,
        }}
        updateFilter={updateFilter}
        updateLabelFilter={vi.fn()}
        clearFilters={vi.fn()}
        hasActiveFilters={true}
        workspaceLabels={[]}
        viewMode="board"
        setViewMode={vi.fn()}
        sort={{ field: "position", direction: "asc" }}
        onSortChange={vi.fn()}
      />,
    );

    const chipSubject = screen.getByText("tasks:boardFilters.subjects.dueDate");
    const clearButton = chipSubject.closest("div")?.querySelector("button");
    expect(clearButton).toBeTruthy();

    fireEvent.click(clearButton as HTMLButtonElement);

    expect(updateFilter).toHaveBeenCalledWith("dueDate", null);
  });
});
