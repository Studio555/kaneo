import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleTaskStatusChanged } from "../../../../../apps/api/src/plugins/github/events/task-status-changed";

const mocks = vi.hoisted(() => {
  const mockGetGithubApp = vi.fn();
  const mockGetInstallationOctokit = vi.fn();
  const mockFindExternalLinksByTask = vi.fn();
  const mockUpdateExternalLink = vi.fn();
  const mockAddLabelsToIssue = vi.fn();
  const mockRemoveLabel = vi.fn();
  const mockUpdateIssue = vi.fn();

  const mockOctokit = {
    rest: { issues: { update: mockUpdateIssue } },
  };

  return {
    mockGetGithubApp,
    mockGetInstallationOctokit,
    mockFindExternalLinksByTask,
    mockUpdateExternalLink,
    mockAddLabelsToIssue,
    mockRemoveLabel,
    mockUpdateIssue,
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

vi.mock("../../../../../apps/api/src/plugins/github/utils/labels", () => ({
  addLabelsToIssue: (...args: unknown[]) => mocks.mockAddLabelsToIssue(...args),
  removeLabel: (...args: unknown[]) => mocks.mockRemoveLabel(...args),
}));

const context = {
  integrationId: "integration-1",
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

beforeEach(() => {
  vi.clearAllMocks();
  mocks.mockGetGithubApp.mockReturnValue(mocks.mockGithubApp);
  mocks.mockGetInstallationOctokit.mockResolvedValue(mocks.mockOctokit);
  mocks.mockFindExternalLinksByTask.mockResolvedValue([
    issueLink({ state: "open", createdFrom: "kaneo" }),
  ]);
  mocks.mockAddLabelsToIssue.mockResolvedValue(undefined);
  mocks.mockRemoveLabel.mockResolvedValue(undefined);
  mocks.mockUpdateIssue.mockResolvedValue({});
  mocks.mockUpdateExternalLink.mockResolvedValue(undefined);
});

describe("handleTaskStatusChanged", () => {
  it("stamps the outbound sync time when it closes the issue", async () => {
    // The inbound webhook handlers compare this stamp against the event's
    // updated_at to tell Kaneo's own write apart from a real user action.
    const before = Date.now();

    await handleTaskStatusChanged(
      {
        taskId: "task-1",
        projectId: "project-1",
        userId: "user-1",
        oldStatus: "to-do",
        newStatus: "done",
        title: "TEST",
        assigneeId: null,
        type: "status_changed",
      } as Parameters<typeof handleTaskStatusChanged>[0],
      context as Parameters<typeof handleTaskStatusChanged>[1],
    );

    expect(mocks.mockUpdateIssue).toHaveBeenCalledWith(
      expect.objectContaining({ issue_number: 2, state: "closed" }),
    );

    const [, update] = mocks.mockUpdateExternalLink.mock.calls[0];
    expect(update.metadata.state).toBe("closed");
    expect(update.metadata.createdFrom).toBe("kaneo");
    expect(update.metadata.lastOutboundStateSyncAt).toBeGreaterThanOrEqual(
      before,
    );
    expect(update.metadata.lastOutboundStateSyncAt).toBeLessThanOrEqual(
      Date.now(),
    );
  });

  it("stamps the outbound sync time when it reopens the issue", async () => {
    mocks.mockFindExternalLinksByTask.mockResolvedValue([
      issueLink({ state: "closed", createdFrom: "kaneo" }),
    ]);
    const before = Date.now();

    await handleTaskStatusChanged(
      {
        taskId: "task-1",
        projectId: "project-1",
        userId: "user-1",
        oldStatus: "done",
        newStatus: "to-do",
        title: "TEST",
        assigneeId: null,
        type: "status_changed",
      } as Parameters<typeof handleTaskStatusChanged>[0],
      context as Parameters<typeof handleTaskStatusChanged>[1],
    );

    expect(mocks.mockUpdateIssue).toHaveBeenCalledWith(
      expect.objectContaining({ issue_number: 2, state: "open" }),
    );

    const [, update] = mocks.mockUpdateExternalLink.mock.calls[0];
    expect(update.metadata.state).toBe("open");
    expect(update.metadata.lastOutboundStateSyncAt).toBeGreaterThanOrEqual(
      before,
    );
  });

  it("survives a link whose metadata row cannot be parsed", async () => {
    // A truncated row used to throw out of the handler, losing the label and
    // state sync for a status change that did happen.
    mocks.mockFindExternalLinksByTask.mockResolvedValue([
      { ...issueLink(null), metadata: '{"state":"op' },
    ]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await handleTaskStatusChanged(
      {
        taskId: "task-1",
        projectId: "project-1",
        userId: "user-1",
        oldStatus: "to-do",
        newStatus: "done",
        title: "TEST",
        assigneeId: null,
        type: "status_changed",
      } as Parameters<typeof handleTaskStatusChanged>[0],
      context as Parameters<typeof handleTaskStatusChanged>[1],
    );

    expect(mocks.mockUpdateIssue).toHaveBeenCalledWith(
      expect.objectContaining({ state: "closed" }),
    );
    const [, update] = mocks.mockUpdateExternalLink.mock.calls[0];
    expect(update.metadata.state).toBe("closed");
    expect(warn).toHaveBeenCalled();
  });
});
