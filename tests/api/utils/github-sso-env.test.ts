import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  getGithubSocialProvider,
  getGithubSsoOAuthCredentials,
  isGithubSsoConfigured,
} from "../../../apps/api/src/utils/github-sso-env";

const keys = [
  "GITHUB_OAUTH_CLIENT_ID",
  "GITHUB_OAUTH_CLIENT_SECRET",
  "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET",
] as const;

describe("github-sso-env", () => {
  const original: Partial<Record<(typeof keys)[number], string | undefined>> =
    {};

  beforeEach(() => {
    for (const key of keys) {
      original[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of keys) {
      const value = original[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it("prefers GITHUB_OAUTH_* when both are set", () => {
    process.env.GITHUB_OAUTH_CLIENT_ID = "oauth-id";
    process.env.GITHUB_OAUTH_CLIENT_SECRET = "oauth-secret";
    process.env.GITHUB_CLIENT_ID = "legacy-id";
    process.env.GITHUB_CLIENT_SECRET = "legacy-secret";
    expect(getGithubSsoOAuthCredentials()).toEqual({
      clientId: "oauth-id",
      clientSecret: "oauth-secret",
    });
    expect(isGithubSsoConfigured()).toBe(true);
  });

  it("falls back to legacy GITHUB_CLIENT_* when OAuth vars are unset", () => {
    process.env.GITHUB_CLIENT_ID = "legacy-id";
    process.env.GITHUB_CLIENT_SECRET = "legacy-secret";
    expect(getGithubSsoOAuthCredentials()).toEqual({
      clientId: "legacy-id",
      clientSecret: "legacy-secret",
    });
    expect(isGithubSsoConfigured()).toBe(true);
  });

  it("returns empty credentials when nothing is configured", () => {
    expect(getGithubSsoOAuthCredentials()).toEqual({
      clientId: "",
      clientSecret: "",
    });
    expect(isGithubSsoConfigured()).toBe(false);
  });

  it("treats partial OAuth pair as absent and falls back to legacy", () => {
    process.env.GITHUB_OAUTH_CLIENT_ID = "only-id";
    process.env.GITHUB_CLIENT_ID = "legacy-id";
    process.env.GITHUB_CLIENT_SECRET = "legacy-secret";
    expect(getGithubSsoOAuthCredentials()).toEqual({
      clientId: "legacy-id",
      clientSecret: "legacy-secret",
    });
  });
});

describe("getGithubSocialProvider", () => {
  it("refuses to create accounts from a GitHub sign-in", () => {
    // GitHub is configured so that people can connect an existing Kaneo
    // account, not so that anyone with a GitHub account can make one. Without
    // this, enabling GitHub adds a registration path that whatever identity
    // provider an instance actually gates on never sees, and Kaneo's
    // DISABLE_REGISTRATION check only covers /sign-up/email.
    process.env.GITHUB_OAUTH_CLIENT_ID = "Iv23li-test";
    process.env.GITHUB_OAUTH_CLIENT_SECRET = "secret";

    expect(getGithubSocialProvider().disableSignUp).toBe(true);
  });

  it("carries the configured credentials and email scope", () => {
    process.env.GITHUB_OAUTH_CLIENT_ID = "Iv23li-test";
    process.env.GITHUB_OAUTH_CLIENT_SECRET = "secret";

    expect(getGithubSocialProvider()).toMatchObject({
      clientId: "Iv23li-test",
      clientSecret: "secret",
      scope: ["user:email"],
    });
  });
});
