import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleIssueClosed } from "../../../../../apps/api/src/plugins/github/webhooks/issue-closed";

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

const CLOSED_AT = "2026-09-07T13:46:12Z";

function issueClosedPayload() {
  return {
    action: "closed",
    issue: {
      number: 2,
      title: "TEST",
      html_url: "https://github.com/Studio555/s555-atlas/issues/2",
      state: "closed",
      updated_at: CLOSED_AT,
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
    status: "to-do",
  });
  mocks.mockResolveTargetStatus.mockResolvedValue("done");
  mocks.mockUpdateTaskStatus.mockResolvedValue({
    applied: true,
    before: { status: "to-do" },
    after: {
      id: "task-1",
      projectId: "project-1",
      status: "done",
      title: "TEST",
      userId: null,
    },
  });
  mocks.mockUpdateExternalLink.mockResolvedValue(undefined);
});

describe("handleIssueClosed", () => {
  it("moves a task to done when an issue Kaneo created is closed on GitHub", async () => {
    // The reported bug: a task created in Kaneo pushes an issue to GitHub and
    // the link is stamped createdFrom "kaneo", which used to opt the task out
    // of inbound close sync entirely.
    mocks.mockExternalLinkFindFirst.mockResolvedValue(
      linkWithMetadata({ state: "open", createdFrom: "kaneo" }),
    );

    await handleIssueClosed(issueClosedPayload());

    expect(mocks.mockUpdateTaskStatus).toHaveBeenCalledWith("task-1", "done");
    expect(mocks.mockPublishEvent).toHaveBeenCalledWith(
      "task.status_changed",
      expect.objectContaining({
        taskId: "task-1",
        oldStatus: "to-do",
        newStatus: "done",
      }),
    );
    expect(mocks.mockUpdateExternalLink).toHaveBeenCalledWith(
      "link-1",
      expect.objectContaining({
        metadata: expect.objectContaining({ state: "closed" }),
      }),
    );
  });

  it("syncs a close on an issue that originated on GitHub", async () => {
    mocks.mockExternalLinkFindFirst.mockResolvedValue(
      linkWithMetadata({ state: "open", createdFrom: "github" }),
    );

    await handleIssueClosed(issueClosedPayload());

    expect(mocks.mockUpdateTaskStatus).toHaveBeenCalledWith("task-1", "done");
  });

  it("ignores a close that echoes Kaneo's own outbound sync", async () => {
    // Kaneo closed the issue itself moments ago; GitHub's resulting webhook is
    // our own write coming back and must not be re-applied.
    mocks.mockExternalLinkFindFirst.mockResolvedValue(
      linkWithMetadata({
        state: "closed",
        createdFrom: "kaneo",
        lastOutboundStateSyncAt: Date.parse(CLOSED_AT) + 1000,
      }),
    );

    await handleIssueClosed(issueClosedPayload());

    expect(mocks.mockUpdateTaskStatus).not.toHaveBeenCalled();
    expect(mocks.mockPublishEvent).not.toHaveBeenCalled();
  });

  it("syncs a close that lands well after the last outbound sync", async () => {
    // Someone reopened the issue on GitHub and closed it again later. That is a
    // real user action, not an echo, however old the outbound stamp is.
    mocks.mockExternalLinkFindFirst.mockResolvedValue(
      linkWithMetadata({
        state: "open",
        createdFrom: "kaneo",
        lastOutboundStateSyncAt: Date.parse(CLOSED_AT) - 60 * 60 * 1000,
      }),
    );

    await handleIssueClosed(issueClosedPayload());

    expect(mocks.mockUpdateTaskStatus).toHaveBeenCalledWith("task-1", "done");
  });

  it("syncs a close when the payload carries no updated_at to compare", async () => {
    // Without a timestamp there is nothing to match against the outbound stamp,
    // and dropping the event would lose a real close.
    mocks.mockExternalLinkFindFirst.mockResolvedValue(
      linkWithMetadata({
        state: "open",
        createdFrom: "kaneo",
        lastOutboundStateSyncAt: Date.now(),
      }),
    );

    const payload = issueClosedPayload();
    payload.issue.updated_at = undefined as unknown as string;

    await handleIssueClosed(payload);

    expect(mocks.mockUpdateTaskStatus).toHaveBeenCalledWith("task-1", "done");
  });

  it("applies a close a user makes seconds after Kaneo reopened the issue", async () => {
    // The window alone cannot tell these apart: Kaneo's outbound write here was
    // a reopen, so a close landing inside the window is a person acting, not our
    // own update returning.
    mocks.mockExternalLinkFindFirst.mockResolvedValue(
      linkWithMetadata({
        state: "open",
        createdFrom: "kaneo",
        lastOutboundStateSyncAt: Date.parse(CLOSED_AT) - 2000,
      }),
    );

    await handleIssueClosed(issueClosedPayload());

    expect(mocks.mockUpdateTaskStatus).toHaveBeenCalledWith("task-1", "done");
  });

  it("ignores a stale close delivered after a newer outbound reopen", async () => {
    // GitHub retries deliveries, so an old close can arrive after Kaneo has
    // already reopened the issue. Applying it would undo the newer state.
    mocks.mockExternalLinkFindFirst.mockResolvedValue(
      linkWithMetadata({
        state: "open",
        createdFrom: "kaneo",
        lastOutboundStateSyncAt: Date.parse(CLOSED_AT) + 10_000,
      }),
    );

    await handleIssueClosed(issueClosedPayload());

    expect(mocks.mockUpdateTaskStatus).not.toHaveBeenCalled();
    expect(mocks.mockPublishEvent).not.toHaveBeenCalled();
  });

  it("preserves the existing metadata when recording the closed state", async () => {
    mocks.mockExternalLinkFindFirst.mockResolvedValue(
      linkWithMetadata({ state: "open", createdFrom: "kaneo" }),
    );

    await handleIssueClosed(issueClosedPayload());

    expect(mocks.mockUpdateExternalLink).toHaveBeenCalledWith("link-1", {
      metadata: { state: "closed", createdFrom: "kaneo" },
    });
  });
});
