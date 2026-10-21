import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
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
  const mockCreateIssue = vi.fn();
  const mockOctokit = {
    rest: {
      issues: {
        create: mockCreateIssue,
        update: vi.fn(),
        createComment: vi.fn(),
      },
    },
  };
  return {
    mockGetGithubApp: vi.fn(),
    mockGetVerifiedInstallationOctokit: vi.fn(),
    mockFindExternalLinksByTask: vi.fn(),
    mockFindExternalLinkByTaskAndType: vi.fn(),
    mockCreateExternalLink: vi.fn(),
    mockAddLabelsToIssue: vi.fn(),
    mockInitializeTaskIssue: vi.fn(),
    mockSyncTaskFieldLabels: vi.fn(),
    mockFindTaskWithCraft: vi.fn(),
    mockTaskRow: vi.fn(),
    mockCreateIssue,
    mockOctokit,
    mockDb: { query: { projectTable: { findFirst: vi.fn() } } },
  };
});

vi.mock("../../../../../apps/api/src/database", () => ({
  default: mocks.mockDb,
}));

vi.mock("../../../../../apps/api/src/plugins/github/utils/github-app", () => ({
  getGithubApp: () => mocks.mockGetGithubApp(),
  getVerifiedInstallationOctokit: (...args: unknown[]) =>
    mocks.mockGetVerifiedInstallationOctokit(...args),
}));

vi.mock("../../../../../apps/api/src/plugins/sync/eligibility", () => ({
  canSyncTask: async () => true,
}));

// Stands in for the lease and the task re-read: the issue is built from the
// task row as it is now, not from the status event.
vi.mock("../../../../../apps/api/src/plugins/sync/create-task-issue", () => ({
  withTaskSyncCreation: async (
    event: Record<string, unknown>,
    _context: unknown,
    create: (current: unknown) => Promise<void>,
  ) => {
    const task = await mocks.mockTaskRow();
    if (!task) return;
    await create({ ...event, ...task, taskId: task.id });
  },
}));

vi.mock(
  "../../../../../apps/api/src/plugins/sync/initialize-task-issue",
  () => ({
    initializeTaskIssue: (...args: unknown[]) =>
      mocks.mockInitializeTaskIssue(...args),
    isIssueInitializationPending: () => false,
  }),
);

vi.mock(
  "../../../../../apps/api/src/plugins/sync/sync-task-field-labels",
  () => ({
    syncTaskFieldLabels: (...args: unknown[]) =>
      mocks.mockSyncTaskFieldLabels(...args),
  }),
);

vi.mock(
  "../../../../../apps/api/src/plugins/github/services/link-manager",
  () => ({
    findExternalLinksByTask: (...args: unknown[]) =>
      mocks.mockFindExternalLinksByTask(...args),
    findExternalLinkByTaskAndType: (...args: unknown[]) =>
      mocks.mockFindExternalLinkByTaskAndType(...args),
    createExternalLink: (...args: unknown[]) =>
      mocks.mockCreateExternalLink(...args),
    updateExternalLink: vi.fn(),
  }),
);

vi.mock(
  "../../../../../apps/api/src/plugins/github/services/task-service",
  () => ({
    findTaskWithCraft: (...args: unknown[]) =>
      mocks.mockFindTaskWithCraft(...args),
  }),
);

vi.mock(
  "../../../../../apps/api/src/plugins/github/services/issue-hierarchy",
  () => ({ reconcileIssueHierarchySafely: vi.fn() }),
);

vi.mock(
  "../../../../../apps/api/src/plugins/github/utils/sync-issue-assignee",
  () => ({ syncIssueAssignee: vi.fn() }),
);

vi.mock("../../../../../apps/api/src/plugins/github/utils/labels", () => ({
  addLabelsToIssue: (...args: unknown[]) => mocks.mockAddLabelsToIssue(...args),
  removeLabel: vi.fn(),
}));

const context = {
  integrationId: "integration-1",
  projectId: "project-1",
  config: {
    repositoryOwner: "Studio555",
    repositoryName: "s555-atlas",
    installationId: 123,
    repositoryId: 456,
    verifiedGithubAccountId: "789",
    verifiedByUserId: "user-1",
    commentTaskLinkOnGitHubIssue: false,
  },
};

function taskRow(status: string) {
  return {
    id: "task-1",
    projectId: "project-1",
    number: 7,
    title: "Rework the onboarding flow",
    description: "Long overdue",
    priority: "high",
    status,
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
  } as Parameters<typeof handleTaskStatusChanged>[0];
}

async function move(oldStatus: string, newStatus: string) {
  mocks.mockTaskRow.mockResolvedValue(taskRow(newStatus));
  await handleTaskStatusChanged(
    statusChange(oldStatus, newStatus),
    context as Parameters<typeof handleTaskStatusChanged>[1],
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.mockGetGithubApp.mockReturnValue({});
  mocks.mockGetVerifiedInstallationOctokit.mockResolvedValue(mocks.mockOctokit);
  mocks.mockFindExternalLinksByTask.mockResolvedValue([]);
  mocks.mockFindExternalLinkByTaskAndType.mockResolvedValue(undefined);
  mocks.mockCreateExternalLink.mockResolvedValue({ id: "link-new" });
  mocks.mockSyncTaskFieldLabels.mockResolvedValue(undefined);
  mocks.mockCreateIssue.mockResolvedValue({
    data: {
      number: 42,
      html_url: "https://github.com/Studio555/s555-atlas/issues/42",
      title: "Rework the onboarding flow",
      state: "open",
    },
  });
  mocks.mockFindTaskWithCraft.mockResolvedValue({
    id: "task-1",
    userId: null,
    craft: null,
  });
});

describe("handleTaskStatusChanged", () => {
  it("opens the issue when a backlog task first reaches a board column", async () => {
    // task.created skipped the issue while the task was planned, so the move
    // out of the backlog is what commits it to the forge.
    await move("planned", "to-do");

    expect(mocks.mockCreateIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "Studio555",
        repo: "s555-atlas",
        title: "Rework the onboarding flow",
      }),
    );
    expect(mocks.mockCreateExternalLink).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "task-1",
        integrationId: "integration-1",
        resourceType: "issue",
        externalId: "42",
      }),
    );
    expect(mocks.mockInitializeTaskIssue).toHaveBeenCalledWith(
      expect.objectContaining({ status: "to-do" }),
      context,
      { id: "link-new" },
      expect.any(Object),
    );
  });

  it("labels the new issue with the craft the task carries", async () => {
    mocks.mockFindTaskWithCraft.mockResolvedValue({
      id: "task-1",
      userId: null,
      craft: { name: "Design", color: "8B5CF6" },
    });

    await move("planned", "in-progress");

    expect(mocks.mockAddLabelsToIssue).toHaveBeenCalledWith(
      mocks.mockOctokit,
      "Studio555",
      "s555-atlas",
      42,
      ["craft:Design"],
      false,
      undefined,
      { "craft:Design": "8B5CF6" },
    );
  });

  it("leaves a task without an issue when it moves between backlog buckets", async () => {
    await move("planned", "archived");

    expect(mocks.mockCreateIssue).not.toHaveBeenCalled();
    expect(mocks.mockCreateExternalLink).not.toHaveBeenCalled();
  });

  it("leaves a task without an issue when it moves into a custom backlog section", async () => {
    await move("planned", "icebox");

    expect(backlogStatus.isBacklogStatus).toHaveBeenCalledWith(
      "project-1",
      "icebox",
    );
    expect(mocks.mockCreateIssue).not.toHaveBeenCalled();
    expect(mocks.mockCreateExternalLink).not.toHaveBeenCalled();
  });

  it("initializes the issue it opens as done when a backlog task moves straight to done", async () => {
    await move("planned", "done");

    expect(mocks.mockCreateIssue).toHaveBeenCalledTimes(1);
    // Initialization sets the issue state from the task, closing it here.
    expect(mocks.mockInitializeTaskIssue).toHaveBeenCalledWith(
      expect.objectContaining({ status: "done" }),
      context,
      { id: "link-new" },
      expect.any(Object),
    );
  });

  it("syncs the existing issue instead of opening another", async () => {
    mocks.mockFindExternalLinksByTask.mockResolvedValue([
      {
        id: "link-1",
        taskId: "task-1",
        integrationId: "integration-1",
        resourceType: "issue",
        externalId: "2",
        metadata: null,
      },
    ]);

    await move("to-do", "in-progress");

    expect(mocks.mockCreateIssue).not.toHaveBeenCalled();
    expect(mocks.mockSyncTaskFieldLabels).toHaveBeenCalledWith(
      "task-1",
      context,
      expect.objectContaining({ id: "link-1" }),
      "github",
      "status",
      expect.any(Function),
    );
  });

  it("does nothing when the task row is gone", async () => {
    mocks.mockTaskRow.mockResolvedValue(undefined);
    await handleTaskStatusChanged(
      statusChange("planned", "to-do"),
      context as Parameters<typeof handleTaskStatusChanged>[1],
    );

    expect(mocks.mockCreateIssue).not.toHaveBeenCalled();
  });
});
