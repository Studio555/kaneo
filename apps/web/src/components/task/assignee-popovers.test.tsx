import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type Task from "@/types/task";
import SubtaskAssigneePopover from "./subtask-assignee-popover";
import TaskAssigneePopover from "./task-assignee-popover";

const { updateTaskAssignee } = vi.hoisted(() => ({
  updateTaskAssignee: vi.fn(async () => {}),
}));

vi.mock("@/hooks/mutations/task/use-update-task-assignee", () => ({
  useUpdateTaskAssignee: () => ({ mutateAsync: updateTaskAssignee }),
}));
vi.mock(
  "@/hooks/queries/workspace-users/use-get-active-workspace-users",
  () => ({
    useGetActiveWorkspaceUsers: () => ({
      data: {
        members: [
          ...Array.from({ length: 45 }, (_, index) => ({
            userId: `user-${index}`,
            user: {
              name: `Member ${index}`,
              email: `member${index}@example.com`,
            },
          })),
          {
            userId: "alice",
            user: { name: "Alice Adams", email: "alice@example.com" },
          },
        ],
      },
    }),
  }),
);
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({ canAssignTasks: () => true }),
}));
vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn() } }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const task: Task = {
  id: "task-1",
  title: "Task",
  number: 1,
  description: null,
  status: "todo",
  priority: null,
  startDate: null,
  dueDate: null,
  position: 0,
  createdAt: "2026-10-02T00:00:00.000Z",
  userId: "alice",
  assigneeId: "alice",
  assigneeName: "Alice Adams",
  projectId: "project-1",
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe.each(["task", "subtasks"])("%s assignee search", (kind) => {
  function renderPicker() {
    const trigger = <button type="button">Assign person</button>;
    render(
      kind === "task" ? (
        <TaskAssigneePopover task={task} workspaceId="workspace-1">
          {trigger}
        </TaskAssigneePopover>
      ) : (
        <SubtaskAssigneePopover tasks={[task]} workspaceId="workspace-1">
          {trigger}
        </SubtaskAssigneePopover>
      ),
    );
    fireEvent.click(screen.getByText("Assign person"));
    return screen.findByRole("combobox", {
      name: "tasks:popover.assignee.searchPlaceholder",
    });
  }

  it("finds people beyond the initial page by name and email and assigns them", async () => {
    const search = await renderPicker();
    await vi.waitFor(() => expect(search).toHaveFocus());
    expect(screen.queryByText("Alice Adams")).toBeNull();
    fireEvent.change(search, { target: { value: "  ALICE  " } });
    expect(screen.getByText("Alice Adams")).toBeTruthy();
    expect(screen.queryByText("Member 0")).toBeNull();
    fireEvent.change(search, { target: { value: "ALICE@" } });
    fireEvent.click(screen.getByText("Alice Adams"));
    await vi.waitFor(() =>
      expect(updateTaskAssignee).toHaveBeenCalledWith({
        ...task,
        userId: "alice",
      }),
    );
    await vi.waitFor(() => expect(search).not.toBeInTheDocument());
    fireEvent.click(screen.getByText("Assign person"));
    expect(
      await screen.findByRole("combobox", {
        name: "tasks:popover.assignee.searchPlaceholder",
      }),
    ).toHaveValue("");
    expect(screen.getByText("Member 0")).toBeTruthy();
  });

  it("keeps unassignment available when there are no matches", async () => {
    const search = await renderPicker();
    fireEvent.change(search, { target: { value: "Nobody" } });
    expect(screen.getByRole("status")).toHaveTextContent(
      "tasks:popover.assignee.empty",
    );
    fireEvent.click(screen.getByText("tasks:popover.assignee.unassigned"));
    await vi.waitFor(() =>
      expect(updateTaskAssignee).toHaveBeenCalledWith({ ...task, userId: "" }),
    );
  });

  it("uses filtered people for number shortcuts and allows numbers in the search", async () => {
    const search = await renderPicker();
    fireEvent.change(search, { target: { value: "Member 44" } });
    fireEvent.keyDown(search, { key: "2" });
    expect(updateTaskAssignee).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByText("Member 44"), { key: "2" });
    await vi.waitFor(() =>
      expect(updateTaskAssignee).toHaveBeenCalledWith({
        ...task,
        userId: "user-44",
      }),
    );
  });
});
