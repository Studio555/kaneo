import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleIssueCommentCreated } from "../../../../../apps/api/src/plugins/github/webhooks/issue-comment-created";

const mocks = vi.hoisted(() => ({
  handleAgentResultComment: vi.fn(),
  insert: vi.fn(),
  findExternalLink: vi.fn(),
  findAllIntegrationsByRepo: vi.fn(),
}));

vi.mock("../../../../../apps/api/src/plugins/slack-app/agent-result", () => ({
  handleAgentResultComment: (...args: unknown[]) =>
    mocks.handleAgentResultComment(...args),
}));

vi.mock("../../../../../apps/api/src/database", () => ({
  default: {
    insert: () => ({
      values: (...args: unknown[]) => {
        mocks.insert(...args);
        return { onConflictDoNothing: async () => undefined };
      },
    }),
  },
}));

vi.mock(
  "../../../../../apps/api/src/plugins/github/services/link-manager",
  () => ({
    findExternalLink: (...args: unknown[]) => mocks.findExternalLink(...args),
  }),
);

vi.mock(
  "../../../../../apps/api/src/plugins/github/services/task-service",
  () => ({
    findAllIntegrationsByRepo: (...args: unknown[]) =>
      mocks.findAllIntegrationsByRepo(...args),
  }),
);

function payload(login: string, body: string) {
  return {
    action: "created",
    issue: { number: 31 },
    comment: {
      id: 1,
      body,
      html_url: "https://github.com/Studio555/s555-atlas/issues/31#c1",
      user: { login, avatar_url: "" },
      created_at: "2026-10-02T00:00:00Z",
    },
    repository: { owner: { login: "Studio555" }, name: "s555-atlas" },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SLACK_BOT_TOKEN = "xoxb-test";
  mocks.findAllIntegrationsByRepo.mockResolvedValue([{ id: "gh-1" }]);
  mocks.findExternalLink.mockResolvedValue({ taskId: "task-1" });
});

afterEach(() => {
  process.env.SLACK_BOT_TOKEN = "";
});

describe("handleIssueCommentCreated", () => {
  it("hands the workflow's bot comment to the agent result handler before bots are dropped", async () => {
    mocks.handleAgentResultComment.mockResolvedValue(true);

    await handleIssueCommentCreated(
      payload("github-actions[bot]", "done <!-- agent-fix result=failed -->"),
    );

    expect(mocks.handleAgentResultComment).toHaveBeenCalledWith(
      expect.objectContaining({
        authorLogin: "github-actions[bot]",
        repository: { owner: "Studio555", name: "s555-atlas" },
        issueNumber: 31,
      }),
      expect.anything(),
    );
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("still records a person's comment as task activity", async () => {
    mocks.handleAgentResultComment.mockResolvedValue(false);

    await handleIssueCommentCreated(payload("alex-gh", "Can repro"));

    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "task-1", content: "Can repro" }),
    );
  });

  it("still drops other bot comments", async () => {
    mocks.handleAgentResultComment.mockResolvedValue(false);

    await handleIssueCommentCreated(payload("dependabot[bot]", "bump"));

    expect(mocks.insert).not.toHaveBeenCalled();
  });
});
