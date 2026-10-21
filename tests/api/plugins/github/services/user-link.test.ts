import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  getGithubLoginForUser,
  getUserIdForGithubUser,
} from "../../../../../apps/api/src/plugins/github/services/user-link";

const mocks = vi.hoisted(() => {
  const mockIdentityFindFirst = vi.fn();
  const mockAccountFindFirst = vi.fn();
  const mockRequest = vi.fn();

  const inserted: Array<Record<string, unknown>> = [];
  const updated: Array<Record<string, unknown>> = [];

  const deleted: number[] = [];

  const mockDb = {
    query: {
      userGithubIdentityTable: { findFirst: mockIdentityFindFirst },
      accountTable: { findFirst: mockAccountFindFirst },
    },
    delete: () => ({
      where: async () => {
        deleted.push(1);
      },
    }),
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        inserted.push(values);
        return {
          onConflictDoUpdate: async () => undefined,
        };
      },
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        updated.push(values);
        return { where: async () => undefined };
      },
    }),
  };

  return {
    mockIdentityFindFirst,
    mockAccountFindFirst,
    mockRequest,
    mockDb,
    inserted,
    updated,
    deleted,
  };
});

vi.mock("../../../../../apps/api/src/database", () => ({
  default: mocks.mockDb,
}));

const octokit = { request: (...args: unknown[]) => mocks.mockRequest(...args) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.inserted.length = 0;
  mocks.updated.length = 0;
  mocks.deleted.length = 0;
  mocks.mockIdentityFindFirst.mockResolvedValue(undefined);
  mocks.mockAccountFindFirst.mockResolvedValue(undefined);
});

describe("getGithubLoginForUser", () => {
  it("returns the login already stored for the user", async () => {
    mocks.mockIdentityFindFirst.mockResolvedValue({
      id: "identity-1",
      userId: "user-1",
      githubUserId: "4242",
      githubLogin: "ada",
    });

    await expect(getGithubLoginForUser("user-1", octokit)).resolves.toBe("ada");
    expect(mocks.mockRequest).not.toHaveBeenCalled();
  });

  it("seeds the identity from a GitHub SSO account and stores it", async () => {
    // Anyone who signed in with GitHub already has the numeric id in Better
    // Auth's account table, so linking needs no action from them.
    mocks.mockAccountFindFirst.mockResolvedValue({
      userId: "user-1",
      providerId: "github",
      accountId: "4242",
    });
    mocks.mockRequest.mockResolvedValue({ data: { login: "ada" } });

    await expect(getGithubLoginForUser("user-1", octokit)).resolves.toBe("ada");

    expect(mocks.mockRequest).toHaveBeenCalledWith("GET /user/{account_id}", {
      account_id: 4242,
    });
    expect(mocks.inserted[0]).toMatchObject({
      userId: "user-1",
      githubUserId: "4242",
      githubLogin: "ada",
    });
  });

  it("returns null when the user has no GitHub account at all", async () => {
    await expect(getGithubLoginForUser("user-1", octokit)).resolves.toBeNull();
    expect(mocks.inserted).toHaveLength(0);
  });

  it("stores nothing when the GitHub lookup fails", async () => {
    // A deleted GitHub account or a network blip must not cache an empty
    // handle that every later assignment would then trust.
    mocks.mockAccountFindFirst.mockResolvedValue({
      userId: "user-1",
      providerId: "github",
      accountId: "4242",
    });
    mocks.mockRequest.mockRejectedValue(new Error("404"));
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    await expect(getGithubLoginForUser("user-1", octokit)).resolves.toBeNull();

    expect(mocks.inserted).toHaveLength(0);
    expect(error).toHaveBeenCalled();
  });
});

describe("getUserIdForGithubUser", () => {
  it("resolves the Kaneo user from the Better Auth account row", async () => {
    // That row is the proof: GitHub only issues it to whoever completed the
    // OAuth flow, and it is gone the moment they disconnect.
    mocks.mockAccountFindFirst.mockResolvedValue({
      userId: "user-1",
      providerId: "github",
      accountId: "4242",
    });

    await expect(
      getUserIdForGithubUser({ id: 4242, login: "ada" }),
    ).resolves.toBe("user-1");
  });

  it("ignores a cached handle with no account row behind it", async () => {
    // A cache row that outlived its account row must not keep routing
    // assignments to somebody who has disconnected.
    mocks.mockIdentityFindFirst.mockResolvedValue({
      id: "identity-1",
      userId: "user-1",
      githubUserId: "4242",
      githubLogin: "ada",
    });

    await expect(
      getUserIdForGithubUser({ id: 4242, login: "ada" }),
    ).resolves.toBeNull();
  });

  it("refreshes the cached handle from the event that named it", async () => {
    mocks.mockAccountFindFirst.mockResolvedValue({
      userId: "user-1",
      providerId: "github",
      accountId: "4242",
    });

    await getUserIdForGithubUser({ id: 4242, login: "ada-lovelace" });

    expect(mocks.inserted[0]).toMatchObject({
      userId: "user-1",
      githubUserId: "4242",
      githubLogin: "ada-lovelace",
    });
  });

  it("returns null for a GitHub user nobody has connected", async () => {
    await expect(
      getUserIdForGithubUser({ id: 4242, login: "ada" }),
    ).resolves.toBeNull();
  });
});
