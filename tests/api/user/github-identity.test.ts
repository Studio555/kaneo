import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";
import getGithubIdentity from "../../../apps/api/src/user/controllers/get-github-identity";
import linkGithubIdentity from "../../../apps/api/src/user/controllers/link-github-identity";
import unlinkGithubIdentity from "../../../apps/api/src/user/controllers/unlink-github-identity";

const mocks = vi.hoisted(() => {
  const mockIdentityFindFirst = vi.fn();
  const mockRequest = vi.fn();
  const mockGetGithubApp = vi.fn();
  const mockGetAnyInstallationOctokit = vi.fn();

  const inserted: Array<Record<string, unknown>> = [];
  const deletes: number[] = [];

  const mockAccountFindFirst = vi.fn();

  const mockDb = {
    query: {
      userGithubIdentityTable: { findFirst: mockIdentityFindFirst },
      accountTable: { findFirst: mockAccountFindFirst },
    },
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        inserted.push(values);
        return { onConflictDoUpdate: async () => undefined };
      },
    }),
    delete: () => ({
      where: async () => {
        deletes.push(1);
      },
    }),
  };

  return {
    mockIdentityFindFirst,
    mockAccountFindFirst,
    mockRequest,
    mockGetGithubApp,
    mockGetAnyInstallationOctokit,
    mockDb,
    inserted,
    deletes,
  };
});

vi.mock("../../../apps/api/src/database", () => ({ default: mocks.mockDb }));

vi.mock("../../../apps/api/src/plugins/github/utils/github-app", () => ({
  getGithubApp: () => mocks.mockGetGithubApp(),
  // The controllers must reach GitHub through an installation client; the
  // app-level one throws before sending anything outside /app*.
  getAnyInstallationOctokit: () => mocks.mockGetAnyInstallationOctokit(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.inserted.length = 0;
  mocks.deletes.length = 0;
  mocks.mockIdentityFindFirst.mockResolvedValue(undefined);
  mocks.mockAccountFindFirst.mockResolvedValue(undefined);
  mocks.mockGetGithubApp.mockReturnValue({ octokit: {} });
  mocks.mockGetAnyInstallationOctokit.mockResolvedValue({
    request: (...args: unknown[]) => mocks.mockRequest(...args),
  });
  mocks.mockRequest.mockResolvedValue({
    data: { id: 4242, login: "ada" },
  });
});

describe("linkGithubIdentity", () => {
  it("stores the numeric id GitHub returns for the handle", async () => {
    // Storing what GitHub resolved, rather than what was typed, is what makes
    // a typo fail at link time instead of silently at assign time.
    await expect(
      linkGithubIdentity({ userId: "user-1", login: "Ada" }),
    ).resolves.toMatchObject({ githubUserId: "4242", githubLogin: "ada" });

    expect(mocks.mockRequest).toHaveBeenCalledWith("GET /users/{username}", {
      username: "Ada",
    });
    expect(mocks.inserted[0]).toMatchObject({
      userId: "user-1",
      githubUserId: "4242",
      githubLogin: "ada",
    });
  });

  it("rejects a handle that does not exist on GitHub", async () => {
    mocks.mockRequest.mockRejectedValue(
      Object.assign(new Error("Not Found"), { status: 404 }),
    );

    await expect(
      linkGithubIdentity({ userId: "user-1", login: "nobody" }),
    ).rejects.toThrow(HTTPException);
    expect(mocks.inserted).toHaveLength(0);
  });

  it("refuses a GitHub account another Kaneo user already linked", async () => {
    // Two users on one GitHub account would make inbound assignment
    // ambiguous, so this is refused before the unique constraint fires.
    mocks.mockIdentityFindFirst.mockResolvedValue({
      id: "identity-9",
      userId: "user-2",
      githubUserId: "4242",
      githubLogin: "ada",
    });

    await expect(
      linkGithubIdentity({ userId: "user-1", login: "ada" }),
    ).rejects.toMatchObject({ status: 409 });
    expect(mocks.inserted).toHaveLength(0);
  });

  it("allows relinking the same GitHub account to the same user", async () => {
    mocks.mockIdentityFindFirst.mockResolvedValue({
      id: "identity-1",
      userId: "user-1",
      githubUserId: "4242",
      githubLogin: "ada",
    });

    await expect(
      linkGithubIdentity({ userId: "user-1", login: "ada" }),
    ).resolves.toMatchObject({ githubLogin: "ada" });
    expect(mocks.inserted).toHaveLength(1);
  });

  it("reports the GitHub App being unconfigured rather than storing blind", async () => {
    mocks.mockGetGithubApp.mockReturnValue(null);

    await expect(
      linkGithubIdentity({ userId: "user-1", login: "ada" }),
    ).rejects.toMatchObject({ status: 503 });
    expect(mocks.inserted).toHaveLength(0);
  });
});

describe("unlinkGithubIdentity", () => {
  it("removes the link", async () => {
    await expect(unlinkGithubIdentity("user-1")).resolves.toEqual({
      success: true,
    });
    expect(mocks.deletes).toHaveLength(1);
  });
});

describe("linkGithubIdentity error mapping", () => {
  it("reports a GitHub outage as an upstream failure, not a bad username", async () => {
    // Answering 404 sends the user off to fix a username that was fine.
    mocks.mockRequest.mockRejectedValue(
      Object.assign(new Error("Server Error"), { status: 500 }),
    );

    await expect(
      linkGithubIdentity({ userId: "user-1", login: "ada" }),
    ).rejects.toMatchObject({ status: 502 });
  });

  it("stores a hand-typed handle as unverified", async () => {
    // Nothing here proves the user owns the account, so the link must not
    // carry inbound authority.
    await linkGithubIdentity({ userId: "user-1", login: "ada" });

    expect(mocks.inserted[0]).toMatchObject({ verified: false });
  });

  it("refuses to claim an account another user has already proven", async () => {
    mocks.mockIdentityFindFirst.mockResolvedValue({
      id: "identity-9",
      userId: "user-2",
      githubUserId: "4242",
      githubLogin: "ada",
      verified: true,
    });

    await expect(
      linkGithubIdentity({ userId: "user-1", login: "ada" }),
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe("getGithubIdentity", () => {
  it("returns the stored link", async () => {
    mocks.mockIdentityFindFirst.mockResolvedValue({
      userId: "user-1",
      githubUserId: "4242",
      githubLogin: "ada",
      verified: true,
    });

    await expect(getGithubIdentity("user-1")).resolves.toMatchObject({
      githubLogin: "ada",
      verified: true,
    });
  });

  it("surfaces a GitHub SSO link that has never been used for a sync yet", async () => {
    // Seeding is lazy, so without this the settings page tells a user who
    // signed in with GitHub that nothing is linked.
    mocks.mockAccountFindFirst.mockResolvedValue({
      userId: "user-1",
      providerId: "github",
      accountId: "4242",
    });
    mocks.mockRequest.mockResolvedValue({ data: { id: 4242, login: "ada" } });

    await expect(getGithubIdentity("user-1")).resolves.toMatchObject({
      githubLogin: "ada",
      verified: true,
    });
  });

  it("returns null when the user has no link of any kind", async () => {
    await expect(getGithubIdentity("user-1")).resolves.toBeNull();
  });
});

describe("linkGithubIdentity without an installation", () => {
  it("refuses when the App is installed on no repository", async () => {
    // Without an installation there is no client that can read a user, so
    // there is no way to verify the handle.
    mocks.mockGetAnyInstallationOctokit.mockResolvedValue(null);

    await expect(
      linkGithubIdentity({ userId: "user-1", login: "ada" }),
    ).rejects.toMatchObject({ status: 503 });
    expect(mocks.inserted).toHaveLength(0);
  });
});
