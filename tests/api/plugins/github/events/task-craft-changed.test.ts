import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const mockGetInstallationOctokit = vi.fn();
  const mockFindExternalLinksByTask = vi.fn();
  const mockUpdateExternalLink = vi.fn();
  const mockAddLabelsToIssue = vi.fn();
  const mockRemoveLabel = vi.fn();
  const calls: string[] = [];

  return {
    mockGetInstallationOctokit,
    mockFindExternalLinksByTask,
    mockUpdateExternalLink,
    mockAddLabelsToIssue,
    mockRemoveLabel,
    calls,
    mockGithubApp: { getInstallationOctokit: mockGetInstallationOctokit },
  };
});

vi.mock("../../../../../apps/api/src/plugins/github/utils/github-app", () => ({
  getGithubApp: () => mocks.mockGithubApp,
  getInstallationIdForRepo: async () => 123,
}));

vi.mock(
  "../../../../../apps/api/src/plugins/github/services/link-manager",
  () => ({
    findExternalLinksByTask: (...args: unknown[]) =>
      mocks.mockFindExternalLinksByTask(...args),
    updateExternalLink: (...args: unknown[]) => {
      mocks.calls.push("updateExternalLink");
      return mocks.mockUpdateExternalLink(...args);
    },
  }),
);

vi.mock("../../../../../apps/api/src/plugins/github/utils/labels", () => ({
  addLabelsToIssue: (...args: unknown[]) => {
    mocks.calls.push("addLabelsToIssue");
    return mocks.mockAddLabelsToIssue(...args);
  },
  removeLabel: (...args: unknown[]) => {
    mocks.calls.push("removeLabel");
    return mocks.mockRemoveLabel(...args);
  },
}));

import { handleTaskCraftChanged } from "../../../../../apps/api/src/plugins/github/events/task-craft-changed";

const CONTEXT = {
  integrationId: "integration-1",
  projectId: "project-1",
  config: {
    repositoryOwner: "Studio555",
    repositoryName: "s555-atlas",
    installationId: 123,
  },
};

function craftEvent(
  overrides: Partial<{
    oldCraftName: string | null;
    newCraftName: string | null;
    newCraftColor: string | null;
  }> = {},
) {
  return {
    taskId: "task-1",
    projectId: "project-1",
    userId: null,
    oldCraftId: null,
    newCraftId: "craft-ai",
    oldCraftName: null,
    newCraftName: "AI",
    newCraftColor: "#8B5CF6",
    title: "Going back from a profile doesn't return to the likes list",
    ...overrides,
  };
}

function linkWith(metadata: Record<string, unknown> | null) {
  return [
    {
      id: "link-1",
      integrationId: "integration-1",
      resourceType: "issue",
      externalId: "24",
      metadata: metadata ? JSON.stringify(metadata) : null,
    },
  ];
}

function forgeWrote(value: string | null) {
  return {
    state: "open",
    lastSync: {
      craft: {
        timestamp: new Date().toISOString(),
        source: "github",
        value,
      },
    },
  };
}

beforeEach(() => {
  mocks.mockGetInstallationOctokit.mockReset();
  mocks.mockFindExternalLinksByTask.mockReset();
  mocks.mockUpdateExternalLink.mockReset();
  mocks.mockAddLabelsToIssue.mockReset();
  mocks.mockRemoveLabel.mockReset();
  mocks.calls.length = 0;

  mocks.mockGetInstallationOctokit.mockResolvedValue({});
  mocks.mockFindExternalLinksByTask.mockResolvedValue(linkWith(null));
});

describe("handleTaskCraftChanged", () => {
  it("labels the issue and records Kaneo as the craft's origin", async () => {
    // biome-ignore lint/suspicious/noExplicitAny: plugin context shape is exercised, not typed here
    await handleTaskCraftChanged(craftEvent() as any, CONTEXT as any);

    expect(mocks.mockAddLabelsToIssue).toHaveBeenCalledWith(
      expect.anything(),
      "Studio555",
      "s555-atlas",
      24,
      ["craft:AI"],
      { "craft:AI": "#8B5CF6" },
    );
    expect(mocks.mockUpdateExternalLink).toHaveBeenCalledWith("link-1", {
      metadata: expect.objectContaining({
        lastSync: expect.objectContaining({
          craft: expect.objectContaining({ source: "kaneo", value: "AI" }),
        }),
      }),
    });
  });

  it("records a cleared craft so its echo can be recognized too", async () => {
    await handleTaskCraftChanged(
      // biome-ignore lint/suspicious/noExplicitAny: see above
      craftEvent({ oldCraftName: "AI", newCraftName: null }) as any,
      // biome-ignore lint/suspicious/noExplicitAny: see above
      CONTEXT as any,
    );

    expect(mocks.mockRemoveLabel).toHaveBeenCalledWith(
      expect.anything(),
      "Studio555",
      "s555-atlas",
      24,
      "craft:AI",
    );
    expect(mocks.mockUpdateExternalLink).toHaveBeenCalledWith("link-1", {
      metadata: expect.objectContaining({
        lastSync: expect.objectContaining({
          craft: expect.objectContaining({ source: "kaneo", value: null }),
        }),
      }),
    });
  });

  it("skips the label write when the craft came from GitHub in the first place", async () => {
    mocks.mockFindExternalLinksByTask.mockResolvedValue(
      linkWith(forgeWrote("AI")),
    );

    // biome-ignore lint/suspicious/noExplicitAny: see above
    await handleTaskCraftChanged(craftEvent() as any, CONTEXT as any);

    expect(mocks.mockAddLabelsToIssue).not.toHaveBeenCalled();
    expect(mocks.mockRemoveLabel).not.toHaveBeenCalled();
    expect(mocks.mockUpdateExternalLink).not.toHaveBeenCalled();
  });

  it("still pushes a craft GitHub does not have", async () => {
    mocks.mockFindExternalLinksByTask.mockResolvedValue(
      linkWith(forgeWrote("Engineering")),
    );

    // biome-ignore lint/suspicious/noExplicitAny: see above
    await handleTaskCraftChanged(craftEvent() as any, CONTEXT as any);

    expect(mocks.mockAddLabelsToIssue).toHaveBeenCalledOnce();
  });

  it("records the operations it is about to perform before performing them", async () => {
    // Removing the old label makes GitHub deliver `unlabeled` at once, and
    // that webhook can be handled while the add is still in flight. Unless
    // the ledger is already written, it reads the issue as having no craft
    // and clears the task.
    await handleTaskCraftChanged(
      // biome-ignore lint/suspicious/noExplicitAny: see above
      craftEvent({ oldCraftName: "AI", newCraftName: "Engineering" }) as any,
      // biome-ignore lint/suspicious/noExplicitAny: see above
      CONTEXT as any,
    );

    expect(mocks.calls[0]).toBe("updateExternalLink");
    expect(mocks.calls).toEqual([
      "updateExternalLink",
      "removeLabel",
      "addLabelsToIssue",
    ]);

    const [, params] = mocks.mockUpdateExternalLink.mock.calls[0] as [
      string,
      { metadata: { pendingCraftLabelOps?: unknown } },
    ];
    expect(params.metadata.pendingCraftLabelOps).toEqual([
      expect.objectContaining({ label: "craft:AI", op: "removed" }),
      expect.objectContaining({ label: "craft:Engineering", op: "added" }),
    ]);
  });

  it("records nothing extra when there is no label to change", async () => {
    await handleTaskCraftChanged(
      // biome-ignore lint/suspicious/noExplicitAny: see above
      craftEvent({ oldCraftName: null, newCraftName: null }) as any,
      // biome-ignore lint/suspicious/noExplicitAny: see above
      CONTEXT as any,
    );

    expect(mocks.mockAddLabelsToIssue).not.toHaveBeenCalled();
    expect(mocks.mockRemoveLabel).not.toHaveBeenCalled();
  });

  it("does nothing when the task has no linked issue", async () => {
    mocks.mockFindExternalLinksByTask.mockResolvedValue([]);

    // biome-ignore lint/suspicious/noExplicitAny: see above
    await handleTaskCraftChanged(craftEvent() as any, CONTEXT as any);

    expect(mocks.mockAddLabelsToIssue).not.toHaveBeenCalled();
    expect(mocks.mockUpdateExternalLink).not.toHaveBeenCalled();
  });
});
