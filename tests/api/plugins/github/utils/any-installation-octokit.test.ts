import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAnyInstallationOctokit } from "../../../../../apps/api/src/plugins/github/utils/github-app";

const mocks = vi.hoisted(() => {
  const mockListInstallations = vi.fn();
  const mockGetInstallationOctokit = vi.fn();
  const mockGetGithubApp = vi.fn();

  return {
    mockListInstallations,
    mockGetInstallationOctokit,
    mockGetGithubApp,
    installationOctokit: { request: vi.fn() },
  };
});

vi.mock("octokit", () => ({ App: class {} }));

vi.mock("@sentry/node", () => ({ addBreadcrumb: () => undefined }));

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GITHUB_APP_ID = "123";
  process.env.GITHUB_WEBHOOK_SECRET = "secret";
  process.env.GITHUB_PRIVATE_KEY = "key";
  mocks.mockListInstallations.mockResolvedValue({
    data: [{ id: 555 }, { id: 999 }],
  });
  mocks.mockGetInstallationOctokit.mockResolvedValue(mocks.installationOctokit);
  mocks.mockGetGithubApp.mockReturnValue({
    octokit: {
      rest: { apps: { listInstallations: mocks.mockListInstallations } },
    },
    getInstallationOctokit: mocks.mockGetInstallationOctokit,
  });
});

vi.mock(
  "../../../../../apps/api/src/plugins/github/utils/resolve-private-key",
  () => ({}),
);

describe("getAnyInstallationOctokit", () => {
  it("returns a client authenticated as an installation", async () => {
    // The app-level client cannot call anything outside /app*: @octokit/auth-app
    // picks installation auth for every other route and throws without an
    // installation id, so a public user lookup needs a real installation.
    const octokit = await getAnyInstallationOctokit(
      mocks.mockGetGithubApp() as never,
    );

    expect(mocks.mockGetInstallationOctokit).toHaveBeenCalledWith(555);
    expect(octokit).toBe(mocks.installationOctokit);
  });

  it("returns null when the app is not installed anywhere", async () => {
    mocks.mockListInstallations.mockResolvedValue({ data: [] });

    await expect(
      getAnyInstallationOctokit(mocks.mockGetGithubApp() as never),
    ).resolves.toBeNull();
  });

  it("returns null when the installation lookup fails", async () => {
    mocks.mockListInstallations.mockRejectedValue(new Error("boom"));
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    await expect(
      getAnyInstallationOctokit(mocks.mockGetGithubApp() as never),
    ).resolves.toBeNull();
    expect(error).toHaveBeenCalled();
  });
});
