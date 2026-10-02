import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleReactionAdded } from "../../../../apps/api/src/plugins/slack-app/reaction-added";

const mocks = vi.hoisted(() => ({
  integrationFindMany: vi.fn(),
  integrationFindFirst: vi.fn(),
  columnFindFirst: vi.fn(),
  userFindFirst: vi.fn(),
  projectFindFirst: vi.fn(),
  taskFindFirst: vi.fn(),
  createTask: vi.fn(),
  createExternalLink: vi.fn(),
  findExternalLink: vi.fn(),
  filterAssignableUsers: vi.fn(),
  getProjectWorkspaceId: vi.fn(),
  deleteTask: vi.fn(),
  startTaskEnrichment: vi.fn(),
  ensureIssueForTask: vi.fn(),
  getGithubLoginForUser: vi.fn(),
  getGithubApp: vi.fn(),
  getInstallationIdForRepo: vi.fn(),
  addLabels: vi.fn(),
  listLabelsOnIssue: vi.fn(),
  createComment: vi.fn(),
}));

vi.mock("../../../../apps/api/src/plugins/slack-app/enrich-task", () => ({
  startTaskEnrichment: (...args: unknown[]) =>
    mocks.startTaskEnrichment(...args),
}));

vi.mock("../../../../apps/api/src/utils/assert-assignable-user", () => ({
  filterAssignableUsers: (...args: unknown[]) =>
    mocks.filterAssignableUsers(...args),
  getProjectWorkspaceId: (...args: unknown[]) =>
    mocks.getProjectWorkspaceId(...args),
}));

vi.mock("../../../../apps/api/src/database", () => ({
  default: {
    delete: () => ({
      where: async (...args: unknown[]) => mocks.deleteTask(...args),
    }),
    query: {
      integrationTable: {
        findMany: mocks.integrationFindMany,
        findFirst: mocks.integrationFindFirst,
      },
      columnTable: { findFirst: mocks.columnFindFirst },
      userTable: { findFirst: mocks.userFindFirst },
      projectTable: { findFirst: mocks.projectFindFirst },
      taskTable: { findFirst: mocks.taskFindFirst },
    },
  },
}));

vi.mock("../../../../apps/api/src/task/controllers/create-task", () => ({
  default: (...args: unknown[]) => mocks.createTask(...args),
}));

vi.mock(
  "../../../../apps/api/src/plugins/github/services/link-manager",
  () => ({
    createExternalLink: (...args: unknown[]) =>
      mocks.createExternalLink(...args),
    findExternalLink: (...args: unknown[]) => mocks.findExternalLink(...args),
  }),
);

vi.mock(
  "../../../../apps/api/src/plugins/github/services/issue-creator",
  () => ({
    ensureIssueForTask: (...args: unknown[]) =>
      mocks.ensureIssueForTask(...args),
  }),
);

vi.mock("../../../../apps/api/src/plugins/github/services/user-link", () => ({
  getGithubLoginForUser: (...args: unknown[]) =>
    mocks.getGithubLoginForUser(...args),
}));

vi.mock("../../../../apps/api/src/plugins/github/utils/github-app", () => ({
  getGithubApp: () => mocks.getGithubApp(),
  getInstallationIdForRepo: (...args: unknown[]) =>
    mocks.getInstallationIdForRepo(...args),
}));

const TASK_URL =
  "https://kaneo.studio555.cloud/dashboard/workspace/ws-1/project/proj-1/task/task-1";

function slackClient(overrides: Record<string, unknown> = {}) {
  return {
    getMessage: vi.fn(async () => ({
      text: "The checkout screen crashes",
      userId: "UAUTHOR",
      threadTs: "1700000000.000100",
    })),
    getUserEmail: vi.fn(async () => "alex@studio555.io"),
    getUserName: vi.fn(async () => "Alex"),
    getChannelName: vi.fn(async () => "bugs"),
    getPermalink: vi.fn(
      async () => "https://studio555.slack.com/archives/C1/p1",
    ),
    postThreadReply: vi.fn(async () => undefined),
    ...overrides,
  };
}

const agentReaction = {
  reaction: "robot_fix",
  userId: "UREACTOR",
  itemType: "message" as const,
  channel: "C1",
  ts: "1700000000.000100",
  eventTs: "1700000050.000200",
};

function uniqueViolation() {
  return Object.assign(new Error("duplicate key"), { code: "23505" });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.KANEO_CLIENT_URL = "https://kaneo.studio555.cloud";

  mocks.integrationFindMany.mockResolvedValue([
    {
      id: "int-1",
      projectId: "proj-1",
      config: JSON.stringify({ agentEmoji: ":robot_fix:" }),
    },
  ]);
  mocks.integrationFindFirst.mockResolvedValue({
    id: "gh-1",
    projectId: "proj-1",
    config: JSON.stringify({
      repositoryOwner: "Studio555",
      repositoryName: "s555-atlas",
      installationId: 42,
    }),
  });
  mocks.columnFindFirst.mockResolvedValue({ slug: "to-do" });
  mocks.userFindFirst.mockResolvedValue({ id: "user-1" });
  mocks.projectFindFirst.mockResolvedValue({
    id: "proj-1",
    slug: "ps",
    workspaceId: "ws-1",
  });
  mocks.taskFindFirst.mockResolvedValue({
    id: "task-1",
    number: 7,
    projectId: "proj-1",
    title: "The checkout screen crashes",
    description: "Filed from Slack",
    priority: "no-priority",
    status: "to-do",
    userId: "user-1",
  });
  mocks.findExternalLink.mockResolvedValue(null);
  mocks.createExternalLink.mockImplementation(
    async (params: { resourceType: string }) => ({
      id: params.resourceType === "agent_run" ? "run-1" : "link-1",
    }),
  );
  mocks.deleteTask.mockResolvedValue(undefined);
  mocks.getProjectWorkspaceId.mockResolvedValue("ws-1");
  mocks.filterAssignableUsers.mockResolvedValue(new Set(["user-1"]));
  mocks.createTask.mockResolvedValue({
    id: "task-1",
    number: 7,
    projectId: "proj-1",
  });
  mocks.startTaskEnrichment.mockReturnValue(false);
  mocks.ensureIssueForTask.mockResolvedValue({
    externalLinkId: "issue-link-1",
    issueNumber: 31,
    metadata: {},
    created: true,
  });
  mocks.getGithubLoginForUser.mockResolvedValue("alex-gh");
  mocks.createComment.mockResolvedValue({});
  mocks.getGithubApp.mockReturnValue({
    getInstallationOctokit: async () => ({
      rest: {
        issues: {
          createComment: mocks.createComment,
          addLabels: mocks.addLabels,
          listLabelsOnIssue: mocks.listLabelsOnIssue,
        },
      },
    }),
  });
  mocks.addLabels.mockResolvedValue({});
  mocks.listLabelsOnIssue.mockResolvedValue({ data: [] });
});

describe("handleReactionAdded with the agent emoji", () => {
  it("files the task, requests the run on its issue and says so in the thread", async () => {
    const client = slackClient();

    await handleReactionAdded(agentReaction, { client });

    expect(mocks.createTask).toHaveBeenCalledTimes(1);
    expect(mocks.ensureIssueForTask).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ taskId: "task-1", number: 7 }),
      expect.objectContaining({ integrationId: "gh-1", projectId: "proj-1" }),
    );
    expect(mocks.createComment).toHaveBeenCalledWith({
      owner: "Studio555",
      repo: "s555-atlas",
      issue_number: 31,
      body: "🤖 Agent fix requested by @alex-gh\n\n<!-- agent-fix requester=alex-gh run=run-1 -->",
    });
    expect(mocks.addLabels).toHaveBeenCalledWith({
      owner: "Studio555",
      repo: "s555-atlas",
      issue_number: 31,
      labels: ["agent:fix"],
    });
    expect(client.postThreadReply).toHaveBeenCalledWith({
      channel: "C1",
      threadTs: "1700000000.000100",
      text: `🤖 Agent picked up PS-7 — ${TASK_URL}`,
    });
  });

  it("records the run against the reaction, with whom to tell afterwards", async () => {
    await handleReactionAdded(agentReaction, { client: slackClient() });

    expect(mocks.createExternalLink).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "task-1",
        integrationId: "int-1",
        resourceType: "agent_run",
        externalId: "C1:1700000000.000100:1700000050.000200",
        metadata: {
          slackUserId: "UREACTOR",
          githubLogin: "alex-gh",
          channel: "C1",
          messageTs: "1700000000.000100",
          threadTs: "1700000000.000100",
          repository: "Studio555/s555-atlas",
          issueNumber: 31,
        },
      }),
    );
  });

  it("still runs for someone without a linked GitHub account, tagging nobody", async () => {
    mocks.getGithubLoginForUser.mockResolvedValue(null);

    await handleReactionAdded(agentReaction, { client: slackClient() });

    expect(mocks.createComment).toHaveBeenCalledWith(
      expect.objectContaining({
        body: "🤖 Agent fix requested from Slack.\n\n<!-- agent-fix requester= run=run-1 -->",
      }),
    );
    expect(mocks.addLabels).toHaveBeenCalledTimes(1);
  });

  it("refuses a second request while a run on the issue is still pending", async () => {
    mocks.listLabelsOnIssue.mockResolvedValue({
      data: [{ name: "status:in-progress" }, { name: "agent:fix" }],
    });
    const client = slackClient();

    await handleReactionAdded(agentReaction, { client });

    expect(mocks.createExternalLink).not.toHaveBeenCalledWith(
      expect.objectContaining({ resourceType: "agent_run" }),
    );
    expect(mocks.createComment).not.toHaveBeenCalled();
    expect(mocks.addLabels).not.toHaveBeenCalled();
    expect(client.postThreadReply).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("already working on PS-7"),
      }),
    );
  });

  it("does not claim the agent picked it up when GitHub refuses the label", async () => {
    mocks.addLabels.mockRejectedValue(new Error("403"));
    const client = slackClient();

    await handleReactionAdded(agentReaction, { client });

    expect(client.postThreadReply).toHaveBeenCalledTimes(1);
    expect(client.postThreadReply).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("GitHub refused the request"),
      }),
    );
  });

  it("refuses someone who is not a member of the Kaneo workspace, filing nothing", async () => {
    mocks.filterAssignableUsers.mockResolvedValue(new Set());
    const client = slackClient();

    await handleReactionAdded(agentReaction, { client });

    expect(mocks.createTask).not.toHaveBeenCalled();
    expect(mocks.createComment).not.toHaveBeenCalled();
    expect(client.postThreadReply).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("Only members of this Kaneo workspace"),
      }),
    );
  });

  it("refuses when the project is not connected to GitHub, filing nothing", async () => {
    mocks.integrationFindFirst.mockResolvedValue(undefined);
    const client = slackClient();

    await handleReactionAdded(agentReaction, { client });

    expect(mocks.createTask).not.toHaveBeenCalled();
    expect(client.postThreadReply).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("connected to GitHub"),
      }),
    );
  });

  it("starts nothing for a redelivered reaction", async () => {
    mocks.findExternalLink.mockResolvedValue({ taskId: "task-1" });
    mocks.createExternalLink.mockRejectedValue(uniqueViolation());
    const client = slackClient();

    await handleReactionAdded(agentReaction, { client });

    expect(mocks.createTask).not.toHaveBeenCalled();
    expect(mocks.createComment).not.toHaveBeenCalled();
    expect(mocks.addLabels).not.toHaveBeenCalled();
    expect(client.postThreadReply).not.toHaveBeenCalled();
  });

  it("runs on an already filed message without filing it again", async () => {
    mocks.findExternalLink.mockResolvedValue({ taskId: "task-1" });

    await handleReactionAdded(agentReaction, { client: slackClient() });

    expect(mocks.createTask).not.toHaveBeenCalled();
    expect(mocks.createComment).toHaveBeenCalledTimes(1);
  });

  it("tells the thread when GitHub cannot be reached, requesting nothing", async () => {
    mocks.ensureIssueForTask.mockRejectedValue(new Error("502"));
    const client = slackClient();

    await handleReactionAdded(agentReaction, { client });

    expect(mocks.createComment).not.toHaveBeenCalled();
    expect(client.postThreadReply).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("Couldn't start the agent for PS-7"),
      }),
    );
  });

  it("does not start enrichment, which would rewrite the issue mid-run", async () => {
    await handleReactionAdded(agentReaction, { client: slackClient() });

    expect(mocks.startTaskEnrichment).not.toHaveBeenCalled();
  });

  it("keeps the filing emoji filing when an agent emoji is also configured", async () => {
    await handleReactionAdded(
      { ...agentReaction, reaction: "kaneo" },
      { client: slackClient() },
    );

    expect(mocks.createTask).toHaveBeenCalledTimes(1);
    expect(mocks.createComment).not.toHaveBeenCalled();
  });

  it("refuses when two integrations claim the agent emoji", async () => {
    mocks.integrationFindMany.mockResolvedValue([
      {
        id: "int-1",
        projectId: "proj-1",
        config: JSON.stringify({ agentEmoji: "robot_fix" }),
      },
      {
        id: "int-2",
        projectId: "proj-2",
        config: JSON.stringify({ agentEmoji: "robot_fix" }),
      },
    ]);

    await handleReactionAdded(agentReaction, { client: slackClient() });

    expect(mocks.createTask).not.toHaveBeenCalled();
    expect(mocks.createComment).not.toHaveBeenCalled();
  });
});
