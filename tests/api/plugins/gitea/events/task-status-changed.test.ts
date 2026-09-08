import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleTaskCreated } from "../../../../../apps/api/src/plugins/gitea/events/task-created";
import { handleTaskStatusChanged } from "../../../../../apps/api/src/plugins/gitea/events/task-status-changed";

const mocks = vi.hoisted(() => {
  const mockCreateIssue = vi.fn();
  const mockUpdateIssue = vi.fn();
  const mockFindExternalLinksByTask = vi.fn();
  const mockFindExternalLinkByTaskAndType = vi.fn();
  const mockCreateExternalLink = vi.fn();
  const mockUpdateExternalLink = vi.fn();
  const mockAddLabelsToIssueGitea = vi.fn();
  const mockRemoveLabelGitea = vi.fn();
  const mockTaskFindFirst = vi.fn();

  return {
    mockCreateIssue,
    mockUpdateIssue,
    mockFindExternalLinksByTask,
    mockFindExternalLinkByTaskAndType,
    mockCreateExternalLink,
    mockUpdateExternalLink,
    mockAddLabelsToIssueGitea,
    mockRemoveLabelGitea,
    mockTaskFindFirst,
    mockDb: {
      query: { taskTable: { findFirst: mockTaskFindFirst } },
    },
  };
});

vi.mock("../../../../../apps/api/src/database", () => ({
  default: mocks.mockDb,
}));

vi.mock("../../../../../apps/api/src/plugins/gitea/utils/gitea-api", () => ({
  createGiteaClient: () => ({
    createIssue: mocks.mockCreateIssue,
    updateIssue: mocks.mockUpdateIssue,
  }),
}));

vi.mock("../../../../../apps/api/src/plugins/gitea/utils/labels", () => ({
  addLabelsToIssueGitea: (...args: unknown[]) =>
    mocks.mockAddLabelsToIssueGitea(...args),
  removeLabelGitea: (...args: unknown[]) => mocks.mockRemoveLabelGitea(...args),
}));

vi.mock(
  "../../../../../apps/api/src/plugins/github/services/link-manager",
  () => ({
    findExternalLinksByTask: (...args: unknown[]) =>
      mocks.mockFindExternalLinksByTask(...args),
    findExternalLinkByTaskAndType: (...args: unknown[]) =>
      mocks.mockFindExternalLinkByTaskAndType(...args),
    createExternalLink: (...args: unknown[]) =>
      mocks.mockCreateExternalLink(...args),
    updateExternalLink: (...args: unknown[]) =>
      mocks.mockUpdateExternalLink(...args),
  }),
);

const context = {
  integrationId: "integration-1",
  projectId: "project-1",
  config: {
    baseUrl: "https://gitea.studio555.io",
    accessToken: "token",
    repositoryOwner: "Studio555",
    repositoryName: "s555-atlas",
  },
};

function statusChange(oldStatus: string, newStatus: string) {
  return {
    taskId: "task-1",
    projectId: "project-1",
    userId: "user-1",
    oldStatus,
    newStatus,
    title: "TEST",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.mockFindExternalLinksByTask.mockResolvedValue([]);
  mocks.mockFindExternalLinkByTaskAndType.mockResolvedValue(undefined);
  mocks.mockCreateExternalLink.mockResolvedValue({ id: "link-new" });
  mocks.mockAddLabelsToIssueGitea.mockResolvedValue(undefined);
  mocks.mockRemoveLabelGitea.mockResolvedValue(undefined);
  mocks.mockUpdateIssue.mockResolvedValue({});
  mocks.mockCreateIssue.mockResolvedValue({
    number: 42,
    html_url: "https://gitea.studio555.io/Studio555/s555-atlas/issues/42",
    title: "Rework the onboarding flow",
    state: "open",
  });
  mocks.mockTaskFindFirst.mockResolvedValue({
    id: "task-1",
    projectId: "project-1",
    number: 7,
    title: "Rework the onboarding flow",
    description: "Long overdue",
    priority: "high",
    status: "to-do",
    craft: null,
  });
});

describe("handleTaskStatusChanged", () => {
  it("opens the issue when a backlog task first reaches a board column", async () => {
    await handleTaskStatusChanged(
      statusChange("planned", "to-do") as Parameters<
        typeof handleTaskStatusChanged
      >[0],
      context as Parameters<typeof handleTaskStatusChanged>[1],
    );

    expect(mocks.mockCreateIssue).toHaveBeenCalledWith(
      "Studio555",
      "s555-atlas",
      expect.objectContaining({ title: "Rework the onboarding flow" }),
    );
    expect(mocks.mockAddLabelsToIssueGitea).toHaveBeenCalledWith(
      context.config,
      42,
      ["priority:high", "status:to-do"],
      undefined,
    );
    expect(mocks.mockCreateExternalLink).toHaveBeenCalledWith(
      expect.objectContaining({ externalId: "42" }),
    );
    expect(mocks.mockRemoveLabelGitea).not.toHaveBeenCalled();
  });

  it("leaves a task without an issue when it moves between backlog buckets", async () => {
    await handleTaskStatusChanged(
      statusChange("planned", "archived") as Parameters<
        typeof handleTaskStatusChanged
      >[0],
      context as Parameters<typeof handleTaskStatusChanged>[1],
    );

    expect(mocks.mockCreateIssue).not.toHaveBeenCalled();
    expect(mocks.mockCreateExternalLink).not.toHaveBeenCalled();
  });

  it("closes the issue it just opened when a backlog task moves straight to done", async () => {
    await handleTaskStatusChanged(
      statusChange("planned", "done") as Parameters<
        typeof handleTaskStatusChanged
      >[0],
      context as Parameters<typeof handleTaskStatusChanged>[1],
    );

    expect(mocks.mockCreateIssue).toHaveBeenCalledTimes(1);
    expect(mocks.mockUpdateIssue).toHaveBeenCalledWith(
      "Studio555",
      "s555-atlas",
      42,
      { state: "closed" },
    );

    const [linkId, update] = mocks.mockUpdateExternalLink.mock.calls[0];
    expect(linkId).toBe("link-new");
    expect(update.metadata.state).toBe("closed");
  });

  it("opens one issue when task creation and a status change race", async () => {
    // publishEvent emits without awaiting its handlers, so a task created in a
    // column and moved seconds later has both handlers in flight at once. Both
    // can see no issue link; only one of them may open an issue.
    let stored:
      | {
          id: string;
          taskId: string;
          integrationId: string;
          resourceType: string;
          externalId: string;
          metadata: string;
        }
      | undefined;
    mocks.mockFindExternalLinkByTaskAndType.mockImplementation(
      async () => stored,
    );
    mocks.mockFindExternalLinksByTask.mockImplementation(async () =>
      stored ? [stored] : [],
    );
    mocks.mockCreateExternalLink.mockImplementation(async () => {
      stored = {
        id: "link-new",
        taskId: "task-1",
        integrationId: "integration-1",
        resourceType: "issue",
        externalId: "42",
        metadata: JSON.stringify({ state: "open", createdFrom: "kaneo" }),
      };
      return { id: "link-new" };
    });
    // A real forge round trip leaves both handlers past their link check
    // before either writes one.
    mocks.mockCreateIssue.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return {
        number: 42,
        html_url: "https://gitea.studio555.io/Studio555/s555-atlas/issues/42",
        title: "Rework the onboarding flow",
        state: "open",
      };
    });

    await Promise.all([
      handleTaskCreated(
        {
          taskId: "task-1",
          projectId: "project-1",
          userId: "user-1",
          title: "Rework the onboarding flow",
          description: "Long overdue",
          priority: "high",
          status: "to-do",
          number: 7,
          craftName: null,
          craftColor: null,
        } as Parameters<typeof handleTaskCreated>[0],
        context as Parameters<typeof handleTaskCreated>[1],
      ),
      handleTaskStatusChanged(
        statusChange("to-do", "in-progress") as Parameters<
          typeof handleTaskStatusChanged
        >[0],
        context as Parameters<typeof handleTaskStatusChanged>[1],
      ),
    ]);

    expect(mocks.mockCreateIssue).toHaveBeenCalledTimes(1);
    expect(mocks.mockCreateExternalLink).toHaveBeenCalledTimes(1);
    // The status change still has to land on whichever issue was opened.
    expect(mocks.mockRemoveLabelGitea).toHaveBeenCalledWith(
      context.config,
      42,
      "status:to-do",
    );
    expect(mocks.mockAddLabelsToIssueGitea).toHaveBeenCalledWith(
      context.config,
      42,
      ["status:in-progress"],
    );
  });

  it("syncs labels for a task that already has an issue", async () => {
    mocks.mockFindExternalLinksByTask.mockResolvedValue([
      {
        id: "link-1",
        taskId: "task-1",
        integrationId: "integration-1",
        resourceType: "issue",
        externalId: "2",
        metadata: JSON.stringify({ state: "open", createdFrom: "kaneo" }),
      },
    ]);

    await handleTaskStatusChanged(
      statusChange("to-do", "in-progress") as Parameters<
        typeof handleTaskStatusChanged
      >[0],
      context as Parameters<typeof handleTaskStatusChanged>[1],
    );

    expect(mocks.mockRemoveLabelGitea).toHaveBeenCalledWith(
      context.config,
      2,
      "status:to-do",
    );
    expect(mocks.mockAddLabelsToIssueGitea).toHaveBeenCalledWith(
      context.config,
      2,
      ["status:in-progress"],
    );
    expect(mocks.mockCreateIssue).not.toHaveBeenCalled();
  });
});
