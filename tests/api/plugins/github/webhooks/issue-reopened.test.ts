import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleIssueReopened } from "../../../../../apps/api/src/plugins/github/webhooks/issue-reopened";

const mocks = vi.hoisted(() => {
  const mockFindAllIntegrationsByRepo = vi.fn();
  const mockUpdateTaskStatus = vi.fn();
  const mockUpdateExternalLink = vi.fn();
  const mockResolveTargetStatus = vi.fn();
  const mockPublishEvent = vi.fn();
  const mockExternalLinkFindFirst = vi.fn();
  const mockTaskFindFirst = vi.fn();

  const mockDb = {
    query: {
      externalLinkTable: { findFirst: mockExternalLinkFindFirst },
      taskTable: { findFirst: mockTaskFindFirst },
    },
  };

  return {
    mockFindAllIntegrationsByRepo,
    mockUpdateTaskStatus,
    mockUpdateExternalLink,
    mockResolveTargetStatus,
    mockPublishEvent,
    mockExternalLinkFindFirst,
    mockTaskFindFirst,
    mockDb,
  };
});

vi.mock("../../../../../apps/api/src/database", () => ({
  default: mocks.mockDb,
}));

vi.mock("../../../../../apps/api/src/events", () => ({
  publishEvent: (...args: unknown[]) => mocks.mockPublishEvent(...args),
}));

vi.mock(
  "../../../../../apps/api/src/plugins/github/services/task-service",
  () => ({
    findAllIntegrationsByRepo: (...args: unknown[]) =>
      mocks.mockFindAllIntegrationsByRepo(...args),
    updateTaskStatus: (...args: unknown[]) =>
      mocks.mockUpdateTaskStatus(...args),
  }),
);

vi.mock(
  "../../../../../apps/api/src/plugins/github/services/link-manager",
  () => ({
    updateExternalLink: (...args: unknown[]) =>
      mocks.mockUpdateExternalLink(...args),
  }),
);

vi.mock(
  "../../../../../apps/api/src/plugins/github/utils/resolve-column",
  () => ({
    resolveTargetStatus: (...args: unknown[]) =>
      mocks.mockResolveTargetStatus(...args),
  }),
);

const REOPENED_AT = "2026-09-07T14:10:00Z";

function issueReopenedPayload() {
  return {
    action: "reopened",
    issue: {
      number: 2,
      title: "TEST",
      html_url: "https://github.com/Studio555/s555-atlas/issues/2",
      state: "open",
      updated_at: REOPENED_AT,
    },
    repository: {
      owner: { login: "Studio555" },
      name: "s555-atlas",
      full_name: "Studio555/s555-atlas",
    },
  };
}

function linkWithMetadata(metadata: Record<string, unknown>) {
  return {
    id: "link-1",
    taskId: "task-1",
    integrationId: "integration-1",
    resourceType: "issue",
    externalId: "2",
    metadata: JSON.stringify(metadata),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.mockFindAllIntegrationsByRepo.mockResolvedValue([
    { id: "integration-1", projectId: "project-1" },
  ]);
  mocks.mockTaskFindFirst.mockResolvedValue({
    id: "task-1",
    projectId: "project-1",
    status: "done",
  });
  mocks.mockResolveTargetStatus.mockResolvedValue("to-do");
  mocks.mockUpdateTaskStatus.mockResolvedValue({
    applied: true,
    before: { status: "done" },
    after: {
      id: "task-1",
      projectId: "project-1",
      status: "to-do",
      title: "TEST",
      userId: null,
    },
  });
  mocks.mockUpdateExternalLink.mockResolvedValue(undefined);
});

describe("handleIssueReopened", () => {
  it("moves a task off done when an issue Kaneo created is reopened on GitHub", async () => {
    mocks.mockExternalLinkFindFirst.mockResolvedValue(
      linkWithMetadata({ state: "closed", createdFrom: "kaneo" }),
    );

    await handleIssueReopened(issueReopenedPayload());

    expect(mocks.mockUpdateTaskStatus).toHaveBeenCalledWith("task-1", "to-do");
    expect(mocks.mockPublishEvent).toHaveBeenCalledWith(
      "task.status_changed",
      expect.objectContaining({
        taskId: "task-1",
        oldStatus: "done",
        newStatus: "to-do",
      }),
    );
    expect(mocks.mockUpdateExternalLink).toHaveBeenCalledWith("link-1", {
      metadata: { state: "open", createdFrom: "kaneo" },
    });
  });

  it("ignores a reopen that echoes Kaneo's own outbound sync", async () => {
    mocks.mockExternalLinkFindFirst.mockResolvedValue(
      linkWithMetadata({
        state: "open",
        createdFrom: "kaneo",
        lastOutboundStateSyncAt: Date.parse(REOPENED_AT) - 1000,
      }),
    );

    await handleIssueReopened(issueReopenedPayload());

    expect(mocks.mockUpdateTaskStatus).not.toHaveBeenCalled();
    expect(mocks.mockPublishEvent).not.toHaveBeenCalled();
  });

  it("applies a reopen a user makes seconds after Kaneo closed the issue", async () => {
    // The reported regression risk: Kaneo closes the issue, a person reopens it
    // two seconds later, and a purely time-based check swallows that reopen.
    mocks.mockExternalLinkFindFirst.mockResolvedValue(
      linkWithMetadata({
        state: "closed",
        createdFrom: "kaneo",
        lastOutboundStateSyncAt: Date.parse(REOPENED_AT) - 2000,
      }),
    );

    await handleIssueReopened(issueReopenedPayload());

    expect(mocks.mockUpdateTaskStatus).toHaveBeenCalledWith("task-1", "to-do");
  });

  it("ignores a stale reopen delivered after a newer outbound close", async () => {
    mocks.mockExternalLinkFindFirst.mockResolvedValue(
      linkWithMetadata({
        state: "closed",
        createdFrom: "kaneo",
        lastOutboundStateSyncAt: Date.parse(REOPENED_AT) + 10_000,
      }),
    );

    await handleIssueReopened(issueReopenedPayload());

    expect(mocks.mockUpdateTaskStatus).not.toHaveBeenCalled();
    expect(mocks.mockPublishEvent).not.toHaveBeenCalled();
  });

  it("syncs a reopen that lands well after the last outbound sync", async () => {
    mocks.mockExternalLinkFindFirst.mockResolvedValue(
      linkWithMetadata({
        state: "closed",
        createdFrom: "kaneo",
        lastOutboundStateSyncAt: Date.parse(REOPENED_AT) - 60 * 60 * 1000,
      }),
    );

    await handleIssueReopened(issueReopenedPayload());

    expect(mocks.mockUpdateTaskStatus).toHaveBeenCalledWith("task-1", "to-do");
  });
});
