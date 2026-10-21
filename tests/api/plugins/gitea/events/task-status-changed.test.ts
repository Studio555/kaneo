import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { handleTaskStatusChanged } from "../../../../../apps/api/src/plugins/gitea/events/task-status-changed";

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

const mocks = vi.hoisted(() => ({
  createIssue: vi.fn(),
  findExternalLinksByTask: vi.fn(),
  findExternalLinkByTaskAndType: vi.fn(),
  createExternalLink: vi.fn(),
  addLabelsToIssueGitea: vi.fn(),
  removeLabelGitea: vi.fn(),
  initializeTaskIssue: vi.fn(),
  syncTaskFieldLabels: vi.fn(),
}));

vi.mock("../../../../../apps/api/src/database", () => ({ default: {} }));

// task.created re-reads the task under its lease; the stored row's status is
// the one the status change just wrote.
vi.mock("../../../../../apps/api/src/plugins/sync/create-task-issue", () => ({
  withTaskSyncCreation: (
    event: Record<string, unknown>,
    _context: unknown,
    create: (current: unknown) => Promise<void>,
  ) =>
    create({
      ...event,
      title: "Rework the onboarding flow",
      description: "Long overdue",
      priority: "high",
      number: 7,
    }),
}));

vi.mock("../../../../../apps/api/src/plugins/sync/eligibility", () => ({
  canSyncTask: async () => true,
}));

vi.mock(
  "../../../../../apps/api/src/plugins/sync/initialize-task-issue",
  () => ({
    isIssueInitializationPending: () => false,
    initializeTaskIssue: (...args: unknown[]) =>
      mocks.initializeTaskIssue(...args),
  }),
);

vi.mock(
  "../../../../../apps/api/src/plugins/sync/sync-task-field-labels",
  () => ({
    syncTaskFieldLabels: (...args: unknown[]) =>
      mocks.syncTaskFieldLabels(...args),
  }),
);

vi.mock("../../../../../apps/api/src/plugins/sync/issue-state-change", () => ({
  resolveIssueStateChange: async () => null,
}));

vi.mock("../../../../../apps/api/src/plugins/gitea/utils/gitea-api", () => ({
  createGiteaClient: () => ({ createIssue: mocks.createIssue }),
}));

vi.mock("../../../../../apps/api/src/plugins/gitea/utils/labels", () => ({
  addLabelsToIssueGitea: (...args: unknown[]) =>
    mocks.addLabelsToIssueGitea(...args),
  removeLabelGitea: (...args: unknown[]) => mocks.removeLabelGitea(...args),
}));

vi.mock(
  "../../../../../apps/api/src/plugins/github/services/task-service",
  () => ({ findTaskWithCraft: async () => ({ id: "task-1", craft: null }) }),
);

vi.mock(
  "../../../../../apps/api/src/plugins/github/services/link-manager",
  () => ({
    findExternalLinksByTask: (...args: unknown[]) =>
      mocks.findExternalLinksByTask(...args),
    findExternalLinkByTaskAndType: (...args: unknown[]) =>
      mocks.findExternalLinkByTaskAndType(...args),
    createExternalLink: (...args: unknown[]) =>
      mocks.createExternalLink(...args),
    updateExternalLink: vi.fn(),
  }),
);

const context = {
  integrationId: "integration-1",
  projectId: "project-1",
  config: {
    baseUrl: "https://gitea.studio555.io",
    accessToken: "token",
    repositoryOwner: "Studio555",
    repositoryName: "s555-atlas",
  },
};

async function changeStatus(oldStatus: string, newStatus: string) {
  await handleTaskStatusChanged(
    {
      taskId: "task-1",
      projectId: "project-1",
      userId: "user-1",
      oldStatus,
      newStatus,
      title: "TEST",
    } as Parameters<typeof handleTaskStatusChanged>[0],
    context as Parameters<typeof handleTaskStatusChanged>[1],
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findExternalLinksByTask.mockResolvedValue([]);
  mocks.findExternalLinkByTaskAndType.mockResolvedValue(undefined);
  mocks.createExternalLink.mockResolvedValue({ id: "link-new" });
  mocks.initializeTaskIssue.mockResolvedValue(undefined);
  mocks.createIssue.mockResolvedValue({
    number: 42,
    html_url: "https://gitea.studio555.io/Studio555/s555-atlas/issues/42",
    title: "Rework the onboarding flow",
    state: "open",
  });
});

describe("handleTaskStatusChanged", () => {
  it("opens the issue when a backlog task first reaches a board column", async () => {
    await changeStatus("planned", "to-do");

    expect(mocks.createIssue).toHaveBeenCalledWith(
      "Studio555",
      "s555-atlas",
      expect.objectContaining({ title: "Rework the onboarding flow" }),
    );
    expect(mocks.createExternalLink).toHaveBeenCalledWith(
      expect.objectContaining({ externalId: "42" }),
    );
    expect(mocks.syncTaskFieldLabels).not.toHaveBeenCalled();
  });

  it.each(["archived", "icebox"])(
    "leaves a task without an issue when it moves from planned to %s",
    async (status) => {
      await changeStatus("planned", status);

      expect(mocks.createIssue).not.toHaveBeenCalled();
      expect(mocks.createExternalLink).not.toHaveBeenCalled();
    },
  );

  it("initializes the issue it opens in the done state", async () => {
    await changeStatus("planned", "done");

    expect(mocks.createIssue).toHaveBeenCalledTimes(1);
    expect(mocks.initializeTaskIssue).toHaveBeenCalledWith(
      expect.objectContaining({ status: "done" }),
      context,
      { id: "link-new" },
      expect.anything(),
    );
  });

  it("syncs status labels for a task that already has an issue", async () => {
    const link = {
      id: "link-1",
      taskId: "task-1",
      integrationId: "integration-1",
      resourceType: "issue",
      externalId: "2",
      metadata: JSON.stringify({ state: "open", createdFrom: "kaneo" }),
    };
    mocks.findExternalLinksByTask.mockResolvedValue([link]);
    mocks.syncTaskFieldLabels.mockImplementation(
      async (_taskId, _context, _link, _provider, _field, send) => {
        await send(
          { add: ["status:in-progress"], remove: ["status:to-do"] },
          undefined,
        );
        return "in-progress";
      },
    );

    await changeStatus("to-do", "in-progress");

    expect(mocks.syncTaskFieldLabels).toHaveBeenCalledWith(
      "task-1",
      context,
      link,
      "gitea",
      "status",
      expect.any(Function),
    );
    expect(mocks.removeLabelGitea).toHaveBeenCalledWith(
      context.config,
      2,
      "status:to-do",
      undefined,
      true,
    );
    expect(mocks.addLabelsToIssueGitea).toHaveBeenCalledWith(
      context.config,
      2,
      ["status:in-progress"],
      true,
      undefined,
    );
    expect(mocks.createIssue).not.toHaveBeenCalled();
  });
});
