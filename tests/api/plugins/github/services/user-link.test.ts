import { beforeEach, describe, expect, it, vi } from "vitest";
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
  it("resolves the Kaneo user from the GitHub numeric id", async () => {
    mocks.mockIdentityFindFirst.mockResolvedValue({
      id: "identity-1",
      userId: "user-1",
      githubUserId: "4242",
      githubLogin: "ada",
      verified: true,
    });

    await expect(
      getUserIdForGithubUser({ id: 4242, login: "ada" }),
    ).resolves.toBe("user-1");
    expect(mocks.updated).toHaveLength(0);
  });

  it("refreshes the cached login when the handle was renamed", async () => {
    // The numeric id is the identity, so a rename must still resolve, and the
    // stale handle must not be left behind for outbound assignment to use.
    mocks.mockIdentityFindFirst.mockResolvedValue({
      id: "identity-1",
      userId: "user-1",
      githubUserId: "4242",
      githubLogin: "ada",
      verified: true,
    });

    await expect(
      getUserIdForGithubUser({ id: 4242, login: "ada-lovelace" }),
    ).resolves.toBe("user-1");
    expect(mocks.updated[0]).toMatchObject({ githubLogin: "ada-lovelace" });
  });

  it("seeds the identity from a GitHub SSO account", async () => {
    mocks.mockAccountFindFirst.mockResolvedValue({
      userId: "user-1",
      providerId: "github",
      accountId: "4242",
    });

    await expect(
      getUserIdForGithubUser({ id: 4242, login: "ada" }),
    ).resolves.toBe("user-1");
    expect(mocks.inserted[0]).toMatchObject({
      userId: "user-1",
      githubUserId: "4242",
      githubLogin: "ada",
    });
  });

  it("returns null for a GitHub user nobody has linked", async () => {
    await expect(
      getUserIdForGithubUser({ id: 4242, login: "ada" }),
    ).resolves.toBeNull();
  });
});

describe("inbound authority", () => {
  it("ignores an unverified claim when mapping a GitHub user to Kaneo", async () => {
    // A typed handle is only somebody asserting it is theirs. Trusting it for
    // inbound would let anyone receive the tasks of the person they named.
    mocks.mockIdentityFindFirst.mockResolvedValue({
      id: "identity-1",
      userId: "impostor",
      githubUserId: "4242",
      githubLogin: "ada",
      verified: false,
    });

    await expect(
      getUserIdForGithubUser({ id: 4242, login: "ada" }),
    ).resolves.toBeNull();
  });

  it("maps a GitHub user through an OAuth-proven link", async () => {
    mocks.mockIdentityFindFirst.mockResolvedValue({
      id: "identity-1",
      userId: "user-1",
      githubUserId: "4242",
      githubLogin: "ada",
      verified: true,
    });

    await expect(
      getUserIdForGithubUser({ id: 4242, login: "ada" }),
    ).resolves.toBe("user-1");
  });

  it("supersedes an unverified claim with the account GitHub SSO proves", async () => {
    // Otherwise a squatter's claim would permanently block the real owner,
    // because one GitHub account can only be linked once.
    mocks.mockIdentityFindFirst.mockResolvedValue({
      id: "identity-1",
      userId: "impostor",
      githubUserId: "4242",
      githubLogin: "ada",
      verified: false,
    });
    mocks.mockAccountFindFirst.mockResolvedValue({
      userId: "user-1",
      providerId: "github",
      accountId: "4242",
    });

    await expect(
      getUserIdForGithubUser({ id: 4242, login: "ada" }),
    ).resolves.toBe("user-1");
    expect(mocks.inserted[0]).toMatchObject({
      userId: "user-1",
      githubUserId: "4242",
      verified: true,
    });
  });

  it("marks an SSO-seeded identity as verified", async () => {
    mocks.mockAccountFindFirst.mockResolvedValue({
      userId: "user-1",
      providerId: "github",
      accountId: "4242",
    });
    mocks.mockRequest.mockResolvedValue({ data: { login: "ada" } });

    await getGithubLoginForUser("user-1", octokit);

    expect(mocks.inserted[0]).toMatchObject({ verified: true });
  });
});
