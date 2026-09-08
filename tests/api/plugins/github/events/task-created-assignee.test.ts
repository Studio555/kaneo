import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleTaskCreated } from "../../../../../apps/api/src/plugins/github/events/task-created";

const mocks = vi.hoisted(() => {
  const mockGetGithubApp = vi.fn();
  const mockGetInstallationOctokit = vi.fn();
  const mockFindExternalLinkByTaskAndType = vi.fn();
  const mockCreateExternalLink = vi.fn();
  const mockAddLabelsToIssue = vi.fn();
  const mockCreateIssue = vi.fn();
  const mockSyncIssueAssignee = vi.fn();
  const mockProjectFindFirst = vi.fn();

  const mockOctokit = {
    rest: {
      issues: { create: mockCreateIssue, createComment: vi.fn() },
    },
  };

  return {
    mockGetGithubApp,
    mockGetInstallationOctokit,
    mockFindExternalLinkByTaskAndType,
    mockCreateExternalLink,
    mockAddLabelsToIssue,
    mockCreateIssue,
    mockSyncIssueAssignee,
    mockProjectFindFirst,
    mockOctokit,
    mockGithubApp: { getInstallationOctokit: mockGetInstallationOctokit },
    mockDb: { query: { projectTable: { findFirst: mockProjectFindFirst } } },
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
    createExternalLink: (...args: unknown[]) =>
      mocks.mockCreateExternalLink(...args),
    findExternalLinkByTaskAndType: (...args: unknown[]) =>
      mocks.mockFindExternalLinkByTaskAndType(...args),
  }),
);

vi.mock("../../../../../apps/api/src/plugins/github/utils/labels", () => ({
  addLabelsToIssue: (...args: unknown[]) => mocks.mockAddLabelsToIssue(...args),
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

beforeEach(() => {
  vi.clearAllMocks();
  mocks.mockGetGithubApp.mockReturnValue(mocks.mockGithubApp);
  mocks.mockGetInstallationOctokit.mockResolvedValue(mocks.mockOctokit);
  mocks.mockFindExternalLinkByTaskAndType.mockResolvedValue(undefined);
  mocks.mockCreateIssue.mockResolvedValue({
    data: { number: 2, state: "open", title: "TEST", html_url: "u" },
  });
  mocks.mockAddLabelsToIssue.mockResolvedValue(undefined);
  mocks.mockCreateExternalLink.mockResolvedValue({ id: "link-1" });
  mocks.mockSyncIssueAssignee.mockResolvedValue(undefined);
});

describe("handleTaskCreated assignee", () => {
  it("assigns the new issue to the task's assignee", async () => {
    // A task created with somebody already on it emits only task.created, so
    // without this the assignee never reaches GitHub at all.
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
    await handleTaskCreated(
      { ...event(""), userId: "" } as Parameters<typeof handleTaskCreated>[0],
      context as Parameters<typeof handleTaskCreated>[1],
    );

    expect(mocks.mockSyncIssueAssignee).not.toHaveBeenCalled();
  });
});
