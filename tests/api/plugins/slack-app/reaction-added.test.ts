import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleReactionAdded } from "../../../../apps/api/src/plugins/slack-app/reaction-added";

const mocks = vi.hoisted(() => ({
  integrationFindMany: vi.fn(),
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
      integrationTable: { findMany: mocks.integrationFindMany },
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

const reaction = {
  reaction: "kaneo",
  userId: "UREACTOR",
  itemType: "message" as const,
  channel: "C1",
  ts: "1700000000.000100",
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.KANEO_CLIENT_URL = "https://kaneo.studio555.cloud";

  mocks.integrationFindMany.mockResolvedValue([
    { id: "int-1", projectId: "proj-1", config: JSON.stringify({}) },
  ]);
  mocks.columnFindFirst.mockResolvedValue({ slug: "to-do" });
  mocks.userFindFirst.mockResolvedValue({ id: "user-1" });
  mocks.projectFindFirst.mockResolvedValue({
    id: "proj-1",
    slug: "ps",
    workspaceId: "ws-1",
  });
  mocks.findExternalLink.mockResolvedValue(null);
  // clearAllMocks keeps implementations, so a rejection set by one test would
  // otherwise leak into every test after it.
  mocks.createExternalLink.mockResolvedValue({ id: "link-1" });
  mocks.deleteTask.mockResolvedValue(undefined);
  mocks.getProjectWorkspaceId.mockResolvedValue("ws-1");
  mocks.filterAssignableUsers.mockResolvedValue(new Set(["user-1"]));
  mocks.createTask.mockResolvedValue({
    id: "task-1",
    number: 7,
    projectId: "proj-1",
  });
});

describe("handleReactionAdded", () => {
  it("creates a task in the integration's project from the reacted message", async () => {
    const client = slackClient();

    await handleReactionAdded(reaction, { client });

    expect(mocks.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "proj-1",
        title: "The checkout screen crashes",
        status: "to-do",
        priority: "no-priority",
      }),
    );
  });

  it("assigns the Kaneo user whose email matches the reacting person", async () => {
    await handleReactionAdded(reaction, { client: slackClient() });

    expect(mocks.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", currentUserId: "user-1" }),
    );
  });

  it("leaves the task unassigned when no Kaneo account matches", async () => {
    mocks.userFindFirst.mockResolvedValue(undefined);

    await handleReactionAdded(reaction, { client: slackClient() });

    const args = mocks.createTask.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(args.userId).toBeUndefined();
  });

  it("leaves the task unassigned when Slack exposes no email for the reactor", async () => {
    const client = slackClient({ getUserEmail: vi.fn(async () => null) });

    await handleReactionAdded(reaction, { client });

    const args = mocks.createTask.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(args.userId).toBeUndefined();
    expect(mocks.userFindFirst).not.toHaveBeenCalled();
  });

  it("ignores a different emoji", async () => {
    await handleReactionAdded(
      { ...reaction, reaction: "eyes" },
      { client: slackClient() },
    );

    expect(mocks.createTask).not.toHaveBeenCalled();
  });

  it("ignores a reaction on something that is not a message", async () => {
    await handleReactionAdded(
      { ...reaction, itemType: "file" },
      { client: slackClient() },
    );

    expect(mocks.createTask).not.toHaveBeenCalled();
  });

  it("does nothing when no active integration is configured", async () => {
    mocks.integrationFindMany.mockResolvedValue([]);

    await handleReactionAdded(reaction, { client: slackClient() });

    expect(mocks.createTask).not.toHaveBeenCalled();
  });

  it("records the Slack message as an external link on the task", async () => {
    await handleReactionAdded(reaction, { client: slackClient() });

    expect(mocks.createExternalLink).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "task-1",
        integrationId: "int-1",
        resourceType: "slack_message",
        externalId: "C1:1700000000.000100",
        url: "https://studio555.slack.com/archives/C1/p1",
      }),
    );
  });

  it("replies in the thread with the new task's identifier and link", async () => {
    const client = slackClient();

    await handleReactionAdded(reaction, { client });

    expect(client.postThreadReply).toHaveBeenCalledWith({
      channel: "C1",
      threadTs: "1700000000.000100",
      text: "Created PS-7 — https://kaneo.studio555.cloud/dashboard/workspace/ws-1/project/proj-1/task/task-1",
    });
  });

  it("does not create a second task when the message is already linked", async () => {
    mocks.findExternalLink.mockResolvedValue({ taskId: "task-1" });
    mocks.taskFindFirst.mockResolvedValue({
      id: "task-1",
      number: 7,
      projectId: "proj-1",
    });

    await handleReactionAdded(reaction, { client: slackClient() });

    expect(mocks.createTask).not.toHaveBeenCalled();
    expect(mocks.createExternalLink).not.toHaveBeenCalled();
  });

  it("re-posts the existing task's link when the message is already linked", async () => {
    mocks.findExternalLink.mockResolvedValue({ taskId: "task-1" });
    mocks.taskFindFirst.mockResolvedValue({
      id: "task-1",
      number: 7,
      projectId: "proj-1",
    });
    const client = slackClient();

    await handleReactionAdded(reaction, { client });

    expect(client.postThreadReply).toHaveBeenCalledWith({
      channel: "C1",
      threadTs: "1700000000.000100",
      text: "Already filed as PS-7 — https://kaneo.studio555.cloud/dashboard/workspace/ws-1/project/proj-1/task/task-1",
    });
  });

  it("matches the emoji configured on the integration instead of the default", async () => {
    mocks.integrationFindMany.mockResolvedValue([
      {
        id: "int-1",
        projectId: "proj-1",
        config: JSON.stringify({ emoji: ":ticket:" }),
      },
    ]);

    await handleReactionAdded(
      { ...reaction, reaction: "ticket" },
      { client: slackClient() },
    );

    expect(mocks.createTask).toHaveBeenCalledTimes(1);
  });

  it("files nothing when two integrations claim the same emoji", async () => {
    mocks.integrationFindMany.mockResolvedValue([
      { id: "int-1", projectId: "proj-1", config: JSON.stringify({}) },
      { id: "int-2", projectId: "proj-2", config: JSON.stringify({}) },
    ]);

    await handleReactionAdded(reaction, { client: slackClient() });

    expect(mocks.createTask).not.toHaveBeenCalled();
    expect(mocks.createExternalLink).not.toHaveBeenCalled();
  });

  it("leaves the task unassigned when the matched user is not in the project's workspace", async () => {
    mocks.filterAssignableUsers.mockResolvedValue(new Set());

    await handleReactionAdded(reaction, { client: slackClient() });

    const args = mocks.createTask.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(args.userId).toBeUndefined();
    expect(mocks.createTask).toHaveBeenCalledTimes(1);
  });

  it("removes its own task when another delivery linked the message first", async () => {
    mocks.createExternalLink.mockRejectedValue(
      Object.assign(new Error("duplicate key"), { code: "23505" }),
    );
    mocks.findExternalLink
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ taskId: "task-winner" });
    mocks.taskFindFirst.mockResolvedValue({
      id: "task-winner",
      number: 7,
      projectId: "proj-1",
    });
    const client = slackClient();

    await handleReactionAdded(reaction, { client });

    expect(mocks.deleteTask).toHaveBeenCalledTimes(1);
    expect(client.postThreadReply).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "Already filed as PS-7 — https://kaneo.studio555.cloud/dashboard/workspace/ws-1/project/proj-1/task/task-winner",
      }),
    );
  });

  it("lets an unexpected link failure surface instead of swallowing it", async () => {
    mocks.createExternalLink.mockRejectedValue(new Error("connection lost"));

    await expect(
      handleReactionAdded(reaction, { client: slackClient() }),
    ).rejects.toThrow("connection lost");
  });

  it("still creates the task when the thread reply fails", async () => {
    const client = slackClient({
      postThreadReply: vi.fn(async () => {
        throw new Error("not_in_channel");
      }),
    });

    await expect(
      handleReactionAdded(reaction, { client }),
    ).resolves.toBeUndefined();

    expect(mocks.createTask).toHaveBeenCalledTimes(1);
    expect(mocks.createExternalLink).toHaveBeenCalledTimes(1);
  });

  it("skips a message that has been deleted before the reaction was processed", async () => {
    const client = slackClient({ getMessage: vi.fn(async () => null) });

    await handleReactionAdded(reaction, { client });

    expect(mocks.createTask).not.toHaveBeenCalled();
  });
});

describe("handleReactionAdded on a message inside a thread", () => {
  it("replies in the parent thread when the message is already linked", async () => {
    mocks.findExternalLink.mockResolvedValue({ taskId: "task-1" });
    mocks.taskFindFirst.mockResolvedValue({
      id: "task-1",
      number: 7,
      projectId: "proj-1",
    });
    const client = slackClient({
      getMessage: vi.fn(async () => ({
        text: "The checkout screen crashes",
        userId: "UAUTHOR",
        threadTs: "1699999999.000100",
      })),
    });

    await handleReactionAdded(reaction, { client });

    expect(client.postThreadReply).toHaveBeenCalledWith(
      expect.objectContaining({ threadTs: "1699999999.000100" }),
    );
  });
});
