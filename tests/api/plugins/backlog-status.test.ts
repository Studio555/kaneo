import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { isBacklogStatus } from "../../../apps/api/src/plugins/backlog-status";

const mocks = vi.hoisted(() => {
  const mockColumnFindFirst = vi.fn();
  return {
    mockColumnFindFirst,
    mockDb: { query: { columnTable: { findFirst: mockColumnFindFirst } } },
  };
});

vi.mock("../../../apps/api/src/database", () => ({
  default: mocks.mockDb,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("isBacklogStatus", () => {
  it("treats the built-in sections as backlog without a lookup", async () => {
    await expect(isBacklogStatus("project-1", "planned")).resolves.toBe(true);
    await expect(isBacklogStatus("project-1", "archived")).resolves.toBe(true);
    expect(mocks.mockColumnFindFirst).not.toHaveBeenCalled();
  });

  it("treats a custom backlog section as backlog", async () => {
    mocks.mockColumnFindFirst.mockResolvedValue({ kind: "backlog" });

    await expect(isBacklogStatus("project-1", "icebox")).resolves.toBe(true);
  });

  it("does not treat a board column as backlog", async () => {
    mocks.mockColumnFindFirst.mockResolvedValue({ kind: "board" });

    await expect(isBacklogStatus("project-1", "to-do")).resolves.toBe(false);
  });

  it("does not treat an unknown status as backlog", async () => {
    mocks.mockColumnFindFirst.mockResolvedValue(undefined);

    await expect(isBacklogStatus("project-1", "gone")).resolves.toBe(false);
  });
});
