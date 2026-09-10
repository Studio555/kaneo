import { beforeEach, describe, expect, it, vi } from "vitest";
import { handlePullRequestClosed } from "../../../../../apps/api/src/plugins/github/webhooks/pull-request-closed";

const mocks = vi.hoisted(() => {
  const mockExternalLinkFindMany = vi.fn();
  return {
    mockFindAllActiveGithubIntegrations: vi.fn(),
    mockFindTaskById: vi.fn(),
    mockUpdateTaskStatus: vi.fn(),
    mockFindPullRequestLinks: vi.fn(),
    mockUpdateExternalLink: vi.fn(),
    mockResolveTargetStatus: vi.fn(),
    mockPublishEvent: vi.fn(),
    mockExternalLinkFindMany,
    mockDb: {
      query: { externalLinkTable: { findMany: mockExternalLinkFindMany } },
    },
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
    findAllActiveGithubIntegrations: (...args: unknown[]) =>
      mocks.mockFindAllActiveGithubIntegrations(...args),
    findTaskById: (...args: unknown[]) => mocks.mockFindTaskById(...args),
    updateTaskStatus: (...args: unknown[]) =>
      mocks.mockUpdateTaskStatus(...args),
  }),
);

vi.mock(
  "../../../../../apps/api/src/plugins/github/services/link-manager",
  () => ({
    findPullRequestLinks: (...args: unknown[]) =>
      mocks.mockFindPullRequestLinks(...args),
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

const ATLAS = "Studio555/s555-atlas";
const SERVER = "Studio555/showrooms-server";
const MERGED_AT = "2026-09-10T09:00:00Z";

function integration(id: string, repositoryName = "s555-atlas") {
  return {
    id,
    projectId: `project-${id}`,
    project: { id: `project-${id}`, slug: "atl" },
    config: JSON.stringify({
      repositoryOwner: "Studio555",
      repositoryName,
      installationId: 42,
    }),
  };
}

function task(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    projectId: "project-integration-1",
    status: "in-review",
    title: `Task ${id}`,
    userId: null,
    columnId: null,
    ...overrides,
  };
}

function prLink(
  id: string,
  taskId: string,
  metadata: Record<string, unknown>,
  externalId = "7",
) {
  return {
    id,
    taskId,
    integrationId: "integration-1",
    resourceType: "pull_request",
    externalId,
    metadata: JSON.stringify(metadata),
  };
}

function closedPayload(overrides: { merged?: boolean; repo?: string } = {}) {
  const repo = overrides.repo ?? SERVER;
  const [owner, name] = repo.split("/") as [string, string];
  const merged = overrides.merged ?? true;
  return {
    action: "closed",
    pull_request: {
      number: 7,
      title: "Walls and floors",
      html_url: `https://github.com/${repo}/pull/7`,
      state: "closed",
      merged,
      merged_at: merged ? MERGED_AT : null,
      head: { ref: "arvid-studio555/walls-floors" },
    },
    repository: { owner: { login: owner }, name, full_name: repo },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.mockFindAllActiveGithubIntegrations.mockResolvedValue([
    integration("integration-1"),
  ]);
  mocks.mockFindPullRequestLinks.mockResolvedValue([]);
  mocks.mockExternalLinkFindMany.mockResolvedValue([]);
  mocks.mockFindTaskById.mockImplementation(async (id: string) => task(id));
  mocks.mockResolveTargetStatus.mockResolvedValue("done");
  mocks.mockUpdateExternalLink.mockResolvedValue(undefined);
  mocks.mockUpdateTaskStatus.mockImplementation(
    async (taskId: string, status: string) => ({
      applied: true,
      before: { status: "in-review" },
      after: { ...task(taskId), status },
    }),
  );
});

describe("handlePullRequestClosed", () => {
  it("looks the pull request up by number within its own repository", async () => {
    await handlePullRequestClosed(closedPayload());

    expect(mocks.mockFindPullRequestLinks).toHaveBeenCalledWith(
      "integration-1",
      7,
      SERVER,
      ATLAS,
    );
  });

  it("records the merge and moves the task to done when it was the last open pull request", async () => {
    const link = prLink("link-1", "task-1", {
      state: "open",
      author: "arvid",
      repository: SERVER,
    });
    mocks.mockFindPullRequestLinks.mockResolvedValue([link]);
    mocks.mockExternalLinkFindMany.mockResolvedValue([link]);

    await handlePullRequestClosed(closedPayload());

    expect(mocks.mockUpdateExternalLink).toHaveBeenCalledWith("link-1", {
      metadata: {
        state: "closed",
        merged: true,
        mergedAt: MERGED_AT,
        author: "arvid",
        repository: SERVER,
      },
    });
    expect(mocks.mockUpdateTaskStatus).toHaveBeenCalledWith("task-1", "done");
    expect(mocks.mockPublishEvent).toHaveBeenCalledWith(
      "task.status_changed",
      expect.objectContaining({ taskId: "task-1", newStatus: "done" }),
    );
  });

  it("keeps the task open while a pull request in another repository is still open", async () => {
    const merged = prLink("link-1", "task-1", {
      state: "open",
      repository: SERVER,
    });
    const stillOpen = prLink(
      "link-2",
      "task-1",
      { state: "open", repository: "Studio555/ShowroomsClient" },
      "31",
    );
    mocks.mockFindPullRequestLinks.mockResolvedValue([merged]);
    mocks.mockExternalLinkFindMany.mockResolvedValue([merged, stillOpen]);

    await handlePullRequestClosed(closedPayload());

    expect(mocks.mockUpdateExternalLink).toHaveBeenCalledTimes(1);
    expect(mocks.mockUpdateTaskStatus).not.toHaveBeenCalled();
    expect(mocks.mockPublishEvent).toHaveBeenCalledWith(
      "task.updated",
      expect.objectContaining({ taskId: "task-1" }),
    );
  });

  it("records a close without merge and leaves the status alone", async () => {
    mocks.mockFindPullRequestLinks.mockResolvedValue([
      prLink("link-1", "task-1", { state: "open" }),
    ]);

    await handlePullRequestClosed(closedPayload({ merged: false }));

    expect(mocks.mockUpdateExternalLink).toHaveBeenCalledWith("link-1", {
      metadata: expect.objectContaining({
        state: "closed",
        merged: false,
        mergedAt: null,
        repository: SERVER,
      }),
    });
    expect(mocks.mockUpdateTaskStatus).not.toHaveBeenCalled();
    expect(mocks.mockPublishEvent).toHaveBeenCalledWith(
      "task.updated",
      expect.objectContaining({ taskId: "task-1" }),
    );
  });

  it("updates every task the pull request is linked to", async () => {
    const first = prLink("link-1", "task-1", {
      state: "open",
      repository: SERVER,
    });
    const second = prLink("link-2", "task-2", {
      state: "open",
      repository: SERVER,
    });
    mocks.mockFindPullRequestLinks.mockResolvedValue([first, second]);

    await handlePullRequestClosed(closedPayload());

    expect(mocks.mockUpdateExternalLink).toHaveBeenCalledTimes(2);
    expect(mocks.mockUpdateTaskStatus).toHaveBeenCalledWith("task-1", "done");
    expect(mocks.mockUpdateTaskStatus).toHaveBeenCalledWith("task-2", "done");
  });

  it("processes every integration that links the pull request", async () => {
    mocks.mockFindAllActiveGithubIntegrations.mockResolvedValue([
      integration("integration-1"),
      integration("integration-2", "s555-design"),
    ]);
    mocks.mockFindPullRequestLinks.mockImplementation(
      async (integrationId: string) => [
        {
          ...prLink(`link-${integrationId}`, `task-${integrationId}`, {
            state: "open",
          }),
          integrationId,
        },
      ],
    );

    await handlePullRequestClosed(closedPayload());

    expect(mocks.mockUpdateExternalLink).toHaveBeenCalledWith(
      "link-integration-1",
      expect.anything(),
    );
    expect(mocks.mockUpdateExternalLink).toHaveBeenCalledWith(
      "link-integration-2",
      expect.anything(),
    );
  });

  it("writes nothing when the pull request is not linked", async () => {
    await handlePullRequestClosed(closedPayload());

    expect(mocks.mockUpdateExternalLink).not.toHaveBeenCalled();
    expect(mocks.mockUpdateTaskStatus).not.toHaveBeenCalled();
    expect(mocks.mockPublishEvent).not.toHaveBeenCalled();
  });
});
