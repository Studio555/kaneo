import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => {
  const mockFindAllIntegrations = vi.fn();
  const mockFindExternalLink = vi.fn();
  const mockTaskFindFirst = vi.fn();
  const mockReconcileCraft = vi.fn();
  const mockUpdateTaskCraft = vi.fn();
  const mockSyncLabelFields = vi.fn();

  return {
    mockSyncLabelFields,
    mockFindAllIntegrations,
    mockFindExternalLink,
    mockTaskFindFirst,
    mockReconcileCraft,
    mockUpdateTaskCraft,
    mockDb: {
      update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
      insert: () => ({
        values: () => ({ onConflictDoNothing: () => Promise.resolve() }),
      }),
      delete: () => ({ where: () => Promise.resolve() }),
      query: {
        taskTable: { findFirst: mockTaskFindFirst },
        labelTable: {
          findFirst: () => Promise.resolve(undefined),
          findMany: () => Promise.resolve([]),
        },
      },
    },
  };
});

vi.mock("../../../../../apps/api/src/database", () => ({
  default: mocks.mockDb,
}));

vi.mock("../../../../../apps/api/src/events", () => ({
  publishEvent: vi.fn(),
}));

vi.mock(
  "../../../../../apps/api/src/plugins/gitea/services/integration-lookup",
  () => ({
    findAllIntegrationsByGiteaRepo: (...args: unknown[]) =>
      mocks.mockFindAllIntegrations(...args),
    repoOwnerLogin: (repository: { owner?: { login?: string } }) =>
      repository.owner?.login ?? "",
  }),
);

vi.mock(
  "../../../../../apps/api/src/plugins/github/services/link-manager",
  () => ({
    findExternalLink: (...args: unknown[]) =>
      mocks.mockFindExternalLink(...args),
    updateExternalLink: vi.fn(),
  }),
);

vi.mock(
  "../../../../../apps/api/src/plugins/github/services/task-service",
  () => ({ updateTaskStatus: vi.fn() }),
);

// Status and priority are read back from the issue; that path has its own tests.
vi.mock(
  "../../../../../apps/api/src/plugins/sync/sync-label-fields-from-issue",
  () => ({
    labelReadDeadline: () => 0,
    syncLabelFieldsFromIssue: (...args: unknown[]) =>
      mocks.mockSyncLabelFields(...args),
  }),
);

vi.mock(
  "../../../../../apps/api/src/plugins/reconcile-craft-from-labels",
  () => ({
    reconcileCraftFromIssueLabels: (...args: unknown[]) =>
      mocks.mockReconcileCraft(...args),
  }),
);

vi.mock(
  "../../../../../apps/api/src/task/controllers/update-task-craft",
  () => ({
    default: (...args: unknown[]) => mocks.mockUpdateTaskCraft(...args),
  }),
);

import { handleGiteaIssueLabeled } from "../../../../../apps/api/src/plugins/gitea/webhooks/issue-labeled";

const LINK = {
  id: "link-1",
  taskId: "task-1",
  integrationId: "integration-1",
  metadata: '{"state":"open"}',
};

function payload(action: string, label: string | null, labels: string[]) {
  return {
    action,
    issue: {
      number: 24,
      labels: labels.map((name) => ({ name })),
    },
    ...(label ? { label: { name: label, color: "8B5CF6" } } : {}),
    repository: {
      owner: { login: "Studio555" },
      name: "s555-atlas",
      html_url: "https://gitea.example.com/Studio555/s555-atlas",
    },
  };
}

beforeEach(() => {
  mocks.mockFindAllIntegrations.mockReset();
  mocks.mockFindExternalLink.mockReset();
  mocks.mockTaskFindFirst.mockReset();
  mocks.mockReconcileCraft.mockReset();
  mocks.mockUpdateTaskCraft.mockReset();

  mocks.mockFindAllIntegrations.mockResolvedValue([{ id: "integration-1" }]);
  mocks.mockFindExternalLink.mockResolvedValue(LINK);
  mocks.mockTaskFindFirst.mockResolvedValue({
    id: "task-1",
    craftId: null,
    project: { workspaceId: "ws-1" },
  });
  mocks.mockReconcileCraft.mockResolvedValue("applied");
});

describe("handleGiteaIssueLabeled craft handling", () => {
  it("reconciles against the whole label set when a craft label is added", async () => {
    await handleGiteaIssueLabeled(
      payload("labeled", "craft:AI", ["bug", "craft:AI"]),
    );

    expect(mocks.mockReconcileCraft).toHaveBeenCalledWith({
      taskId: "task-1",
      workspaceId: "ws-1",
      labels: [{ name: "bug" }, { name: "craft:AI" }],
      delta: { label: "craft:AI", op: "added" },
      link: { id: "link-1", metadata: '{"state":"open"}' },
      source: "gitea",
    });
  });

  it("reconciles against the remaining labels when a craft label is removed", async () => {
    await handleGiteaIssueLabeled(payload("unlabeled", "craft:AI", ["bug"]));

    expect(mocks.mockReconcileCraft).toHaveBeenCalledWith(
      expect.objectContaining({
        labels: [{ name: "bug" }],
        delta: { label: "craft:AI", op: "removed" },
        source: "gitea",
      }),
    );
  });

  it("routes label_updated through the same guarded reconcile", async () => {
    // This path already derived craft from the full set, but applied it with
    // no provenance check, so it re-applied our own echoes too.
    await handleGiteaIssueLabeled(payload("label_updated", null, ["craft:AI"]));

    expect(mocks.mockReconcileCraft).toHaveBeenCalledWith(
      expect.objectContaining({ source: "gitea" }),
    );
    // A whole-set report names no single operation to claim.
    const [args] = mocks.mockReconcileCraft.mock.calls[0] as [
      Record<string, unknown>,
    ];
    expect(args.delta).toBeUndefined();
    expect(mocks.mockUpdateTaskCraft).not.toHaveBeenCalled();
  });

  it("never decides the craft from the changed label alone", async () => {
    await handleGiteaIssueLabeled(
      payload("labeled", "craft:AI", ["bug", "craft:AI"]),
    );

    expect(mocks.mockUpdateTaskCraft).not.toHaveBeenCalled();
  });

  it("leaves craft alone for a label that is not a craft label", async () => {
    await handleGiteaIssueLabeled(payload("labeled", "bug", ["bug"]));

    expect(mocks.mockReconcileCraft).not.toHaveBeenCalled();
  });

  it("does not reconcile when the issue is not linked to a task", async () => {
    mocks.mockFindExternalLink.mockResolvedValue(undefined);

    await handleGiteaIssueLabeled(payload("labeled", "craft:AI", ["craft:AI"]));

    expect(mocks.mockReconcileCraft).not.toHaveBeenCalled();
  });
});
