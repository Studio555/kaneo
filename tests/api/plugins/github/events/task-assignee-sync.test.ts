import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleTaskAssigneeChanged } from "../../../../../apps/api/src/plugins/github/events/task-assignee-changed";
import { handleTaskUnassigned } from "../../../../../apps/api/src/plugins/github/events/task-unassigned";

const mocks = vi.hoisted(() => {
  const mockGetGithubApp = vi.fn();
  const mockGetInstallationOctokit = vi.fn();
  const mockFindExternalLinksByTask = vi.fn();
  const mockUpdateExternalLink = vi.fn();
  const mockGetGithubLoginForUser = vi.fn();
  const mockRefreshGithubLoginForUser = vi.fn();
  const mockFindTaskById = vi.fn();
  const mockUpdateIssue = vi.fn();
  const mockCheckUserCanBeAssigned = vi.fn();

  const mockOctokit = {
    rest: {
      issues: {
        update: mockUpdateIssue,
        checkUserCanBeAssigned: mockCheckUserCanBeAssigned,
      },
    },
  };

  return {
    mockGetGithubApp,
    mockGetInstallationOctokit,
    mockFindExternalLinksByTask,
    mockUpdateExternalLink,
    mockGetGithubLoginForUser,
    mockRefreshGithubLoginForUser,
    mockFindTaskById,
    mockUpdateIssue,
    mockCheckUserCanBeAssigned,
    mockOctokit,
    mockGithubApp: { getInstallationOctokit: mockGetInstallationOctokit },
  };
});

vi.mock("../../../../../apps/api/src/plugins/github/utils/github-app", () => ({
  getGithubApp: () => mocks.mockGetGithubApp(),
  getInstallationIdForRepo: async () => 123,
}));

vi.mock(
  "../../../../../apps/api/src/plugins/github/services/link-manager",
  () => ({
    findExternalLinksByTask: (...args: unknown[]) =>
      mocks.mockFindExternalLinksByTask(...args),
    updateExternalLink: (...args: unknown[]) =>
      mocks.mockUpdateExternalLink(...args),
  }),
);

vi.mock(
  "../../../../../apps/api/src/plugins/github/services/user-link",
  () => ({
    getGithubLoginForUser: (...args: unknown[]) =>
      mocks.mockGetGithubLoginForUser(...args),
    refreshGithubLoginForUser: (...args: unknown[]) =>
      mocks.mockRefreshGithubLoginForUser(...args),
  }),
);

vi.mock(
  "../../../../../apps/api/src/plugins/github/services/task-service",
  () => ({
    findTaskById: (...args: unknown[]) => mocks.mockFindTaskById(...args),
  }),
);

const context = {
  integrationId: "integration-1",
  projectId: "project-1",
  config: {
    repositoryOwner: "Studio555",
    repositoryName: "s555-atlas",
    installationId: 123,
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

const assigneeChangedEvent = {
  taskId: "task-1",
  projectId: "project-1",
  userId: "actor-1",
  title: "TEST",
  oldAssignee: null,
  newAssignee: "Ada Lovelace",
  newAssigneeId: "user-1",
} as Parameters<typeof handleTaskAssigneeChanged>[0];

const unassignedEvent = {
  taskId: "task-1",
  projectId: "project-1",
  userId: "actor-1",
  title: "TEST",
} as Parameters<typeof handleTaskUnassigned>[0];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.mockGetGithubApp.mockReturnValue(mocks.mockGithubApp);
  mocks.mockGetInstallationOctokit.mockResolvedValue(mocks.mockOctokit);
  mocks.mockFindExternalLinksByTask.mockResolvedValue([
    issueLink({ state: "open", createdFrom: "kaneo" }),
  ]);
  mocks.mockGetGithubLoginForUser.mockResolvedValue("ada");
  mocks.mockRefreshGithubLoginForUser.mockResolvedValue(null);
  mocks.mockFindTaskById.mockResolvedValue({
    id: "task-1",
    projectId: "project-1",
    userId: "user-1",
  });
  mocks.mockCheckUserCanBeAssigned.mockResolvedValue({ status: 204 });
  mocks.mockUpdateIssue.mockResolvedValue({});
  mocks.mockUpdateExternalLink.mockResolvedValue(undefined);
});

describe("handleTaskAssigneeChanged", () => {
  it("replaces the issue's assignees with the Kaneo assignee", async () => {
    const before = Date.now();

    await handleTaskAssigneeChanged(
      assigneeChangedEvent,
      context as Parameters<typeof handleTaskAssigneeChanged>[1],
    );

    expect(mocks.mockUpdateIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "Studio555",
        repo: "s555-atlas",
        issue_number: 2,
        assignees: ["ada"],
      }),
    );

    const [linkId, update] = mocks.mockUpdateExternalLink.mock.calls[0];
    expect(linkId).toBe("link-1");
    expect(update.metadata.assigneeLogin).toBe("ada");
    expect(update.metadata.state).toBe("open");
    expect(update.metadata.lastOutboundAssigneeSyncAt).toBeGreaterThanOrEqual(
      before,
    );
  });

  it("leaves the issue alone when the assignee has no linked GitHub account", async () => {
    mocks.mockGetGithubLoginForUser.mockResolvedValue(null);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await handleTaskAssigneeChanged(
      assigneeChangedEvent,
      context as Parameters<typeof handleTaskAssigneeChanged>[1],
    );

    expect(mocks.mockUpdateIssue).not.toHaveBeenCalled();
    expect(mocks.mockUpdateExternalLink).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  it("leaves the issue alone when GitHub would not accept the assignee", async () => {
    // GitHub answers 404 here and then silently drops an unassignable user
    // from a write, so without this check the sync fails invisibly.
    mocks.mockCheckUserCanBeAssigned.mockRejectedValue(
      Object.assign(new Error("Not Found"), { status: 404 }),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await handleTaskAssigneeChanged(
      assigneeChangedEvent,
      context as Parameters<typeof handleTaskAssigneeChanged>[1],
    );

    expect(mocks.mockUpdateIssue).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  it("does nothing when the task has no linked issue", async () => {
    mocks.mockFindExternalLinksByTask.mockResolvedValue([]);

    await handleTaskAssigneeChanged(
      assigneeChangedEvent,
      context as Parameters<typeof handleTaskAssigneeChanged>[1],
    );

    expect(mocks.mockGetGithubLoginForUser).not.toHaveBeenCalled();
    expect(mocks.mockUpdateIssue).not.toHaveBeenCalled();
  });
});

describe("handleTaskUnassigned", () => {
  it("clears the issue's assignees and records the empty write", async () => {
    mocks.mockFindTaskById.mockResolvedValue({
      id: "task-1",
      projectId: "project-1",
      userId: null,
    });
    const before = Date.now();

    await handleTaskUnassigned(
      unassignedEvent,
      context as Parameters<typeof handleTaskUnassigned>[1],
    );

    expect(mocks.mockUpdateIssue).toHaveBeenCalledWith(
      expect.objectContaining({ issue_number: 2, assignees: [] }),
    );

    const [, update] = mocks.mockUpdateExternalLink.mock.calls[0];
    expect(update.metadata.assigneeLogin).toBeNull();
    expect(update.metadata.lastOutboundAssigneeSyncAt).toBeGreaterThanOrEqual(
      before,
    );
  });

  it("does nothing when the task has no linked issue", async () => {
    mocks.mockFindExternalLinksByTask.mockResolvedValue([]);

    await handleTaskUnassigned(
      unassignedEvent,
      context as Parameters<typeof handleTaskUnassigned>[1],
    );

    expect(mocks.mockUpdateIssue).not.toHaveBeenCalled();
  });
});

describe("assignee sync staleness and renames", () => {
  it("skips a superseded event rather than undoing the newer assignment", async () => {
    // Two assignments in quick succession can reach GitHub out of order, and
    // the loser would otherwise write last and leave GitHub disagreeing with
    // the board. The task row is the authority on who is assigned now.
    mocks.mockFindTaskById.mockResolvedValue({
      id: "task-1",
      projectId: "project-1",
      userId: "user-2",
    });

    await handleTaskAssigneeChanged(
      assigneeChangedEvent,
      context as Parameters<typeof handleTaskAssigneeChanged>[1],
    );

    expect(mocks.mockUpdateIssue).not.toHaveBeenCalled();
  });

  it("retries with a refreshed handle when the cached one is not assignable", async () => {
    // A GitHub rename leaves the cached handle stale, and the assignability
    // check is where that first shows up.
    mocks.mockCheckUserCanBeAssigned
      .mockRejectedValueOnce(
        Object.assign(new Error("Not Found"), { status: 404 }),
      )
      .mockResolvedValueOnce({ status: 204 });
    mocks.mockRefreshGithubLoginForUser.mockResolvedValue("ada-lovelace");

    await handleTaskAssigneeChanged(
      assigneeChangedEvent,
      context as Parameters<typeof handleTaskAssigneeChanged>[1],
    );

    expect(mocks.mockUpdateIssue).toHaveBeenCalledWith(
      expect.objectContaining({ assignees: ["ada-lovelace"] }),
    );
  });

  it("gives up when the refreshed handle is still not assignable", async () => {
    mocks.mockCheckUserCanBeAssigned.mockRejectedValue(
      Object.assign(new Error("Not Found"), { status: 404 }),
    );
    mocks.mockRefreshGithubLoginForUser.mockResolvedValue("ada-lovelace");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await handleTaskAssigneeChanged(
      assigneeChangedEvent,
      context as Parameters<typeof handleTaskAssigneeChanged>[1],
    );

    expect(mocks.mockUpdateIssue).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  it("still clears the issue when the task really is unassigned", async () => {
    mocks.mockFindTaskById.mockResolvedValue({
      id: "task-1",
      projectId: "project-1",
      userId: null,
    });

    await handleTaskUnassigned(
      unassignedEvent,
      context as Parameters<typeof handleTaskUnassigned>[1],
    );

    expect(mocks.mockUpdateIssue).toHaveBeenCalledWith(
      expect.objectContaining({ assignees: [] }),
    );
  });

  it("skips clearing when somebody has already been assigned since", async () => {
    mocks.mockFindTaskById.mockResolvedValue({
      id: "task-1",
      projectId: "project-1",
      userId: "user-2",
    });

    await handleTaskUnassigned(
      unassignedEvent,
      context as Parameters<typeof handleTaskUnassigned>[1],
    );

    expect(mocks.mockUpdateIssue).not.toHaveBeenCalled();
  });
});
