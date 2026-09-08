import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleTaskCreated } from "../../../../../apps/api/src/plugins/gitea/events/task-created";

const mocks = vi.hoisted(() => {
  const mockCreateIssue = vi.fn();
  const mockFindExternalLinkByTaskAndType = vi.fn();
  const mockCreateExternalLink = vi.fn();
  const mockAddLabelsToIssueGitea = vi.fn();

  return {
    mockCreateIssue,
    mockFindExternalLinkByTaskAndType,
    mockCreateExternalLink,
    mockAddLabelsToIssueGitea,
  };
});

vi.mock("../../../../../apps/api/src/plugins/gitea/utils/gitea-api", () => ({
  createGiteaClient: () => ({ createIssue: mocks.mockCreateIssue }),
}));

vi.mock("../../../../../apps/api/src/plugins/gitea/utils/labels", () => ({
  addLabelsToIssueGitea: (...args: unknown[]) =>
    mocks.mockAddLabelsToIssueGitea(...args),
}));

vi.mock(
  "../../../../../apps/api/src/plugins/github/services/link-manager",
  () => ({
    findExternalLinkByTaskAndType: (...args: unknown[]) =>
      mocks.mockFindExternalLinkByTaskAndType(...args),
    createExternalLink: (...args: unknown[]) =>
      mocks.mockCreateExternalLink(...args),
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
    craftName: null,
    craftColor: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.mockFindExternalLinkByTaskAndType.mockResolvedValue(undefined);
  mocks.mockCreateExternalLink.mockResolvedValue({ id: "link-new" });
  mocks.mockAddLabelsToIssueGitea.mockResolvedValue(undefined);
  mocks.mockCreateIssue.mockResolvedValue({
    number: 42,
    html_url: "https://gitea.studio555.io/Studio555/s555-atlas/issues/42",
    title: "Rework the onboarding flow",
    state: "open",
  });
});

describe("handleTaskCreated", () => {
  it("opens an issue for a task created in a board column", async () => {
    await handleTaskCreated(
      event("to-do") as Parameters<typeof handleTaskCreated>[0],
      context as Parameters<typeof handleTaskCreated>[1],
    );

    expect(mocks.mockCreateIssue).toHaveBeenCalledWith(
      "Studio555",
      "s555-atlas",
      expect.objectContaining({ title: "Rework the onboarding flow" }),
    );
    expect(mocks.mockCreateExternalLink).toHaveBeenCalledTimes(1);
  });

  it("leaves a backlog task without an issue", async () => {
    await handleTaskCreated(
      event("planned") as Parameters<typeof handleTaskCreated>[0],
      context as Parameters<typeof handleTaskCreated>[1],
    );

    expect(mocks.mockCreateIssue).not.toHaveBeenCalled();
    expect(mocks.mockCreateExternalLink).not.toHaveBeenCalled();
  });

  it("leaves an archived task without an issue", async () => {
    await handleTaskCreated(
      event("archived") as Parameters<typeof handleTaskCreated>[0],
      context as Parameters<typeof handleTaskCreated>[1],
    );

    expect(mocks.mockCreateIssue).not.toHaveBeenCalled();
    expect(mocks.mockCreateExternalLink).not.toHaveBeenCalled();
  });
});
