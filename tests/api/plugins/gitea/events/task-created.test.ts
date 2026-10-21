import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { handleTaskCreated } from "../../../../../apps/api/src/plugins/gitea/events/task-created";

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
  findExternalLinkByTaskAndType: vi.fn(),
  createExternalLink: vi.fn(),
  addLabelsToIssueGitea: vi.fn(),
  findTaskWithCraft: vi.fn(),
  initializeTaskIssue: vi.fn(),
}));

vi.mock("../../../../../apps/api/src/database", () => ({ default: {} }));

// Lease, eligibility and initialization have their own coverage; these cases
// pin down only which tasks get an issue and how it is labelled.
vi.mock("../../../../../apps/api/src/plugins/sync/create-task-issue", () => ({
  withTaskSyncCreation: (
    event: unknown,
    _context: unknown,
    create: (current: unknown) => Promise<void>,
  ) => create(event),
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

vi.mock("../../../../../apps/api/src/plugins/gitea/utils/gitea-api", () => ({
  createGiteaClient: () => ({ createIssue: mocks.createIssue }),
}));

vi.mock("../../../../../apps/api/src/plugins/gitea/utils/labels", () => ({
  addLabelsToIssueGitea: (...args: unknown[]) =>
    mocks.addLabelsToIssueGitea(...args),
  removeLabelGitea: vi.fn(),
}));

vi.mock(
  "../../../../../apps/api/src/plugins/github/services/task-service",
  () => ({
    findTaskWithCraft: (...args: unknown[]) => mocks.findTaskWithCraft(...args),
  }),
);

vi.mock(
  "../../../../../apps/api/src/plugins/github/services/link-manager",
  () => ({
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

async function create(status: string) {
  await handleTaskCreated(
    event(status) as Parameters<typeof handleTaskCreated>[0],
    context as Parameters<typeof handleTaskCreated>[1],
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findExternalLinkByTaskAndType.mockResolvedValue(undefined);
  mocks.createExternalLink.mockResolvedValue({ id: "link-new" });
  mocks.addLabelsToIssueGitea.mockResolvedValue(undefined);
  mocks.findTaskWithCraft.mockResolvedValue({ id: "task-1", craft: null });
  mocks.initializeTaskIssue.mockResolvedValue(undefined);
  mocks.createIssue.mockResolvedValue({
    number: 42,
    html_url: "https://gitea.studio555.io/Studio555/s555-atlas/issues/42",
    title: "Rework the onboarding flow",
    state: "open",
  });
});

describe("handleTaskCreated", () => {
  it("opens an issue for a task created in a board column", async () => {
    await create("to-do");

    expect(mocks.createIssue).toHaveBeenCalledWith(
      "Studio555",
      "s555-atlas",
      expect.objectContaining({ title: "Rework the onboarding flow" }),
    );
    expect(mocks.createExternalLink).toHaveBeenCalledWith(
      expect.objectContaining({ externalId: "42" }),
    );
    expect(mocks.initializeTaskIssue).toHaveBeenCalledTimes(1);
  });

  it("labels the new issue with the task's craft in its colour", async () => {
    mocks.findTaskWithCraft.mockResolvedValue({
      id: "task-1",
      craft: { name: "Engineering", color: "blue" },
    });

    await create("to-do");

    expect(mocks.addLabelsToIssueGitea).toHaveBeenCalledWith(
      context.config,
      42,
      ["craft:Engineering"],
      false,
      undefined,
      { "craft:Engineering": "blue" },
    );
  });

  it.each(["planned", "archived"])(
    "leaves a %s task without an issue",
    async (status) => {
      await create(status);

      expect(mocks.createIssue).not.toHaveBeenCalled();
      expect(mocks.createExternalLink).not.toHaveBeenCalled();
    },
  );

  it("leaves a task in a custom backlog section without an issue", async () => {
    await create("icebox");

    expect(backlogStatus.isBacklogStatus).toHaveBeenCalledWith(
      "project-1",
      "icebox",
    );
    expect(mocks.createIssue).not.toHaveBeenCalled();
    expect(mocks.createExternalLink).not.toHaveBeenCalled();
  });
});
