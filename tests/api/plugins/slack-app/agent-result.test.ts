import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  CODEX_SIGNED_OUT_REMINDER,
  handleAgentResultComment,
  parseAgentResultComment,
} from "../../../../apps/api/src/plugins/slack-app/agent-result";

const mocks = vi.hoisted(() => ({
  externalLinkFindFirst: vi.fn(),
  taskFindFirst: vi.fn(),
  integrationFindFirst: vi.fn(),
  projectFindFirst: vi.fn(),
  findExternalLink: vi.fn(),
  findAllIntegrationsByRepoName: vi.fn(),
}));

vi.mock("../../../../apps/api/src/database", () => ({
  default: {
    query: {
      externalLinkTable: { findFirst: mocks.externalLinkFindFirst },
      taskTable: { findFirst: mocks.taskFindFirst },
      integrationTable: { findFirst: mocks.integrationFindFirst },
      projectTable: { findFirst: mocks.projectFindFirst },
    },
  },
}));

vi.mock(
  "../../../../apps/api/src/plugins/github/services/link-manager",
  () => ({
    findExternalLink: (...args: unknown[]) => mocks.findExternalLink(...args),
    createExternalLink: vi.fn(),
  }),
);

vi.mock(
  "../../../../apps/api/src/plugins/github/services/task-service",
  () => ({
    findAllIntegrationsByRepoName: (...args: unknown[]) =>
      mocks.findAllIntegrationsByRepoName(...args),
  }),
);

const MAINTAINER = "U0AKCQBB1B3";
const repository = { owner: "Studio555", name: "s555-atlas" };

function runLink(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    taskId: "task-1",
    integrationId: "int-1",
    resourceType: "agent_run",
    metadata: JSON.stringify({
      slackUserId: "UREACTOR",
      githubLogin: "alex-gh",
      channel: "C1",
      messageTs: "1700000000.000100",
      threadTs: "1700000000.000100",
      repository: "Studio555/s555-atlas",
      issueNumber: 31,
      ...overrides,
    }),
  };
}

function client() {
  return { postDirectMessage: vi.fn(async () => undefined) };
}

function comment(marker: string, text = "The agent opened a pull request.") {
  return `${text}\n\n<!-- agent-fix ${marker} -->`;
}

function deliver(
  body: string,
  slack: ReturnType<typeof client>,
  authorLogin = "github-actions[bot]",
) {
  return handleAgentResultComment(
    { body, authorLogin, repository, issueNumber: 31 },
    // The handler only ever sends direct messages.
    { client: slack as never },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.KANEO_CLIENT_URL = "https://kaneo.studio555.cloud";

  mocks.externalLinkFindFirst.mockResolvedValue(runLink());
  mocks.taskFindFirst.mockResolvedValue({
    id: "task-1",
    number: 7,
    projectId: "proj-1",
  });
  mocks.projectFindFirst.mockResolvedValue({
    id: "proj-1",
    slug: "ps",
    workspaceId: "ws-1",
  });
  mocks.integrationFindFirst.mockResolvedValue({
    id: "int-1",
    config: JSON.stringify({
      agentEmoji: "robot_fix",
      maintainerSlackUserId: MAINTAINER,
    }),
  });
  mocks.findAllIntegrationsByRepoName.mockResolvedValue([{ id: "gh-1" }]);
  mocks.findExternalLink.mockResolvedValue({ taskId: "task-1" });
});

describe("parseAgentResultComment", () => {
  it("reads every field and keeps the text for people", () => {
    expect(
      parseAgentResultComment(
        comment(
          "result=pr_opened reason=ok run=run-1 pr=https://github.com/Studio555/showrooms-server/pull/9",
        ),
      ),
    ).toEqual({
      result: "pr_opened",
      reason: "ok",
      run: "run-1",
      pr: "https://github.com/Studio555/showrooms-server/pull/9",
      text: "The agent opened a pull request.",
    });
  });

  it("does not mistake the request comment for a result", () => {
    expect(
      parseAgentResultComment(
        "🤖 Agent fix requested by @alex-gh\n\n<!-- agent-fix requester=alex-gh run=run-1 -->",
      ),
    ).toBeNull();
  });

  it("ignores a comment without the marker", () => {
    expect(parseAgentResultComment("Looks good to me")).toBeNull();
  });
});

describe("handleAgentResultComment", () => {
  it("DMs the requester the pull request when one opened", async () => {
    const slack = client();

    const handled = await deliver(
      comment(
        "result=pr_opened reason=ok run=run-1 pr=https://github.com/Studio555/showrooms-server/pull/9",
      ),
      slack,
    );

    expect(handled).toBe(true);
    expect(slack.postDirectMessage).toHaveBeenCalledTimes(1);
    expect(slack.postDirectMessage).toHaveBeenCalledWith({
      userId: "UREACTOR",
      text: "Your agent fix for PS-7 is ready for review: https://github.com/Studio555/showrooms-server/pull/9",
    });
  });

  it("DMs the requester why the agent declined", async () => {
    const slack = client();

    await deliver(
      comment(
        "result=declined reason=multi_repo run=run-1 pr=",
        "This needs changes in two repositories.",
      ),
      slack,
    );

    expect(slack.postDirectMessage).toHaveBeenCalledWith({
      userId: "UREACTOR",
      text: "The agent declined PS-7.\n\nThis needs changes in two repositories.",
    });
  });

  it("also reminds the maintainer to sign Codex in when it is signed out", async () => {
    const slack = client();

    await deliver(
      comment(
        "result=failed reason=codex_signed_out run=run-1 pr=",
        "Codex is not signed in on the runner.",
      ),
      slack,
    );

    expect(slack.postDirectMessage).toHaveBeenCalledTimes(2);
    expect(slack.postDirectMessage).toHaveBeenCalledWith({
      userId: MAINTAINER,
      text: CODEX_SIGNED_OUT_REMINDER,
    });
    expect(slack.postDirectMessage).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "UREACTOR" }),
    );
  });

  it("sends the maintainer one message when they requested the run themselves", async () => {
    mocks.externalLinkFindFirst.mockResolvedValue(
      runLink({ slackUserId: MAINTAINER }),
    );
    const slack = client();

    await deliver(
      comment("result=failed reason=codex_signed_out run=run-1 pr="),
      slack,
    );

    expect(slack.postDirectMessage).toHaveBeenCalledTimes(1);
    expect(slack.postDirectMessage).toHaveBeenCalledWith({
      userId: MAINTAINER,
      text: expect.stringContaining(CODEX_SIGNED_OUT_REMINDER),
    });
  });

  it("does not bother the maintainer about other failures", async () => {
    const slack = client();

    await deliver(
      comment("result=failed reason=validation_failed run=run-1 pr="),
      slack,
    );

    expect(slack.postDirectMessage).toHaveBeenCalledTimes(1);
    expect(slack.postDirectMessage).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "UREACTOR" }),
    );
  });

  it("ignores the marker from anyone but the workflow", async () => {
    const slack = client();

    const handled = await deliver(
      comment("result=failed reason=codex_signed_out run=run-1 pr="),
      slack,
      "someone-else",
    );

    expect(handled).toBe(false);
    expect(slack.postDirectMessage).not.toHaveBeenCalled();
  });

  it("tells nobody when the named run belongs to another issue", async () => {
    mocks.externalLinkFindFirst.mockResolvedValue(runLink({ issueNumber: 99 }));
    const slack = client();

    await deliver(
      comment("result=pr_opened reason=ok run=run-1 pr=https://x/pull/1"),
      slack,
    );

    expect(slack.postDirectMessage).not.toHaveBeenCalled();
  });

  it("does not hand another issue's result to this issue's latest requester", async () => {
    mocks.externalLinkFindFirst
      .mockResolvedValueOnce(runLink({ issueNumber: 99 }))
      .mockResolvedValue(runLink());
    const slack = client();

    await deliver(
      comment("result=pr_opened reason=ok run=run-1 pr=https://x/pull/1"),
      slack,
    );

    expect(mocks.findExternalLink).not.toHaveBeenCalled();
    expect(slack.postDirectMessage).not.toHaveBeenCalled();
  });

  it("falls back to the issue's newest run when the marker names none", async () => {
    const slack = client();

    await deliver(
      comment("result=pr_opened reason=ok run= pr=https://x/pull/1"),
      slack,
    );

    expect(mocks.findExternalLink).toHaveBeenCalledWith("gh-1", "issue", "31");
    expect(slack.postDirectMessage).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "UREACTOR" }),
    );
  });

  it("still reports done when the DM cannot be delivered", async () => {
    const slack = {
      postDirectMessage: vi.fn(async () => {
        throw new Error("user_not_found");
      }),
    };

    await expect(
      deliver(comment("result=pr_opened reason=ok run=run-1 pr=x"), slack),
    ).resolves.toBe(true);
  });
});
