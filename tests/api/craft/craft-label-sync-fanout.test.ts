import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFindMany = vi.fn();

vi.mock("../../../apps/api/src/database", () => ({
  default: {
    query: {
      integrationTable: {
        findMany: (...args: unknown[]) => mockFindMany(...args),
      },
    },
  },
}));

vi.mock("../../../apps/api/src/events", () => ({
  subscribeToEvent: vi.fn(),
}));

import {
  broadcastCraftLabelSync,
  registerPlugin,
} from "../../../apps/api/src/plugins/registry";
import type { CraftLabelSyncEvent } from "../../../apps/api/src/plugins/types";

const calls: Array<{
  type: string;
  event: CraftLabelSyncEvent;
  projectId: string;
}> = [];

function integration(id: string, projectId: string, type: string) {
  return { id, projectId, type, isActive: true, config: "{}" };
}

beforeEach(() => {
  calls.length = 0;
  mockFindMany.mockReset();
});

// registerPlugin throws on a duplicate type, so the fake plugins are
// registered once for the whole file.
registerPlugin({
  type: "fake-forge",
  name: "Fake Forge",
  onCraftLabelSync: async (event, context) => {
    calls.push({ type: "fake-forge", event, projectId: context.projectId });
  },
});

registerPlugin({
  type: "forge-without-handler",
  name: "Forge Without Handler",
});

describe("broadcastCraftLabelSync", () => {
  it("groups targets by project and hands each plugin only its own project's tasks", async () => {
    mockFindMany.mockImplementation(({ where }: { where: unknown }) => {
      // The registry filters by projectId; the mock keys off call order
      // instead, returning one integration per project it is asked about.
      void where;
      const projectId = mockFindMany.mock.calls.length === 1 ? "p1" : "p2";
      return Promise.resolve([
        integration(`i-${projectId}`, projectId, "fake-forge"),
      ]);
    });

    await broadcastCraftLabelSync({
      craftId: "c1",
      workspaceId: "w1",
      oldName: "Art",
      newName: "Art Direction",
      color: "#ff0000",
      targets: [
        { taskId: "t1", projectId: "p1" },
        { taskId: "t2", projectId: "p2" },
        { taskId: "t3", projectId: "p1" },
      ],
    });

    expect(calls).toHaveLength(2);

    const p1 = calls.find((call) => call.projectId === "p1");
    const p2 = calls.find((call) => call.projectId === "p2");

    expect(p1?.event.taskIds).toEqual(["t1", "t3"]);
    expect(p2?.event.taskIds).toEqual(["t2"]);
    expect(p1?.event.oldName).toBe("Art");
    expect(p1?.event.newName).toBe("Art Direction");
    expect(p1?.event.color).toBe("#ff0000");
  });

  it("carries a null newName through for a delete", async () => {
    mockFindMany.mockResolvedValue([integration("i-p1", "p1", "fake-forge")]);

    await broadcastCraftLabelSync({
      craftId: "c1",
      workspaceId: "w1",
      oldName: "Audio",
      newName: null,
      color: null,
      targets: [{ taskId: "t1", projectId: "p1" }],
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.event.newName).toBeNull();
  });

  it("skips a plugin that does not implement the handler", async () => {
    mockFindMany.mockResolvedValue([
      integration("i-p1", "p1", "forge-without-handler"),
    ]);

    await broadcastCraftLabelSync({
      craftId: "c1",
      workspaceId: "w1",
      oldName: "QA",
      newName: "Quality",
      color: null,
      targets: [{ taskId: "t1", projectId: "p1" }],
    });

    expect(calls).toHaveLength(0);
  });

  it("does not query integrations when there are no targets", async () => {
    await broadcastCraftLabelSync({
      craftId: "c1",
      workspaceId: "w1",
      oldName: "QA",
      newName: "Quality",
      color: null,
      targets: [],
    });

    expect(mockFindMany).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });
});
