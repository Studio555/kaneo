import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const mockFindExternalLinksByTask = vi.fn();
  const mockUpdateExternalLink = vi.fn();
  const mockAddLabels = vi.fn();
  const mockRemoveLabel = vi.fn();

  return {
    mockFindExternalLinksByTask,
    mockUpdateExternalLink,
    mockAddLabels,
    mockRemoveLabel,
  };
});

vi.mock(
  "../../../../../apps/api/src/plugins/github/services/link-manager",
  () => ({
    findExternalLinksByTask: (...args: unknown[]) =>
      mocks.mockFindExternalLinksByTask(...args),
    updateExternalLink: (...args: unknown[]) =>
      mocks.mockUpdateExternalLink(...args),
  }),
);

vi.mock("../../../../../apps/api/src/plugins/gitea/utils/labels", () => ({
  addLabelsToIssueGitea: (...args: unknown[]) => mocks.mockAddLabels(...args),
  removeLabelGitea: (...args: unknown[]) => mocks.mockRemoveLabel(...args),
}));

import { handleTaskCraftChanged } from "../../../../../apps/api/src/plugins/gitea/events/task-craft-changed";

const CONTEXT = {
  integrationId: "integration-1",
  projectId: "project-1",
  config: {
    baseUrl: "https://gitea.example.com",
    accessToken: "token",
    repositoryOwner: "Studio555",
    repositoryName: "s555-atlas",
  },
};

function craftEvent(overrides: Record<string, unknown> = {}) {
  return {
    taskId: "task-1",
    projectId: "project-1",
    userId: null,
    oldCraftId: null,
    newCraftId: "craft-ai",
    oldCraftName: null,
    newCraftName: "AI",
    newCraftColor: "#8B5CF6",
    title: "Screen flashes when returning from a room",
    ...overrides,
  };
}

function linkWith(metadata: Record<string, unknown> | null) {
  return [
    {
      id: "link-1",
      integrationId: "integration-1",
      resourceType: "issue",
      externalId: "26",
      metadata: metadata ? JSON.stringify(metadata) : null,
    },
  ];
}

beforeEach(() => {
  mocks.mockFindExternalLinksByTask.mockReset();
  mocks.mockUpdateExternalLink.mockReset();
  mocks.mockAddLabels.mockReset();
  mocks.mockRemoveLabel.mockReset();

  mocks.mockFindExternalLinksByTask.mockResolvedValue(linkWith(null));
});

describe("gitea handleTaskCraftChanged", () => {
  it("labels the issue and records Kaneo as the craft's origin", async () => {
    // biome-ignore lint/suspicious/noExplicitAny: plugin context shape is exercised, not typed here
    await handleTaskCraftChanged(craftEvent() as any, CONTEXT as any);

    expect(mocks.mockAddLabels).toHaveBeenCalledOnce();
    expect(mocks.mockUpdateExternalLink).toHaveBeenCalledWith("link-1", {
      metadata: expect.objectContaining({
        lastSync: expect.objectContaining({
          craft: expect.objectContaining({ source: "kaneo", value: "AI" }),
        }),
      }),
    });
  });

  it("skips the label write when the craft came from Gitea in the first place", async () => {
    mocks.mockFindExternalLinksByTask.mockResolvedValue(
      linkWith({
        lastSync: {
          craft: {
            timestamp: new Date().toISOString(),
            source: "gitea",
            value: "AI",
          },
        },
      }),
    );

    // biome-ignore lint/suspicious/noExplicitAny: see above
    await handleTaskCraftChanged(craftEvent() as any, CONTEXT as any);

    expect(mocks.mockAddLabels).not.toHaveBeenCalled();
    expect(mocks.mockRemoveLabel).not.toHaveBeenCalled();
    expect(mocks.mockUpdateExternalLink).not.toHaveBeenCalled();
  });
});
