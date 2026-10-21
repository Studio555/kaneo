import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type Task from "@/types/task";
import SubtaskAssigneePopover from "./subtask-assignee-popover";
import TaskAssigneePopover from "./task-assignee-popover";

const { updateTaskAssignee, members } = vi.hoisted(() => ({
  updateTaskAssignee: vi.fn(async () => {}),
  members: [
    ...Array.from({ length: 45 }, (_, index) => ({
      id: `user-${index}`,
      name: `Member ${index}`,
      email: `member${index}@example.com`,
      image: null,
    })),
    {
      id: "alice",
      name: "Alice Adams",
      email: "alice@example.com",
      image: null,
    },
  ],
}));

vi.mock("@/hooks/mutations/task/use-update-task-assignee", () => ({
  useUpdateTaskAssignee: () => ({ mutateAsync: updateTaskAssignee }),
}));
vi.mock("@/hooks/queries/workspace-users/use-get-project-members", () => ({
  default: () => ({ data: members }),
}));
vi.mock("@/hooks/queries/workspace-users/use-get-members-of-projects", () => ({
  default: () => ({ data: members, isLoading: false }),
}));
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
  userId: "user-0",
  assigneeId: "user-0",
  assigneeName: "Member 0",
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
    return screen.findByRole("combobox", { name: "tasks:assignee.label" });
  }

  it("finds people by name and email and assigns them", async () => {
    const search = await renderPicker();
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
  });
});
