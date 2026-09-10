import { beforeEach, describe, expect, it, vi } from "vitest";
import { findPullRequestLinks } from "../../../../../apps/api/src/plugins/github/services/link-manager";

const mocks = vi.hoisted(() => {
  const mockFindMany = vi.fn();
  return {
    mockFindMany,
    mockDb: { query: { externalLinkTable: { findMany: mockFindMany } } },
  };
});

vi.mock("../../../../../apps/api/src/database", () => ({
  default: mocks.mockDb,
}));

const INTEGRATION_REPO = "Studio555/s555-atlas";

function link(id: string, metadata: Record<string, unknown> | null) {
  return {
    id,
    taskId: `task-${id}`,
    integrationId: "integration-1",
    resourceType: "pull_request",
    externalId: "7",
    metadata: metadata ? JSON.stringify(metadata) : null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("findPullRequestLinks", () => {
  it("returns only the links whose metadata names the requested repository", async () => {
    mocks.mockFindMany.mockResolvedValue([
      link("atlas", { state: "open", repository: "Studio555/s555-atlas" }),
      link("server", {
        state: "open",
        repository: "Studio555/showrooms-server",
      }),
    ]);

    const result = await findPullRequestLinks(
      "integration-1",
      7,
      "Studio555/showrooms-server",
      INTEGRATION_REPO,
    );

    expect(result.map((row) => row.id)).toEqual(["server"]);
  });

  it("compares repositories case-insensitively", async () => {
    mocks.mockFindMany.mockResolvedValue([
      link("server", { repository: "studio555/Showrooms-Server" }),
    ]);

    const result = await findPullRequestLinks(
      "integration-1",
      7,
      "Studio555/showrooms-server",
      INTEGRATION_REPO,
    );

    expect(result.map((row) => row.id)).toEqual(["server"]);
  });

  it("treats a link without a repository as one from the integration's own repository", async () => {
    // Rows written before cross-repo linking never stored the repository; they
    // could only have come from the configured repo.
    mocks.mockFindMany.mockResolvedValue([link("legacy", { state: "open" })]);

    expect(
      await findPullRequestLinks(
        "integration-1",
        7,
        INTEGRATION_REPO,
        INTEGRATION_REPO,
      ),
    ).toHaveLength(1);
    expect(
      await findPullRequestLinks(
        "integration-1",
        7,
        "Studio555/showrooms-server",
        INTEGRATION_REPO,
      ),
    ).toHaveLength(0);
  });

  it("returns every link for the same pull request across tasks", async () => {
    mocks.mockFindMany.mockResolvedValue([
      link("a", { repository: "Studio555/showrooms-server" }),
      link("b", { repository: "Studio555/showrooms-server" }),
    ]);

    const result = await findPullRequestLinks(
      "integration-1",
      7,
      "Studio555/showrooms-server",
      INTEGRATION_REPO,
    );

    expect(result.map((row) => row.id)).toEqual(["a", "b"]);
  });
});
