import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => {
  const mockFindAllIntegrationsByRepo = vi.fn();
  const mockFindExternalLink = vi.fn();
  const mockUpdateTaskStatus = vi.fn();
  const mockTaskFindFirst = vi.fn();
  const mockReconcileCraft = vi.fn();
  const mockUpdateTaskCraft = vi.fn();
  const mockLabelFindFirst = vi.fn();

  return {
    mockFindAllIntegrationsByRepo,
    mockFindExternalLink,
    mockUpdateTaskStatus,
    mockTaskFindFirst,
    mockReconcileCraft,
    mockUpdateTaskCraft,
    mockLabelFindFirst,
    mockDb: {
      update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
      insert: () => ({
        values: () => ({ onConflictDoNothing: () => Promise.resolve() }),
      }),
      delete: () => ({ where: () => Promise.resolve() }),
      query: {
        taskTable: { findFirst: mockTaskFindFirst },
        labelTable: {
          findFirst: mockLabelFindFirst,
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
  "../../../../../apps/api/src/plugins/github/services/task-service",
  () => ({
    findAllIntegrationsByRepo: (...args: unknown[]) =>
      mocks.mockFindAllIntegrationsByRepo(...args),
    updateTaskStatus: (...args: unknown[]) =>
      mocks.mockUpdateTaskStatus(...args),
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

// The transaction and row lock are covered by integration-task-scope tests.
vi.mock(
  "../../../../../apps/api/src/plugins/github/services/with-integration-link",
  () => ({
    withIntegrationLink: (
      link: unknown,
      _integration: unknown,
      apply: (
        database: unknown,
        afterCommit: (effect: () => Promise<void>) => void,
        lockedLink: unknown,
      ) => Promise<unknown>,
    ) => apply(mocks.mockDb, () => undefined, link),
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

import { handleIssueLabeled } from "../../../../../apps/api/src/plugins/github/webhooks/issue-labeled";

const LINK = {
  id: "link-1",
  taskId: "task-1",
  integrationId: "integration-1",
  metadata: '{"state":"open"}',
};

function payload(
  action: "labeled" | "unlabeled",
  label: string,
  labels: string[],
) {
  return {
    action,
    issue: {
      number: 24,
      labels: labels.map((name) => ({ name })),
    },
    label: { name: label, color: "8B5CF6" },
    installation: { id: 10 },
    repository: { id: 20, owner: { login: "Studio555" }, name: "s555-atlas" },
  };
}

beforeEach(() => {
  mocks.mockFindAllIntegrationsByRepo.mockReset();
  mocks.mockFindExternalLink.mockReset();
  mocks.mockUpdateTaskStatus.mockReset();
  mocks.mockTaskFindFirst.mockReset();
  mocks.mockReconcileCraft.mockReset();
  mocks.mockUpdateTaskCraft.mockReset();
  mocks.mockLabelFindFirst.mockReset();

  mocks.mockFindAllIntegrationsByRepo.mockResolvedValue([
    { id: "integration-1", projectId: "project-1", config: "{}" },
  ]);
  mocks.mockFindExternalLink.mockResolvedValue(LINK);
  mocks.mockTaskFindFirst.mockResolvedValue({
    id: "task-1",
    craftId: null,
    project: { workspaceId: "ws-1" },
  });
  mocks.mockReconcileCraft.mockResolvedValue("applied");
});

describe("handleIssueLabeled craft handling", () => {
  it("reconciles against the issue's whole label set when a craft label is added", async () => {
    await handleIssueLabeled(
      payload("labeled", "craft:AI", ["bug", "craft:AI"]),
    );

    expect(mocks.mockReconcileCraft).toHaveBeenCalledWith({
      taskId: "task-1",
      workspaceId: "ws-1",
      labels: [{ name: "bug" }, { name: "craft:AI" }],
      delta: { label: "craft:AI", op: "added" },
      link: { id: "link-1", metadata: '{"state":"open"}' },
      source: "github",
    });
  });

  it("reconciles against the remaining labels when a craft label is removed", async () => {
    await handleIssueLabeled(payload("unlabeled", "craft:AI", ["bug"]));

    expect(mocks.mockReconcileCraft).toHaveBeenCalledWith(
      expect.objectContaining({
        labels: [{ name: "bug" }],
        delta: { label: "craft:AI", op: "removed" },
      }),
    );
  });

  it("never decides the craft from the changed label alone", async () => {
    // Keying off the delta is what let a superseded echo re-apply a craft the
    // task had already moved away from.
    await handleIssueLabeled(
      payload("labeled", "craft:AI", ["bug", "craft:AI"]),
    );

    expect(mocks.mockUpdateTaskCraft).not.toHaveBeenCalled();
  });

  it("leaves craft alone for a label that is not a craft label", async () => {
    await handleIssueLabeled(payload("labeled", "bug", ["bug"]));

    expect(mocks.mockReconcileCraft).not.toHaveBeenCalled();
  });

  it("does not reconcile when the issue is not linked to a task", async () => {
    mocks.mockFindExternalLink.mockResolvedValue(undefined);

    await handleIssueLabeled(payload("labeled", "craft:AI", ["craft:AI"]));

    expect(mocks.mockReconcileCraft).not.toHaveBeenCalled();
  });

  it("does not reconcile when the task's project has no workspace", async () => {
    mocks.mockTaskFindFirst.mockResolvedValue({ id: "task-1", project: null });

    await handleIssueLabeled(payload("labeled", "craft:AI", ["craft:AI"]));

    expect(mocks.mockReconcileCraft).not.toHaveBeenCalled();
  });
});
