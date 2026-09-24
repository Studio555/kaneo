import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleTaskCreated } from "../../../../../apps/api/src/plugins/github/events/task-created";
import { handleTaskStatusChanged } from "../../../../../apps/api/src/plugins/github/events/task-status-changed";

// A custom backlog section is only known from its column row, so the mock
// answers for the one this file uses; the built-in slugs need no lookup.
const backlogStatus = vi.hoisted(() => ({
  isBacklogStatus: vi.fn(async (_projectId: string, status: string) =>
    ["planned", "archived", "icebox"].includes(status),
  ),
}));

vi.mock(
  "../../../../../apps/api/src/plugins/backlog-status",
  () => backlogStatus,
);

const mocks = vi.hoisted(() => {
  const mockGetGithubApp = vi.fn();
  const mockGetInstallationOctokit = vi.fn();
  const mockFindExternalLinksByTask = vi.fn();
  const mockFindExternalLinkByTaskAndType = vi.fn();
  const mockCreateExternalLink = vi.fn();
  const mockUpdateExternalLink = vi.fn();
  const mockAddLabelsToIssue = vi.fn();
  const mockRemoveLabel = vi.fn();
  const mockUpdateIssue = vi.fn();
  const mockCreateIssue = vi.fn();
  const mockCreateComment = vi.fn();
  const mockTaskFindFirst = vi.fn();
  const mockProjectFindFirst = vi.fn();

  const mockOctokit = {
    rest: {
      issues: {
        update: mockUpdateIssue,
        create: mockCreateIssue,
        createComment: mockCreateComment,
      },
    },
  };

  return {
    mockGetGithubApp,
    mockGetInstallationOctokit,
    mockFindExternalLinksByTask,
    mockFindExternalLinkByTaskAndType,
    mockCreateExternalLink,
    mockUpdateExternalLink,
    mockAddLabelsToIssue,
    mockRemoveLabel,
    mockUpdateIssue,
    mockCreateIssue,
    mockCreateComment,
    mockTaskFindFirst,
    mockProjectFindFirst,
    mockOctokit,
    mockGithubApp: { getInstallationOctokit: mockGetInstallationOctokit },
    mockDb: {
      query: {
        taskTable: { findFirst: mockTaskFindFirst },
        projectTable: { findFirst: mockProjectFindFirst },
      },
    },
  };
});

vi.mock("../../../../../apps/api/src/database", () => ({
  default: mocks.mockDb,
}));

vi.mock("../../../../../apps/api/src/plugins/github/utils/github-app", () => ({
  getGithubApp: () => mocks.mockGetGithubApp(),
  getInstallationIdForRepo: async () => 123,
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

vi.mock("../../../../../apps/api/src/plugins/github/utils/labels", () => ({
  addLabelsToIssue: (...args: unknown[]) => mocks.mockAddLabelsToIssue(...args),
  removeLabel: (...args: unknown[]) => mocks.mockRemoveLabel(...args),
}));

const context = {
  integrationId: "integration-1",
  projectId: "project-1",
  config: {
    repositoryOwner: "Studio555",
    repositoryName: "s555-atlas",
    installationId: 123,
    commentTaskLinkOnGitHubIssue: false,
  },
};

function issueLink(metadata: Record<string, unknown> | null) {
  return {
    id: "link-1",
    taskId: "task-1",
    integrationId: "integration-1",
    resourceType: "issue",
    externalId: "2",
    metadata: metadata ? JSON.stringify(metadata) : null,
  };
}

function statusChange(oldStatus: string, newStatus: string) {
  return {
    taskId: "task-1",
    projectId: "project-1",
    userId: "user-1",
    oldStatus,
    newStatus,
    title: "TEST",
    assigneeId: null,
    type: "status_changed",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.mockGetGithubApp.mockReturnValue(mocks.mockGithubApp);
  mocks.mockGetInstallationOctokit.mockResolvedValue(mocks.mockOctokit);
  mocks.mockFindExternalLinksByTask.mockResolvedValue([
    issueLink({ state: "open", createdFrom: "kaneo" }),
  ]);
  mocks.mockFindExternalLinkByTaskAndType.mockResolvedValue(undefined);
  mocks.mockAddLabelsToIssue.mockResolvedValue(undefined);
  mocks.mockRemoveLabel.mockResolvedValue(undefined);
  mocks.mockUpdateIssue.mockResolvedValue({});
  mocks.mockUpdateExternalLink.mockResolvedValue(undefined);
  mocks.mockCreateExternalLink.mockResolvedValue({ id: "link-new" });
  mocks.mockCreateIssue.mockResolvedValue({
    data: {
      number: 42,
      html_url: "https://github.com/Studio555/s555-atlas/issues/42",
      title: "Rework the onboarding flow",
      state: "open",
    },
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
  it("stamps the outbound sync time when it closes the issue", async () => {
    // The inbound webhook handlers compare this stamp against the event's
    // updated_at to tell Kaneo's own write apart from a real user action.
    const before = Date.now();

    await handleTaskStatusChanged(
      {
        taskId: "task-1",
        projectId: "project-1",
        userId: "user-1",
        oldStatus: "to-do",
        newStatus: "done",
        title: "TEST",
        assigneeId: null,
        type: "status_changed",
      } as Parameters<typeof handleTaskStatusChanged>[0],
      context as Parameters<typeof handleTaskStatusChanged>[1],
    );

    expect(mocks.mockUpdateIssue).toHaveBeenCalledWith(
      expect.objectContaining({ issue_number: 2, state: "closed" }),
    );

    const [, update] = mocks.mockUpdateExternalLink.mock.calls[0];
    expect(update.metadata.state).toBe("closed");
    expect(update.metadata.createdFrom).toBe("kaneo");
    expect(update.metadata.lastOutboundStateSyncAt).toBeGreaterThanOrEqual(
      before,
    );
    expect(update.metadata.lastOutboundStateSyncAt).toBeLessThanOrEqual(
      Date.now(),
    );
  });

  it("stamps the outbound sync time when it reopens the issue", async () => {
    mocks.mockFindExternalLinksByTask.mockResolvedValue([
      issueLink({ state: "closed", createdFrom: "kaneo" }),
    ]);
    const before = Date.now();

    await handleTaskStatusChanged(
      {
        taskId: "task-1",
        projectId: "project-1",
        userId: "user-1",
        oldStatus: "done",
        newStatus: "to-do",
        title: "TEST",
        assigneeId: null,
        type: "status_changed",
      } as Parameters<typeof handleTaskStatusChanged>[0],
      context as Parameters<typeof handleTaskStatusChanged>[1],
    );

    expect(mocks.mockUpdateIssue).toHaveBeenCalledWith(
      expect.objectContaining({ issue_number: 2, state: "open" }),
    );

    const [, update] = mocks.mockUpdateExternalLink.mock.calls[0];
    expect(update.metadata.state).toBe("open");
    expect(update.metadata.lastOutboundStateSyncAt).toBeGreaterThanOrEqual(
      before,
    );
  });

  it("survives a link whose metadata row cannot be parsed", async () => {
    // A truncated row used to throw out of the handler, losing the label and
    // state sync for a status change that did happen.
    mocks.mockFindExternalLinksByTask.mockResolvedValue([
      { ...issueLink(null), metadata: '{"state":"op' },
    ]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await handleTaskStatusChanged(
      {
        taskId: "task-1",
        projectId: "project-1",
        userId: "user-1",
        oldStatus: "to-do",
        newStatus: "done",
        title: "TEST",
        assigneeId: null,
        type: "status_changed",
      } as Parameters<typeof handleTaskStatusChanged>[0],
      context as Parameters<typeof handleTaskStatusChanged>[1],
    );

    expect(mocks.mockUpdateIssue).toHaveBeenCalledWith(
      expect.objectContaining({ state: "closed" }),
    );
    const [, update] = mocks.mockUpdateExternalLink.mock.calls[0];
    expect(update.metadata.state).toBe("closed");
    expect(warn).toHaveBeenCalled();
  });

  it("opens the issue when a backlog task first reaches a board column", async () => {
    // task.created skipped the issue while the task was planned, so the move
    // out of the backlog is what commits it to the forge.
    mocks.mockFindExternalLinksByTask.mockResolvedValue([]);

    await handleTaskStatusChanged(
      statusChange("planned", "to-do") as Parameters<
        typeof handleTaskStatusChanged
      >[0],
      context as Parameters<typeof handleTaskStatusChanged>[1],
    );

    expect(mocks.mockCreateIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "Studio555",
        repo: "s555-atlas",
        title: "Rework the onboarding flow",
      }),
    );
    expect(mocks.mockAddLabelsToIssue).toHaveBeenCalledWith(
      mocks.mockOctokit,
      "Studio555",
      "s555-atlas",
      42,
      ["priority:high", "status:to-do"],
      undefined,
    );
    expect(mocks.mockCreateExternalLink).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "task-1",
        integrationId: "integration-1",
        resourceType: "issue",
        externalId: "42",
      }),
    );
    // Nothing to swap: the issue was born with the new status label.
    expect(mocks.mockRemoveLabel).not.toHaveBeenCalled();
  });

  it("labels the new issue with the craft the task carries", async () => {
    mocks.mockFindExternalLinksByTask.mockResolvedValue([]);
    mocks.mockTaskFindFirst.mockResolvedValue({
      id: "task-1",
      projectId: "project-1",
      number: 7,
      title: "Rework the onboarding flow",
      description: null,
      priority: "no-priority",
      status: "in-progress",
      craft: { name: "Design", color: "8B5CF6" },
    });

    await handleTaskStatusChanged(
      statusChange("planned", "in-progress") as Parameters<
        typeof handleTaskStatusChanged
      >[0],
      context as Parameters<typeof handleTaskStatusChanged>[1],
    );

    expect(mocks.mockAddLabelsToIssue).toHaveBeenCalledWith(
      mocks.mockOctokit,
      "Studio555",
      "s555-atlas",
      42,
      ["status:in-progress", "craft:Design"],
      { "craft:Design": "8B5CF6" },
    );
  });

  it("leaves a task without an issue when it moves between backlog buckets", async () => {
    mocks.mockFindExternalLinksByTask.mockResolvedValue([]);

    await handleTaskStatusChanged(
      statusChange("planned", "archived") as Parameters<
        typeof handleTaskStatusChanged
      >[0],
      context as Parameters<typeof handleTaskStatusChanged>[1],
    );

    expect(mocks.mockCreateIssue).not.toHaveBeenCalled();
    expect(mocks.mockCreateExternalLink).not.toHaveBeenCalled();
  });

  it("leaves a task without an issue when it moves into a custom backlog section", async () => {
    mocks.mockFindExternalLinksByTask.mockResolvedValue([]);

    await handleTaskStatusChanged(
      statusChange("planned", "icebox") as Parameters<
        typeof handleTaskStatusChanged
      >[0],
      context as Parameters<typeof handleTaskStatusChanged>[1],
    );

    expect(backlogStatus.isBacklogStatus).toHaveBeenCalledWith(
      "project-1",
      "icebox",
    );
    expect(mocks.mockCreateIssue).not.toHaveBeenCalled();
    expect(mocks.mockCreateExternalLink).not.toHaveBeenCalled();
  });

  it("closes the issue it just opened when a backlog task moves straight to done", async () => {
    mocks.mockFindExternalLinksByTask.mockResolvedValue([]);
    mocks.mockTaskFindFirst.mockResolvedValue({
      id: "task-1",
      projectId: "project-1",
      number: 7,
      title: "Rework the onboarding flow",
      description: null,
      priority: "no-priority",
      status: "done",
      craft: null,
    });

    await handleTaskStatusChanged(
      statusChange("planned", "done") as Parameters<
        typeof handleTaskStatusChanged
      >[0],
      context as Parameters<typeof handleTaskStatusChanged>[1],
    );

    expect(mocks.mockCreateIssue).toHaveBeenCalledTimes(1);
    expect(mocks.mockUpdateIssue).toHaveBeenCalledWith(
      expect.objectContaining({ issue_number: 42, state: "closed" }),
    );

    const [linkId, update] = mocks.mockUpdateExternalLink.mock.calls[0];
    expect(linkId).toBe("link-new");
    expect(update.metadata.state).toBe("closed");
    expect(update.metadata.createdFrom).toBe("kaneo");
  });

  it("opens one issue when task creation and a status change race", async () => {
    // publishEvent emits without awaiting its handlers, so a task created in a
    // column and moved seconds later has both handlers in flight at once. Both
    // can see no issue link; only one of them may open an issue.
    let stored: ReturnType<typeof issueLink> | undefined;
    mocks.mockFindExternalLinkByTaskAndType.mockImplementation(
      async () => stored,
    );
    mocks.mockFindExternalLinksByTask.mockImplementation(async () =>
      stored ? [stored] : [],
    );
    mocks.mockCreateExternalLink.mockImplementation(async () => {
      stored = {
        ...issueLink({ state: "open", createdFrom: "kaneo" }),
        id: "link-new",
        externalId: "42",
      };
      return { id: "link-new" };
    });
    // A real forge round trip leaves both handlers past their link check
    // before either writes one.
    mocks.mockCreateIssue.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return {
        data: {
          number: 42,
          html_url: "https://github.com/Studio555/s555-atlas/issues/42",
          title: "Rework the onboarding flow",
          state: "open",
        },
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
    expect(mocks.mockRemoveLabel).toHaveBeenCalledWith(
      mocks.mockOctokit,
      "Studio555",
      "s555-atlas",
      42,
      "status:to-do",
    );
    expect(mocks.mockAddLabelsToIssue).toHaveBeenCalledWith(
      mocks.mockOctokit,
      "Studio555",
      "s555-atlas",
      42,
      ["status:in-progress"],
    );
  });

  it("does nothing when the task row is gone", async () => {
    mocks.mockFindExternalLinksByTask.mockResolvedValue([]);
    mocks.mockTaskFindFirst.mockResolvedValue(undefined);

    await handleTaskStatusChanged(
      statusChange("planned", "to-do") as Parameters<
        typeof handleTaskStatusChanged
      >[0],
      context as Parameters<typeof handleTaskStatusChanged>[1],
    );

    expect(mocks.mockCreateIssue).not.toHaveBeenCalled();
  });
});
