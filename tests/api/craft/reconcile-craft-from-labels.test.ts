import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const mockTaskFindFirst = vi.fn();
  const mockResolveCraftByName = vi.fn();
  const mockUpdateTaskCraft = vi.fn();
  const mockUpdateExternalLink = vi.fn();
  const calls: string[] = [];

  return {
    mockTaskFindFirst,
    mockResolveCraftByName,
    mockUpdateTaskCraft,
    mockUpdateExternalLink,
    calls,
    mockDb: {
      query: { taskTable: { findFirst: mockTaskFindFirst } },
    },
  };
});

vi.mock("../../../apps/api/src/database", () => ({ default: mocks.mockDb }));

vi.mock("../../../apps/api/src/plugins/resolve-craft-label", async () => {
  const actual = (await vi.importActual(
    "../../../apps/api/src/plugins/resolve-craft-label",
  )) as Record<string, unknown>;
  return {
    ...actual,
    resolveCraftByName: (...args: unknown[]) =>
      mocks.mockResolveCraftByName(...args),
  };
});

vi.mock("../../../apps/api/src/task/controllers/update-task-craft", () => ({
  default: (...args: unknown[]) => {
    mocks.calls.push("updateTaskCraft");
    return mocks.mockUpdateTaskCraft(...args);
  },
}));

vi.mock("../../../apps/api/src/plugins/github/services/link-manager", () => ({
  updateExternalLink: (...args: unknown[]) => {
    mocks.calls.push("updateExternalLink");
    return mocks.mockUpdateExternalLink(...args);
  },
}));

import { reconcileCraftFromIssueLabels } from "../../../apps/api/src/plugins/reconcile-craft-from-labels";

const NOW = Date.parse("2026-09-08T20:38:30.000Z");
const AI_CRAFT = { id: "craft-ai", name: "AI" };

function link(metadata: Record<string, unknown> | null) {
  return {
    id: "link-1",
    metadata: metadata ? JSON.stringify(metadata) : null,
  };
}

function pending(
  ops: Array<{ label: string; op: "added" | "removed" }>,
  agoMs = 900,
) {
  return {
    state: "open",
    pendingCraftLabelOps: ops.map((op) => ({
      ...op,
      at: new Date(NOW - agoMs).toISOString(),
    })),
  };
}

function reconcile(args: {
  labels?: Array<string | { name?: string }>;
  delta?: { label: string; op: "added" | "removed" };
  metadata?: Record<string, unknown> | null;
}) {
  return reconcileCraftFromIssueLabels({
    taskId: "task-1",
    workspaceId: "ws-1",
    labels: args.labels,
    delta: args.delta,
    link: link(args.metadata ?? null),
    source: "github",
    now: NOW,
  });
}

beforeEach(() => {
  mocks.mockTaskFindFirst.mockReset();
  mocks.mockResolveCraftByName.mockReset();
  mocks.mockUpdateTaskCraft.mockReset();
  mocks.mockUpdateExternalLink.mockReset();
  mocks.calls.length = 0;

  mocks.mockTaskFindFirst.mockResolvedValue({ id: "task-1", craftId: null });
  mocks.mockResolveCraftByName.mockResolvedValue(AI_CRAFT);
});

describe("reconcileCraftFromIssueLabels", () => {
  it("applies the craft the issue's label set carries", async () => {
    const result = await reconcile({
      labels: [{ name: "bug" }, { name: "craft:AI" }],
    });

    expect(result).toBe("applied");
    expect(mocks.mockUpdateTaskCraft).toHaveBeenCalledWith({
      id: "task-1",
      craftId: "craft-ai",
      currentUserId: null,
    });
  });

  it("clears the craft when the label set no longer carries one", async () => {
    mocks.mockTaskFindFirst.mockResolvedValue({
      id: "task-1",
      craftId: "craft-ai",
    });

    const result = await reconcile({
      labels: [{ name: "bug" }],
      delta: { label: "craft:AI", op: "removed" },
    });

    expect(result).toBe("applied");
    expect(mocks.mockUpdateTaskCraft).toHaveBeenCalledWith({
      id: "task-1",
      craftId: null,
      currentUserId: null,
    });
  });

  it("prefers the craft label just added over one still left on the issue", async () => {
    // Craft is single-select but an issue can end up carrying two `craft:`
    // labels. Reading the set alone would resolve whichever came first and
    // silently ignore what the person actually chose.
    mocks.mockTaskFindFirst.mockResolvedValue({
      id: "task-1",
      craftId: "craft-ai",
    });
    mocks.mockResolveCraftByName.mockResolvedValue({
      id: "craft-eng",
      name: "Engineering",
    });

    const result = await reconcile({
      labels: [{ name: "craft:AI" }, { name: "craft:Engineering" }],
      delta: { label: "craft:Engineering", op: "added" },
    });

    expect(mocks.mockResolveCraftByName).toHaveBeenCalledWith(
      "ws-1",
      "Engineering",
    );
    expect(result).toBe("applied");
    expect(mocks.mockUpdateTaskCraft).toHaveBeenCalledWith({
      id: "task-1",
      craftId: "craft-eng",
      currentUserId: null,
    });
  });

  it("leaves the craft alone when the label names a craft the workspace lacks", async () => {
    mocks.mockTaskFindFirst.mockResolvedValue({
      id: "task-1",
      craftId: "craft-ai",
    });
    mocks.mockResolveCraftByName.mockResolvedValue(null);

    const result = await reconcile({ labels: [{ name: "craft:Sorcery" }] });

    expect(result).toBe("unknown-craft");
    expect(mocks.mockUpdateTaskCraft).not.toHaveBeenCalled();
    expect(mocks.mockUpdateExternalLink).not.toHaveBeenCalled();
  });

  it("claims the echo of a label operation Kaneo performed", async () => {
    // The reported loop: craft was set to AI and cleared a second later, so
    // the `labeled` echo of the first write arrives while the task already
    // holds null. It is recognized by the operation Kaneo recorded, not by
    // the value, which has already moved on.
    const result = await reconcile({
      labels: [{ name: "craft:AI" }],
      delta: { label: "craft:AI", op: "added" },
      metadata: pending([
        { label: "craft:AI", op: "added" },
        { label: "craft:AI", op: "removed" },
      ]),
    });

    expect(result).toBe("echo");
    expect(mocks.mockUpdateTaskCraft).not.toHaveBeenCalled();
  });

  it("consumes the claimed operation so the same label can change again", async () => {
    await reconcile({
      labels: [{ name: "craft:AI" }],
      delta: { label: "craft:AI", op: "added" },
      metadata: pending([
        { label: "craft:AI", op: "added" },
        { label: "craft:AI", op: "removed" },
      ]),
    });

    expect(mocks.mockUpdateExternalLink).toHaveBeenCalledWith("link-1", {
      metadata: expect.objectContaining({
        pendingCraftLabelOps: [
          expect.objectContaining({ label: "craft:AI", op: "removed" }),
        ],
      }),
    });
  });

  it("applies a forge edit made while our own operations are still in flight", async () => {
    // A person swapping in a different craft moments after a Kaneo change is
    // not an echo of anything we did, however recent our write was.
    mocks.mockTaskFindFirst.mockResolvedValue({
      id: "task-1",
      craftId: "craft-eng",
    });
    mocks.mockResolveCraftByName.mockResolvedValue({
      id: "craft-design",
      name: "Design",
    });

    const result = await reconcile({
      labels: [{ name: "craft:Design" }],
      delta: { label: "craft:Design", op: "added" },
      metadata: pending([
        { label: "craft:AI", op: "removed" },
        { label: "craft:Engineering", op: "added" },
      ]),
    });

    expect(result).toBe("applied");
    expect(mocks.mockUpdateTaskCraft).toHaveBeenCalledWith({
      id: "task-1",
      craftId: "craft-design",
      currentUserId: null,
    });
  });

  it("does not claim the opposite operation on a label we touched", async () => {
    mocks.mockTaskFindFirst.mockResolvedValue({
      id: "task-1",
      craftId: "craft-ai",
    });

    const result = await reconcile({
      labels: [],
      delta: { label: "craft:AI", op: "removed" },
      metadata: pending([{ label: "craft:AI", op: "added" }]),
    });

    expect(result).toBe("applied");
    expect(mocks.mockUpdateTaskCraft).toHaveBeenCalledWith({
      id: "task-1",
      craftId: null,
      currentUserId: null,
    });
  });

  it("skips a whole-set report that only restates what Kaneo pushed", async () => {
    // The Gitea `label_updated` shape carries no single operation to claim,
    // so the value comparison is all that is available there.
    mocks.mockTaskFindFirst.mockResolvedValue({ id: "task-1", craftId: null });

    const result = await reconcile({
      labels: [{ name: "craft:AI" }],
      metadata: {
        lastSync: {
          craft: {
            timestamp: new Date(NOW - 900).toISOString(),
            source: "kaneo",
            value: "AI",
          },
        },
      },
    });

    expect(result).toBe("echo");
    expect(mocks.mockUpdateTaskCraft).not.toHaveBeenCalled();
  });

  it("records the forge as the craft's origin, keeping other sync records", async () => {
    await reconcile({
      labels: [{ name: "craft:AI" }],
      metadata: {
        state: "open",
        lastSync: { title: { timestamp: "x", source: "kaneo", value: "t" } },
      },
    });

    expect(mocks.mockUpdateExternalLink).toHaveBeenCalledWith("link-1", {
      metadata: {
        state: "open",
        lastSync: {
          title: { timestamp: "x", source: "kaneo", value: "t" },
          craft: {
            timestamp: new Date(NOW).toISOString(),
            source: "github",
            value: "AI",
          },
        },
      },
    });
  });

  it("records the origin before applying, so the outbound sync sees it", async () => {
    // updateTaskCraft publishes task.craft_changed, and the plugin handler for
    // it reads this metadata to decide whether the forge already has the
    // label. Recording after the fact would race that read and push the label
    // straight back.
    await reconcile({ labels: [{ name: "craft:AI" }] });

    expect(mocks.calls).toEqual(["updateExternalLink", "updateTaskCraft"]);
  });

  it("does nothing when the task already carries the derived craft", async () => {
    mocks.mockTaskFindFirst.mockResolvedValue({
      id: "task-1",
      craftId: "craft-ai",
    });

    const result = await reconcile({ labels: [{ name: "craft:AI" }] });

    expect(result).toBe("unchanged");
    expect(mocks.mockUpdateTaskCraft).not.toHaveBeenCalled();
    expect(mocks.mockUpdateExternalLink).not.toHaveBeenCalled();
  });

  it("does nothing when neither side has a craft", async () => {
    const result = await reconcile({ labels: [{ name: "bug" }] });

    expect(result).toBe("unchanged");
    expect(mocks.mockUpdateTaskCraft).not.toHaveBeenCalled();
  });

  it("resolves the craft name against the task's workspace", async () => {
    await reconcile({ labels: [{ name: "craft:AI" }] });

    expect(mocks.mockResolveCraftByName).toHaveBeenCalledWith("ws-1", "AI");
  });
});
