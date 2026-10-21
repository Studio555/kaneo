import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mockSelect = vi.fn();
const mockCraftFindFirst = vi.fn();
const mockTaskFindFirst = vi.fn();
const mockUpdate = vi.fn();
const mockPublishEvent = vi.fn();

vi.mock("../../../apps/api/src/database", () => ({
  default: {
    select: (...args: unknown[]) => mockSelect(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
    query: {
      craftTable: {
        findFirst: (...args: unknown[]) => mockCraftFindFirst(...args),
      },
      taskTable: {
        findFirst: (...args: unknown[]) => mockTaskFindFirst(...args),
      },
    },
  },
}));

vi.mock("../../../apps/api/src/events", () => ({
  publishEvent: (...args: unknown[]) => mockPublishEvent(...args),
}));

import updateTaskCraft from "../../../apps/api/src/task/controllers/update-task-craft";

function mockTaskRow(row: Record<string, unknown> | undefined) {
  mockSelect.mockReturnValue({
    from: () => ({
      innerJoin: () => ({
        where: () => ({
          limit: () => Promise.resolve(row ? [row] : []),
        }),
      }),
    }),
  });
}

function mockUpdateReturning(row: Record<string, unknown>) {
  mockUpdate.mockReturnValue({
    set: () => ({
      where: () => ({
        returning: () => Promise.resolve([row]),
      }),
    }),
  });
}

const TASK = {
  id: "t1",
  title: "Rig the character",
  projectId: "p1",
  craftId: null,
  workspaceId: "w1",
};

beforeEach(() => {
  mockSelect.mockReset();
  mockCraftFindFirst.mockReset();
  mockTaskFindFirst.mockReset();
  mockUpdate.mockReset();
  mockPublishEvent.mockReset();
});

describe("updateTaskCraft", () => {
  it("404s for an unknown task", async () => {
    mockTaskRow(undefined);

    await expect(
      updateTaskCraft({ id: "nope", craftId: "c1", currentUserId: "u1" }),
    ).rejects.toThrow("Task not found");
  });

  it("rejects a craft from another workspace", async () => {
    mockTaskRow(TASK);
    // The controller scopes its lookup by workspace, so a foreign craft
    // simply is not found.
    mockCraftFindFirst.mockResolvedValue(undefined);

    await expect(
      updateTaskCraft({ id: "t1", craftId: "foreign", currentUserId: "u1" }),
    ).rejects.toThrow("Craft not found in this task's workspace");

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockPublishEvent).not.toHaveBeenCalled();
  });

  it("sets the craft and publishes the change with both names", async () => {
    mockTaskRow({ ...TASK, craftId: "old" });
    mockCraftFindFirst
      // the new craft, looked up first
      .mockResolvedValueOnce({ id: "c1", name: "Animation", color: "#00f" })
      // the outgoing craft, resolved for the event payload
      .mockResolvedValueOnce({ id: "old", name: "Art", color: "#f00" });
    mockUpdateReturning({ id: "t1", projectId: "p1", title: TASK.title });

    await updateTaskCraft({ id: "t1", craftId: "c1", currentUserId: "u1" });

    expect(mockPublishEvent).toHaveBeenCalledTimes(1);
    const [eventName, payload] = mockPublishEvent.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(eventName).toBe("task.craft_changed");
    expect(payload).toMatchObject({
      taskId: "t1",
      projectId: "p1",
      userId: "u1",
      oldCraftId: "old",
      newCraftId: "c1",
      oldCraftName: "Art",
      newCraftName: "Animation",
      newCraftColor: "#00f",
      type: "craft_changed",
    });
  });

  it("clears the craft when passed null", async () => {
    mockTaskRow({ ...TASK, craftId: "old" });
    mockCraftFindFirst.mockResolvedValue({
      id: "old",
      name: "Art",
      color: "#f00",
    });
    mockUpdateReturning({ id: "t1", projectId: "p1", title: TASK.title });

    await updateTaskCraft({ id: "t1", craftId: null, currentUserId: "u1" });

    const [, payload] = mockPublishEvent.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(payload).toMatchObject({
      oldCraftName: "Art",
      newCraftId: null,
      newCraftName: null,
    });
  });

  it("publishes nothing when the craft is unchanged, so a webhook echo cannot loop", async () => {
    mockTaskRow({ ...TASK, craftId: "c1" });
    mockCraftFindFirst.mockResolvedValue({
      id: "c1",
      name: "Animation",
      color: "#00f",
    });
    mockTaskFindFirst.mockResolvedValue({ id: "t1", craftId: "c1" });

    const result = await updateTaskCraft({
      id: "t1",
      craftId: "c1",
      currentUserId: "u1",
    });

    expect(result).toMatchObject({ id: "t1", craftId: "c1" });
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockPublishEvent).not.toHaveBeenCalled();
  });

  it("accepts a null actor for a webhook-driven change", async () => {
    mockTaskRow({ ...TASK, craftId: null });
    mockCraftFindFirst.mockResolvedValue({
      id: "c1",
      name: "Animation",
      color: "#00f",
    });
    mockUpdateReturning({ id: "t1", projectId: "p1", title: TASK.title });

    await updateTaskCraft({ id: "t1", craftId: "c1", currentUserId: null });

    const [, payload] = mockPublishEvent.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(payload.userId).toBeNull();
  });
});
