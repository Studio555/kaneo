import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { resolveTargetStatus } from "../../../../../apps/api/src/plugins/github/utils/resolve-column";

const mocks = vi.hoisted(() => {
  const mockOrderBy = vi.fn();
  const mockWorkflowRuleFindFirst = vi.fn();

  const mockDb = {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: (...args: unknown[]) => mockOrderBy(...args),
        }),
      }),
    }),
    query: {
      workflowRuleTable: { findFirst: mockWorkflowRuleFindFirst },
    },
  };

  return { mockOrderBy, mockWorkflowRuleFindFirst, mockDb };
});

vi.mock("../../../../../apps/api/src/database", () => ({
  default: mocks.mockDb,
}));

const columns = [
  { id: "col-todo", slug: "to-do", kind: "board" },
  { id: "col-progress", slug: "in-progress", kind: "board" },
  { id: "col-triage", slug: "triage", kind: "board" },
  { id: "col-done", slug: "done", kind: "board" },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.mockOrderBy.mockResolvedValue(columns);
  mocks.mockWorkflowRuleFindFirst.mockResolvedValue(undefined);
});

describe("resolveTargetStatus", () => {
  it("honours a configured rule for issue_reopened", async () => {
    // The workflow editor writes these rules, so a project can send reopened
    // issues somewhere other than the hard-coded to-do fallback.
    mocks.mockWorkflowRuleFindFirst.mockResolvedValue({
      id: "rule-1",
      projectId: "project-1",
      integrationType: "github",
      eventType: "issue_reopened",
      columnId: "col-triage",
    });

    await expect(
      resolveTargetStatus("project-1", "issue_reopened", "to-do"),
    ).resolves.toBe("triage");
  });

  it("falls back to to-do for issue_reopened when no rule is configured", async () => {
    await expect(
      resolveTargetStatus("project-1", "issue_reopened", "to-do"),
    ).resolves.toBe("to-do");
  });

  it("ignores a rule pointing at a column the project no longer has", async () => {
    mocks.mockWorkflowRuleFindFirst.mockResolvedValue({
      id: "rule-1",
      projectId: "project-1",
      integrationType: "github",
      eventType: "issue_reopened",
      columnId: "col-deleted",
    });

    await expect(
      resolveTargetStatus("project-1", "issue_reopened", "to-do"),
    ).resolves.toBe("to-do");
  });

  it("uses the first column when the fallback slug does not exist either", async () => {
    mocks.mockOrderBy.mockResolvedValue([
      { id: "col-backlog", slug: "backlog", kind: "board" },
      { id: "col-shipped", slug: "shipped", kind: "board" },
    ]);

    await expect(
      resolveTargetStatus("project-1", "issue_reopened", "to-do"),
    ).resolves.toBe("backlog");
  });

  it("never falls back to a backlog section, even one ordered first", async () => {
    mocks.mockOrderBy.mockResolvedValue([
      { id: "col-planned", slug: "planned", kind: "backlog" },
      { id: "col-shipped", slug: "shipped", kind: "board" },
    ]);

    await expect(
      resolveTargetStatus("project-1", "issue_reopened", "to-do"),
    ).resolves.toBe("shipped");
  });

  it("honours a rule that targets a backlog section", async () => {
    mocks.mockOrderBy.mockResolvedValue([
      ...columns,
      { id: "col-icebox", slug: "icebox", kind: "backlog" },
    ]);
    mocks.mockWorkflowRuleFindFirst.mockResolvedValue({
      id: "rule-1",
      projectId: "project-1",
      integrationType: "github",
      eventType: "issue_opened",
      columnId: "col-icebox",
    });

    await expect(
      resolveTargetStatus("project-1", "issue_opened", "to-do"),
    ).resolves.toBe("icebox");
  });
});
