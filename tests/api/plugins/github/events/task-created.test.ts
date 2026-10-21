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
    mockInitializeTaskIssue: vi.fn(),
    mockFindTaskWithCraft: vi.fn(),
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

// The lease and the task re-read are covered by the sync tests; here the
// event is the task.
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
    initializeTaskIssue: (...args: unknown[]) =>
      mocks.mockInitializeTaskIssue(...args),
    isIssueInitializationPending: () => false,
  }),
);

vi.mock(
  "../../../../../apps/api/src/plugins/github/services/link-manager",
  () => ({
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

function event(status: string) {
  return {
    taskId: "task-1",
    projectId: "project-1",
    userId: "user-1",
    title: "Rework the onboarding flow",
    description: "Long overdue",
    priority: "medium",
    status,
    number: 7,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.mockGetGithubApp.mockReturnValue({});
  mocks.mockGetVerifiedInstallationOctokit.mockResolvedValue(mocks.mockOctokit);
  mocks.mockFindExternalLinkByTaskAndType.mockResolvedValue(undefined);
  mocks.mockCreateIssue.mockResolvedValue({
    data: {
      number: 42,
      html_url: "https://github.com/Studio555/s555-atlas/issues/42",
      title: "Rework the onboarding flow",
      state: "open",
    },
  });
  mocks.mockCreateExternalLink.mockResolvedValue({ id: "link-1" });
  mocks.mockInitializeTaskIssue.mockResolvedValue(undefined);
  mocks.mockFindTaskWithCraft.mockResolvedValue({
    id: "task-1",
    userId: null,
    craft: { name: "Engineering", color: "blue" },
  });
});

describe("handleTaskCreated", () => {
  it("opens an issue for a task created in a board column", async () => {
    await handleTaskCreated(
      event("to-do") as Parameters<typeof handleTaskCreated>[0],
      context as Parameters<typeof handleTaskCreated>[1],
    );

    expect(mocks.mockCreateIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "Studio555",
        repo: "s555-atlas",
        title: "Rework the onboarding flow",
      }),
    );
    expect(mocks.mockCreateExternalLink).toHaveBeenCalledTimes(1);
    expect(mocks.mockInitializeTaskIssue).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "task-1" }),
      context,
      { id: "link-1" },
      expect.any(Object),
    );
  });

  it("labels the new issue with the task's craft in its colour", async () => {
    await handleTaskCreated(
      event("to-do") as Parameters<typeof handleTaskCreated>[0],
      context as Parameters<typeof handleTaskCreated>[1],
    );

    expect(mocks.mockAddLabelsToIssue).toHaveBeenCalledWith(
      mocks.mockOctokit,
      "Studio555",
      "s555-atlas",
      42,
      ["craft:Engineering"],
      false,
      undefined,
      { "craft:Engineering": "blue" },
    );
  });

  it("leaves a backlog task without an issue", async () => {
    // A planned task is an idea, not committed work. The issue is opened the
    // first time it lands in a real column.
    await handleTaskCreated(
      event("planned") as Parameters<typeof handleTaskCreated>[0],
      context as Parameters<typeof handleTaskCreated>[1],
    );

    expect(mocks.mockCreateIssue).not.toHaveBeenCalled();
    expect(mocks.mockCreateExternalLink).not.toHaveBeenCalled();
  });

  it("leaves an archived task without an issue", async () => {
    await handleTaskCreated(
      event("archived") as Parameters<typeof handleTaskCreated>[0],
      context as Parameters<typeof handleTaskCreated>[1],
    );

    expect(mocks.mockCreateIssue).not.toHaveBeenCalled();
    expect(mocks.mockCreateExternalLink).not.toHaveBeenCalled();
  });

  it("leaves a task in a custom backlog section without an issue", async () => {
    await handleTaskCreated(
      event("icebox") as Parameters<typeof handleTaskCreated>[0],
      context as Parameters<typeof handleTaskCreated>[1],
    );

    expect(backlogStatus.isBacklogStatus).toHaveBeenCalledWith(
      "project-1",
      "icebox",
    );
    expect(mocks.mockCreateIssue).not.toHaveBeenCalled();
    expect(mocks.mockCreateExternalLink).not.toHaveBeenCalled();
  });
});
