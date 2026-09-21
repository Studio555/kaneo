import { beforeEach, describe, expect, it, vi } from "vitest";
import { notifyTaskCompleted } from "../../../../apps/api/src/plugins/slack-app/events";

const mocks = vi.hoisted(() => ({
  columnFindMany: vi.fn(),
  taskFindFirst: vi.fn(),
  projectFindFirst: vi.fn(),
  findExternalLinkByTaskAndType: vi.fn(),
}));

vi.mock("../../../../apps/api/src/database", () => ({
  default: {
    query: {
      columnTable: { findMany: mocks.columnFindMany },
      taskTable: { findFirst: mocks.taskFindFirst },
      projectTable: { findFirst: mocks.projectFindFirst },
    },
  },
}));

vi.mock(
  "../../../../apps/api/src/plugins/github/services/link-manager",
  () => ({
    findExternalLinkByTaskAndType: (...args: unknown[]) =>
      mocks.findExternalLinkByTaskAndType(...args),
  }),
);

function slackClient() {
  return { postThreadReply: vi.fn(async () => undefined) };
}

const context = {
  integrationId: "int-1",
  projectId: "proj-1",
  config: {},
};

const statusChanged = {
  taskId: "task-1",
  projectId: "proj-1",
  userId: "user-1",
  oldStatus: "in-progress",
  newStatus: "done",
  title: "The checkout screen crashes",
};

beforeEach(() => {
  vi.clearAllMocks();

  mocks.columnFindMany.mockResolvedValue([
    { slug: "to-do", isFinal: false },
    { slug: "in-progress", isFinal: false },
    { slug: "done", isFinal: true },
    { slug: "shipped", isFinal: true },
  ]);
  mocks.taskFindFirst.mockResolvedValue({ id: "task-1", number: 7 });
  mocks.projectFindFirst.mockResolvedValue({ slug: "ps" });
  mocks.findExternalLinkByTaskAndType.mockResolvedValue({
    id: "link-1",
    taskId: "task-1",
    metadata: JSON.stringify({
      channel: "C1",
      messageTs: "1700000000.000100",
      threadTs: "1699999999.000100",
    }),
  });
});

describe("notifyTaskCompleted", () => {
  it("replies in the originating thread when the task reaches a final column", async () => {
    const client = slackClient();

    await notifyTaskCompleted(statusChanged, context, client);

    expect(client.postThreadReply).toHaveBeenCalledWith({
      channel: "C1",
      threadTs: "1699999999.000100",
      text: "✅ PS-7 is done.",
    });
  });

  it("stays quiet when the new column is not a final one", async () => {
    const client = slackClient();

    await notifyTaskCompleted(
      { ...statusChanged, newStatus: "in-progress" },
      context,
      client,
    );

    expect(client.postThreadReply).not.toHaveBeenCalled();
  });

  it("stays quiet when the task merely moved between two final columns", async () => {
    const client = slackClient();

    await notifyTaskCompleted(
      { ...statusChanged, oldStatus: "done", newStatus: "shipped" },
      context,
      client,
    );

    expect(client.postThreadReply).not.toHaveBeenCalled();
  });

  it("stays quiet for a task that did not come from Slack", async () => {
    mocks.findExternalLinkByTaskAndType.mockResolvedValue(undefined);
    const client = slackClient();

    await notifyTaskCompleted(statusChanged, context, client);

    expect(client.postThreadReply).not.toHaveBeenCalled();
  });

  it("stays quiet when the stored link has unreadable metadata", async () => {
    mocks.findExternalLinkByTaskAndType.mockResolvedValue({
      id: "link-1",
      taskId: "task-1",
      metadata: "not-json",
    });
    const client = slackClient();

    await notifyTaskCompleted(statusChanged, context, client);

    expect(client.postThreadReply).not.toHaveBeenCalled();
  });

  it("does not let a Slack failure escape into the event bus", async () => {
    const client = {
      postThreadReply: vi.fn(async () => {
        throw new Error("channel_not_found");
      }),
    };

    await expect(
      notifyTaskCompleted(statusChanged, context, client),
    ).resolves.toBeUndefined();
  });
});
