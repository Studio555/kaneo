import { beforeEach, describe, expect, it, vi } from "vitest";
import { handlePullRequestOpened } from "../../../../../apps/api/src/plugins/github/webhooks/pull-request-opened";

const mocks = vi.hoisted(() => ({
  mockFindAllActiveGithubIntegrations: vi.fn(),
  mockFindTaskById: vi.fn(),
  mockFindTaskByNumber: vi.fn(),
  mockIsTaskInFinalState: vi.fn(),
  mockUpdateTaskStatus: vi.fn(),
  mockCreateExternalLink: vi.fn(),
  mockFindExternalLink: vi.fn(),
  mockFindPullRequestLinks: vi.fn(),
  mockUpdateExternalLink: vi.fn(),
  mockResolveTargetStatus: vi.fn(),
  mockPublishEvent: vi.fn(),
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
    findTaskByNumber: (...args: unknown[]) =>
      mocks.mockFindTaskByNumber(...args),
    isTaskInFinalState: (...args: unknown[]) =>
      mocks.mockIsTaskInFinalState(...args),
    updateTaskStatus: (...args: unknown[]) =>
      mocks.mockUpdateTaskStatus(...args),
  }),
);

vi.mock(
  "../../../../../apps/api/src/plugins/github/services/link-manager",
  () => ({
    createExternalLink: (...args: unknown[]) =>
      mocks.mockCreateExternalLink(...args),
    findExternalLink: (...args: unknown[]) =>
      mocks.mockFindExternalLink(...args),
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

function integration(
  id: string,
  overrides: Partial<{
    projectId: string;
    slug: string;
    repositoryOwner: string;
    repositoryName: string;
    installationId: number | null;
    config: string;
    project: unknown;
  }> = {},
) {
  const projectId = overrides.projectId ?? `project-${id}`;
  return {
    id,
    projectId,
    project:
      "project" in overrides
        ? overrides.project
        : { id: projectId, slug: overrides.slug ?? "atl" },
    config:
      overrides.config ??
      JSON.stringify({
        repositoryOwner: overrides.repositoryOwner ?? "Studio555",
        repositoryName: overrides.repositoryName ?? "s555-atlas",
        installationId: overrides.installationId ?? 42,
        branchPattern: "{slug}-{number}",
      }),
  };
}

function task(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    projectId: "project-integration-1",
    status: "to-do",
    title: `Task ${id}`,
    userId: null,
    columnId: null,
    ...overrides,
  };
}

function prPayload(
  overrides: {
    repo?: string;
    branch?: string;
    title?: string;
    body?: string | null;
    state?: string;
    installationId?: number;
    number?: number;
  } = {},
) {
  const repo = overrides.repo ?? SERVER;
  const [owner, name] = repo.split("/") as [string, string];
  const number = overrides.number ?? 7;
  return {
    action: "opened",
    pull_request: {
      number,
      title: overrides.title ?? "Walls and floors",
      body: overrides.body === undefined ? null : overrides.body,
      html_url: `https://github.com/${repo}/pull/${number}`,
      state: overrides.state ?? "open",
      draft: false,
      merged: false,
      head: { ref: overrides.branch ?? "arvid-studio555/walls-floors" },
      user: { login: "arvid" },
    },
    repository: { owner: { login: owner }, name, full_name: repo },
    installation:
      overrides.installationId === undefined
        ? undefined
        : { id: overrides.installationId },
  };
}

function prLink(taskId: string, metadata: Record<string, unknown>) {
  return {
    id: `link-${taskId}`,
    taskId,
    integrationId: "integration-1",
    resourceType: "pull_request",
    externalId: "7",
    metadata: JSON.stringify(metadata),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.mockFindAllActiveGithubIntegrations.mockResolvedValue([
    integration("integration-1"),
  ]);
  mocks.mockFindPullRequestLinks.mockResolvedValue([]);
  mocks.mockFindExternalLink.mockResolvedValue(undefined);
  mocks.mockFindTaskById.mockResolvedValue(undefined);
  mocks.mockFindTaskByNumber.mockResolvedValue(undefined);
  mocks.mockIsTaskInFinalState.mockResolvedValue(false);
  mocks.mockResolveTargetStatus.mockResolvedValue("in-review");
  mocks.mockCreateExternalLink.mockResolvedValue({ id: "new-link" });
  mocks.mockUpdateExternalLink.mockResolvedValue(undefined);
  mocks.mockUpdateTaskStatus.mockImplementation(
    async (taskId: string, status: string) => ({
      applied: true,
      before: { status: "to-do" },
      after: { ...task(taskId), status },
    }),
  );
});

describe("handlePullRequestOpened in the integration's own repository", () => {
  it("links the task named by the branch and moves it to in-review", async () => {
    mocks.mockFindTaskByNumber.mockResolvedValue(task("task-1"));

    await handlePullRequestOpened(prPayload({ repo: ATLAS, branch: "atl-5" }));

    expect(mocks.mockFindTaskByNumber).toHaveBeenCalledWith(
      "project-integration-1",
      5,
    );
    expect(mocks.mockCreateExternalLink).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "task-1",
        integrationId: "integration-1",
        resourceType: "pull_request",
        externalId: "7",
        url: `https://github.com/${ATLAS}/pull/7`,
        metadata: expect.objectContaining({ state: "open", repository: ATLAS }),
      }),
    );
    expect(mocks.mockUpdateTaskStatus).toHaveBeenCalledWith(
      "task-1",
      "in-review",
    );
    expect(mocks.mockPublishEvent).toHaveBeenCalledWith(
      "task.status_changed",
      expect.objectContaining({ taskId: "task-1", newStatus: "in-review" }),
    );
  });

  it("does nothing when the pull request is already linked to that task", async () => {
    mocks.mockFindTaskByNumber.mockResolvedValue(task("task-1"));
    mocks.mockFindPullRequestLinks.mockResolvedValue([
      prLink("task-1", { state: "open", repository: ATLAS }),
    ]);

    await handlePullRequestOpened(prPayload({ repo: ATLAS, branch: "atl-5" }));

    expect(mocks.mockCreateExternalLink).not.toHaveBeenCalled();
    expect(mocks.mockUpdateExternalLink).not.toHaveBeenCalled();
    expect(mocks.mockUpdateTaskStatus).not.toHaveBeenCalled();
    expect(mocks.mockPublishEvent).not.toHaveBeenCalled();
  });

  it("marks a reopened pull request open again and re-applies the transition", async () => {
    // Without this a reopened PR keeps state "closed" and the merge gate
    // believes it is no longer outstanding.
    mocks.mockFindTaskByNumber.mockResolvedValue(task("task-1"));
    mocks.mockFindPullRequestLinks.mockResolvedValue([
      prLink("task-1", { state: "closed", merged: false, author: "arvid" }),
    ]);

    await handlePullRequestOpened(prPayload({ repo: ATLAS, branch: "atl-5" }));

    expect(mocks.mockUpdateExternalLink).toHaveBeenCalledWith("link-task-1", {
      title: "Walls and floors",
      metadata: {
        state: "open",
        merged: false,
        draft: false,
        author: "arvid",
        repository: ATLAS,
      },
    });
    expect(mocks.mockCreateExternalLink).not.toHaveBeenCalled();
    expect(mocks.mockUpdateTaskStatus).toHaveBeenCalledWith(
      "task-1",
      "in-review",
    );
  });

  it("still links when the delivery comes from a different installation", async () => {
    mocks.mockFindTaskByNumber.mockResolvedValue(task("task-1"));

    await handlePullRequestOpened(
      prPayload({ repo: ATLAS, branch: "atl-5", installationId: 99 }),
    );

    expect(mocks.mockCreateExternalLink).toHaveBeenCalledTimes(1);
  });
});

describe("handlePullRequestOpened in another repository", () => {
  it("links the task whose issue the pull request references", async () => {
    mocks.mockFindExternalLink.mockResolvedValue({ taskId: "task-1" });
    mocks.mockFindTaskById.mockResolvedValue(task("task-1"));

    await handlePullRequestOpened(
      prPayload({ body: "Closes Studio555/s555-atlas#12" }),
    );

    expect(mocks.mockFindExternalLink).toHaveBeenCalledWith(
      "integration-1",
      "issue",
      "12",
    );
    expect(mocks.mockFindPullRequestLinks).toHaveBeenCalledWith(
      "integration-1",
      7,
      SERVER,
      ATLAS,
    );
    expect(mocks.mockCreateExternalLink).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "task-1",
        externalId: "7",
        url: `https://github.com/${SERVER}/pull/7`,
        metadata: expect.objectContaining({
          repository: SERVER,
          branch: "arvid-studio555/walls-floors",
          author: "arvid",
        }),
      }),
    );
    expect(mocks.mockUpdateTaskStatus).toHaveBeenCalledWith(
      "task-1",
      "in-review",
    );
  });

  it("links every task whose issue is referenced", async () => {
    mocks.mockFindExternalLink.mockImplementation(
      async (_integrationId: string, _type: string, externalId: string) => ({
        taskId: `task-${externalId}`,
      }),
    );
    mocks.mockFindTaskById.mockImplementation(async (id: string) => task(id));

    await handlePullRequestOpened(
      prPayload({
        body: "Closes Studio555/s555-atlas#12 and Studio555/s555-atlas#13",
      }),
    );

    expect(mocks.mockCreateExternalLink).toHaveBeenCalledTimes(2);
    expect(mocks.mockUpdateTaskStatus).toHaveBeenCalledWith(
      "task-12",
      "in-review",
    );
    expect(mocks.mockUpdateTaskStatus).toHaveBeenCalledWith(
      "task-13",
      "in-review",
    );
  });

  it("links in every project whose issue repository is referenced", async () => {
    mocks.mockFindAllActiveGithubIntegrations.mockResolvedValue([
      integration("integration-1"),
      integration("integration-2", {
        repositoryName: "s555-design",
        slug: "des",
      }),
    ]);
    mocks.mockFindExternalLink.mockImplementation(
      async (integrationId: string) => ({ taskId: `task-${integrationId}` }),
    );
    mocks.mockFindTaskById.mockImplementation(async (id: string) => task(id));

    await handlePullRequestOpened(
      prPayload({
        body: "Closes Studio555/s555-atlas#1\nCloses Studio555/s555-design#2",
      }),
    );

    expect(mocks.mockFindExternalLink).toHaveBeenCalledWith(
      "integration-1",
      "issue",
      "1",
    );
    expect(mocks.mockFindExternalLink).toHaveBeenCalledWith(
      "integration-2",
      "issue",
      "2",
    );
    expect(mocks.mockCreateExternalLink).toHaveBeenCalledTimes(2);
  });

  it("ignores a pull request that references nothing, or an issue no task is linked to", async () => {
    await handlePullRequestOpened(
      prPayload({ body: "No references here #12" }),
    );
    await handlePullRequestOpened(
      prPayload({ body: "Closes Studio555/s555-atlas#99" }),
    );

    expect(mocks.mockCreateExternalLink).not.toHaveBeenCalled();
    expect(mocks.mockUpdateTaskStatus).not.toHaveBeenCalled();
  });

  it("does not create a second link when the task already has this pull request", async () => {
    mocks.mockFindExternalLink.mockResolvedValue({ taskId: "task-1" });
    mocks.mockFindTaskById.mockResolvedValue(task("task-1"));
    mocks.mockFindPullRequestLinks.mockResolvedValue([
      prLink("task-1", { state: "open", repository: SERVER }),
    ]);

    await handlePullRequestOpened(
      prPayload({ body: "Closes Studio555/s555-atlas#12" }),
    );

    expect(mocks.mockCreateExternalLink).not.toHaveBeenCalled();
  });

  it("links a task even when the same pull request is already linked to another task", async () => {
    mocks.mockFindExternalLink.mockResolvedValue({ taskId: "task-1" });
    mocks.mockFindTaskById.mockResolvedValue(task("task-1"));
    mocks.mockFindPullRequestLinks.mockResolvedValue([
      prLink("task-other", { state: "open", repository: SERVER }),
    ]);

    await handlePullRequestOpened(
      prPayload({ body: "Closes Studio555/s555-atlas#12" }),
    );

    expect(mocks.mockCreateExternalLink).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "task-1" }),
    );
  });

  it("skips cross-repository linking when the delivery comes from another installation", async () => {
    mocks.mockFindExternalLink.mockResolvedValue({ taskId: "task-1" });
    mocks.mockFindTaskById.mockResolvedValue(task("task-1"));

    await handlePullRequestOpened(
      prPayload({ body: "Closes Studio555/s555-atlas#12", installationId: 99 }),
    );

    expect(mocks.mockFindExternalLink).not.toHaveBeenCalled();
    expect(mocks.mockCreateExternalLink).not.toHaveBeenCalled();
  });

  it("links without changing status when the task is already final", async () => {
    mocks.mockFindExternalLink.mockResolvedValue({ taskId: "task-1" });
    mocks.mockFindTaskById.mockResolvedValue(
      task("task-1", { status: "done" }),
    );
    mocks.mockIsTaskInFinalState.mockResolvedValue(true);

    await handlePullRequestOpened(
      prPayload({ body: "Closes Studio555/s555-atlas#12" }),
    );

    expect(mocks.mockCreateExternalLink).toHaveBeenCalledTimes(1);
    expect(mocks.mockUpdateTaskStatus).not.toHaveBeenCalled();
    expect(mocks.mockPublishEvent).toHaveBeenCalledWith(
      "task.updated",
      expect.objectContaining({
        taskId: "task-1",
        projectId: "project-integration-1",
      }),
    );
  });

  it("skips integrations with an unreadable config or no project and still processes the rest", async () => {
    mocks.mockFindAllActiveGithubIntegrations.mockResolvedValue([
      integration("broken", { config: "not json" }),
      integration("orphan", { project: null }),
      integration("integration-1"),
    ]);
    mocks.mockFindExternalLink.mockResolvedValue({ taskId: "task-1" });
    mocks.mockFindTaskById.mockResolvedValue(task("task-1"));

    await handlePullRequestOpened(
      prPayload({ body: "Closes Studio555/s555-atlas#12" }),
    );

    expect(mocks.mockFindExternalLink).toHaveBeenCalledTimes(1);
    expect(mocks.mockFindExternalLink).toHaveBeenCalledWith(
      "integration-1",
      "issue",
      "12",
    );
    expect(mocks.mockCreateExternalLink).toHaveBeenCalledTimes(1);
  });
});
