import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { handleTaskCreated } from "../../../../../apps/api/src/plugins/github/events/task-created";

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
    rest: { issues: { create: mockCreateIssue, createComment: vi.fn() } },
  };
  return {
    mockGetGithubApp: vi.fn(),
    mockGetVerifiedInstallationOctokit: vi.fn(),
    mockFindExternalLinkByTaskAndType: vi.fn(),
    mockCreateExternalLink: vi.fn(),
    mockAddLabelsToIssue: vi.fn(),
    mockCreateIssue,
    mockSyncIssueAssignee: vi.fn(),
    mockFindTaskWithCraft: vi.fn(),
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

vi.mock("../../../../../apps/api/src/plugins/sync/create-task-issue", () => ({
  withTaskSyncCreation: (
    event: unknown,
    _context: unknown,
    create: (current: unknown) => Promise<void>,
  ) => create(event),
}));

vi.mock(
  "../../../../../apps/api/src/plugins/sync/initialize-task-issue",
  () => ({
    initializeTaskIssue: vi.fn(),
    isIssueInitializationPending: () => false,
  }),
);

vi.mock(
  "../../../../../apps/api/src/plugins/github/services/link-manager",
  () => ({
    createExternalLink: (...args: unknown[]) =>
      mocks.mockCreateExternalLink(...args),
    findExternalLinkByTaskAndType: (...args: unknown[]) =>
      mocks.mockFindExternalLinkByTaskAndType(...args),
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

vi.mock("../../../../../apps/api/src/plugins/github/utils/labels", () => ({
  addLabelsToIssue: (...args: unknown[]) => mocks.mockAddLabelsToIssue(...args),
  removeLabel: vi.fn(),
}));

vi.mock(
  "../../../../../apps/api/src/plugins/github/utils/sync-issue-assignee",
  () => ({
    syncIssueAssignee: (...args: unknown[]) =>
      mocks.mockSyncIssueAssignee(...args),
  }),
);

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

function event(assigneeId: string) {
  return {
    taskId: "task-1",
    projectId: "project-1",
    userId: assigneeId,
    title: "TEST",
    description: null,
    priority: "medium",
    status: "to-do",
    number: 1,
  } as Parameters<typeof handleTaskCreated>[0];
}

let currentAssignee: string | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.mockGetGithubApp.mockReturnValue({});
  mocks.mockGetVerifiedInstallationOctokit.mockResolvedValue(mocks.mockOctokit);
  mocks.mockFindExternalLinkByTaskAndType.mockResolvedValue(undefined);
  mocks.mockCreateIssue.mockResolvedValue({
    data: { number: 2, state: "open", title: "TEST", html_url: "u" },
  });
  mocks.mockAddLabelsToIssue.mockResolvedValue(undefined);
  mocks.mockCreateExternalLink.mockResolvedValue({ id: "link-1" });
  mocks.mockSyncIssueAssignee.mockResolvedValue(undefined);
  // The handler reads the assignee from the task row, not the event.
  mocks.mockFindTaskWithCraft.mockImplementation(async () => ({
    id: "task-1",
    userId: currentAssignee,
    craft: null,
  }));
});

describe("assignee on issue creation", () => {
  it("assigns the new issue to the task's assignee", async () => {
    // A task created with somebody already on it emits only task.created, so
    // without this the assignee never reaches GitHub at all.
    currentAssignee = "user-1";
    await handleTaskCreated(
      event("user-1"),
      context as Parameters<typeof handleTaskCreated>[1],
    );

    expect(mocks.mockSyncIssueAssignee).toHaveBeenCalledWith(
      "task-1",
      "user-1",
      context,
      expect.any(String),
    );
  });

  it("does not touch assignees for an unassigned task", async () => {
    currentAssignee = null;
    await handleTaskCreated(
      { ...event(""), userId: "" } as Parameters<typeof handleTaskCreated>[0],
      context as Parameters<typeof handleTaskCreated>[1],
    );

    expect(mocks.mockSyncIssueAssignee).not.toHaveBeenCalled();
  });
});

describe("assignee on deferred issue creation", () => {
  it("assigns the issue opened when a task leaves the backlog", async () => {
    // A task can sit in the backlog with an assignee for days. Its issue is
    // only opened when it reaches a column, and that issue must still name the
    // person the task names - no assignee event is coming.
    const { ensureIssueForTask } =
      await import("../../../../../apps/api/src/plugins/github/services/issue-creator");

    await ensureIssueForTask(
      mocks.mockOctokit as never,
      {
        taskId: "task-1",
        projectId: "project-1",
        number: 1,
        title: "TEST",
        description: null,
        priority: "medium",
        status: "to-do",
        assigneeId: "user-1",
      },
      context as never,
    );

    expect(mocks.mockSyncIssueAssignee).toHaveBeenCalledWith(
      "task-1",
      "user-1",
      context,
      expect.any(String),
    );
  });

  it("leaves assignees alone when an issue already existed", async () => {
    mocks.mockFindExternalLinkByTaskAndType.mockResolvedValue({
      id: "link-1",
      taskId: "task-1",
      externalId: "2",
      metadata: null,
    });
    const { ensureIssueForTask } =
      await import("../../../../../apps/api/src/plugins/github/services/issue-creator");

    await ensureIssueForTask(
      mocks.mockOctokit as never,
      {
        taskId: "task-1",
        projectId: "project-1",
        number: 1,
        title: "TEST",
        description: null,
        priority: "medium",
        status: "to-do",
        assigneeId: "user-1",
      },
      context as never,
    );

    expect(mocks.mockSyncIssueAssignee).not.toHaveBeenCalled();
  });
});
