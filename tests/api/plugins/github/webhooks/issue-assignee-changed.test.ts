import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleIssueAssigneeChanged } from "../../../../../apps/api/src/plugins/github/webhooks/issue-assignee-changed";

const mocks = vi.hoisted(() => {
  const mockFindAllIntegrationsByRepo = vi.fn();
  const mockFindExternalLink = vi.fn();
  const mockFindTaskById = vi.fn();
  const mockUpdateTaskAssignee = vi.fn();
  const mockGetUserIdForGithubUser = vi.fn();
  const mockPublishEvent = vi.fn();
  const mockUpdateExternalLink = vi.fn();

  return {
    mockFindAllIntegrationsByRepo,
    mockFindExternalLink,
    mockFindTaskById,
    mockUpdateTaskAssignee,
    mockGetUserIdForGithubUser,
    mockPublishEvent,
    mockUpdateExternalLink,
  };
});

vi.mock(
  "../../../../../apps/api/src/plugins/github/services/task-service",
  () => ({
    findAllIntegrationsByRepo: (...args: unknown[]) =>
      mocks.mockFindAllIntegrationsByRepo(...args),
    findTaskById: (...args: unknown[]) => mocks.mockFindTaskById(...args),
    updateTaskAssignee: (...args: unknown[]) =>
      mocks.mockUpdateTaskAssignee(...args),
  }),
);

vi.mock(
  "../../../../../apps/api/src/plugins/github/services/link-manager",
  () => ({
    findExternalLink: (...args: unknown[]) =>
      mocks.mockFindExternalLink(...args),
    updateExternalLink: (...args: unknown[]) =>
      mocks.mockUpdateExternalLink(...args),
  }),
);

vi.mock(
  "../../../../../apps/api/src/plugins/github/services/user-link",
  () => ({
    getUserIdForGithubUser: (...args: unknown[]) =>
      mocks.mockGetUserIdForGithubUser(...args),
  }),
);

vi.mock("../../../../../apps/api/src/events", () => ({
  publishEvent: (...args: unknown[]) => mocks.mockPublishEvent(...args),
}));

const repository = { owner: { login: "Studio555" }, name: "s555-atlas" };

function payload(
  action: "assigned" | "unassigned",
  assignee: { id: number; login: string } | null,
  metadata: Record<string, unknown> | null = null,
) {
  mocks.mockFindExternalLink.mockResolvedValue({
    id: "link-1",
    taskId: "task-1",
    resourceType: "issue",
    externalId: "2",
    metadata: metadata ? JSON.stringify(metadata) : null,
  });

  return {
    action,
    issue: { number: 2, updated_at: "2026-09-08T12:00:00Z" },
    assignee,
    repository,
  };
}

const task = { id: "task-1", projectId: "project-1", title: "TEST" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.mockFindAllIntegrationsByRepo.mockResolvedValue([
    { id: "integration-1", type: "github" },
  ]);
  mocks.mockFindTaskById.mockResolvedValue({ ...task, userId: null });
  mocks.mockGetUserIdForGithubUser.mockResolvedValue("user-1");
  mocks.mockUpdateTaskAssignee.mockResolvedValue({
    applied: true,
    before: { ...task, userId: null },
    after: { ...task, userId: "user-1" },
    assigneeName: "Ada Lovelace",
  });
  mocks.mockPublishEvent.mockResolvedValue(undefined);
  mocks.mockUpdateExternalLink.mockResolvedValue(undefined);
});

describe("handleIssueAssigneeChanged", () => {
  it("assigns the linked task and publishes the change", async () => {
    await handleIssueAssigneeChanged(
      payload("assigned", { id: 4242, login: "ada" }),
    );

    expect(mocks.mockUpdateTaskAssignee).toHaveBeenCalledWith(
      "task-1",
      "user-1",
    );
    expect(mocks.mockPublishEvent).toHaveBeenCalledWith(
      "task.assignee_changed",
      expect.objectContaining({
        taskId: "task-1",
        projectId: "project-1",
        newAssigneeId: "user-1",
        newAssignee: "Ada Lovelace",
        oldAssignee: null,
      }),
    );
  });

  it("leaves the task alone for a GitHub user nobody has linked", async () => {
    mocks.mockGetUserIdForGithubUser.mockResolvedValue(null);

    await handleIssueAssigneeChanged(
      payload("assigned", { id: 4242, login: "ada" }),
    );

    expect(mocks.mockUpdateTaskAssignee).not.toHaveBeenCalled();
    expect(mocks.mockPublishEvent).not.toHaveBeenCalled();
  });

  it("publishes nothing when the assignment was refused", async () => {
    // The service refuses a user who is not a member of the workspace, and a
    // webhook must not be able to route around that.
    mocks.mockUpdateTaskAssignee.mockResolvedValue({ applied: false });

    await handleIssueAssigneeChanged(
      payload("assigned", { id: 4242, login: "ada" }),
    );

    expect(mocks.mockPublishEvent).not.toHaveBeenCalled();
  });

  it("drops the echo of an assignment Kaneo just made", async () => {
    await handleIssueAssigneeChanged(
      payload(
        "assigned",
        { id: 4242, login: "ada" },
        {
          assigneeLogin: "ada",
          lastOutboundAssigneeSyncAt: Date.parse("2026-09-08T12:00:00Z"),
        },
      ),
    );

    expect(mocks.mockUpdateTaskAssignee).not.toHaveBeenCalled();
  });

  it("clears the task when its current assignee is unassigned on GitHub", async () => {
    mocks.mockFindTaskById.mockResolvedValue({ ...task, userId: "user-1" });
    mocks.mockUpdateTaskAssignee.mockResolvedValue({
      applied: true,
      before: { ...task, userId: "user-1" },
      after: { ...task, userId: null },
      assigneeName: undefined,
    });

    await handleIssueAssigneeChanged(
      payload("unassigned", { id: 4242, login: "ada" }),
    );

    expect(mocks.mockUpdateTaskAssignee).toHaveBeenCalledWith("task-1", null);
    expect(mocks.mockPublishEvent).toHaveBeenCalledWith(
      "task.unassigned",
      expect.objectContaining({ taskId: "task-1", projectId: "project-1" }),
    );
  });

  it("keeps the assignee when somebody else is unassigned on GitHub", async () => {
    // A stale delivery, or a co-assignee being removed, must not wipe an
    // assignment that is still correct.
    mocks.mockFindTaskById.mockResolvedValue({ ...task, userId: "user-2" });

    await handleIssueAssigneeChanged(
      payload("unassigned", { id: 4242, login: "ada" }),
    );

    expect(mocks.mockUpdateTaskAssignee).not.toHaveBeenCalled();
  });

  it("ignores a payload with no assignee", async () => {
    await handleIssueAssigneeChanged(payload("assigned", null));

    expect(mocks.mockGetUserIdForGithubUser).not.toHaveBeenCalled();
  });

  it("ignores a bot assignee", async () => {
    await handleIssueAssigneeChanged(
      payload("assigned", { id: 99, login: "dependabot[bot]" }),
    );

    expect(mocks.mockUpdateTaskAssignee).not.toHaveBeenCalled();
  });
});

describe("inbound delivery ordering", () => {
  it("ignores a delivery older than one already applied", async () => {
    // GitHub retries and can deliver out of order. Applying the older event
    // last would leave Kaneo naming a person GitHub has already moved off.
    await handleIssueAssigneeChanged(
      payload(
        "assigned",
        { id: 4242, login: "ada" },
        {
          lastInboundAssigneeEventAt: Date.parse("2026-09-08T12:05:00Z"),
        },
      ),
    );

    expect(mocks.mockUpdateTaskAssignee).not.toHaveBeenCalled();
  });

  it("records the delivery it applied", async () => {
    await handleIssueAssigneeChanged(
      payload("assigned", { id: 4242, login: "ada" }),
    );

    const [, update] = mocks.mockUpdateExternalLink.mock.calls[0];
    expect(update.metadata.lastInboundAssigneeEventAt).toBe(
      Date.parse("2026-09-08T12:00:00Z"),
    );
  });

  it("applies a delivery newer than the last one", async () => {
    await handleIssueAssigneeChanged(
      payload(
        "assigned",
        { id: 4242, login: "ada" },
        {
          lastInboundAssigneeEventAt: Date.parse("2026-09-08T11:00:00Z"),
        },
      ),
    );

    expect(mocks.mockUpdateTaskAssignee).toHaveBeenCalled();
  });
});
