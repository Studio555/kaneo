import { beforeEach, describe, expect, it, vi } from "vitest";
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
  const mockGetGithubApp = vi.fn();
  const mockGetInstallationOctokit = vi.fn();
  const mockFindExternalLinkByTaskAndType = vi.fn();
  const mockCreateExternalLink = vi.fn();
  const mockAddLabelsToIssue = vi.fn();
  const mockCreateIssue = vi.fn();
  const mockCreateComment = vi.fn();
  const mockProjectFindFirst = vi.fn();

  const mockOctokit = {
    rest: {
      issues: { create: mockCreateIssue, createComment: mockCreateComment },
    },
  };

  return {
    mockGetGithubApp,
    mockGetInstallationOctokit,
    mockFindExternalLinkByTaskAndType,
    mockCreateExternalLink,
    mockAddLabelsToIssue,
    mockCreateIssue,
    mockCreateComment,
    mockProjectFindFirst,
    mockOctokit,
    mockGithubApp: { getInstallationOctokit: mockGetInstallationOctokit },
    mockDb: {
      query: { projectTable: { findFirst: mockProjectFindFirst } },
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
    findExternalLinkByTaskAndType: (...args: unknown[]) =>
      mocks.mockFindExternalLinkByTaskAndType(...args),
    createExternalLink: (...args: unknown[]) =>
      mocks.mockCreateExternalLink(...args),
  }),
);

vi.mock("../../../../../apps/api/src/plugins/github/utils/labels", () => ({
  addLabelsToIssue: (...args: unknown[]) => mocks.mockAddLabelsToIssue(...args),
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
    craftName: null,
    craftColor: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.mockGetGithubApp.mockReturnValue(mocks.mockGithubApp);
  mocks.mockGetInstallationOctokit.mockResolvedValue(mocks.mockOctokit);
  mocks.mockFindExternalLinkByTaskAndType.mockResolvedValue(undefined);
  mocks.mockCreateIssue.mockResolvedValue({
    data: {
      number: 42,
      html_url: "https://github.com/Studio555/s555-atlas/issues/42",
      title: "Rework the onboarding flow",
      state: "open",
    },
  });
  mocks.mockAddLabelsToIssue.mockResolvedValue(undefined);
  mocks.mockCreateExternalLink.mockResolvedValue(undefined);
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
    expect(mocks.mockAddLabelsToIssue).toHaveBeenCalledWith(
      mocks.mockOctokit,
      "Studio555",
      "s555-atlas",
      42,
      ["priority:medium", "status:to-do"],
      undefined,
    );
    expect(mocks.mockCreateExternalLink).toHaveBeenCalledTimes(1);
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
