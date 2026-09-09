/**
 * GitHub "Sign in with GitHub" uses OAuth client credentials.
 * Prefer `GITHUB_OAUTH_*` so GitHub App integration env vars can be set
 * without implicitly enabling SSO. Legacy `GITHUB_CLIENT_*` is still supported.
 */
export function getGithubSsoOAuthCredentials(): {
  clientId: string;
  clientSecret: string;
} {
  const oauthId = process.env.GITHUB_OAUTH_CLIENT_ID?.trim();
  const oauthSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET?.trim();
  if (oauthId && oauthSecret) {
    return { clientId: oauthId, clientSecret: oauthSecret };
  }
  return {
    clientId: process.env.GITHUB_CLIENT_ID?.trim() || "",
    clientSecret: process.env.GITHUB_CLIENT_SECRET?.trim() || "",
  };
}

export function isGithubSsoConfigured(): boolean {
  const { clientId, clientSecret } = getGithubSsoOAuthCredentials();
  return Boolean(clientId && clientSecret);
}

/**
 * The Better Auth social provider config for GitHub.
 *
 * `disableSignUp` is the point of this helper. GitHub is configured so people
 * can connect a GitHub account to the Kaneo account they already have, not so
 * that anybody holding a GitHub account can create one. Allowing sign-up would
 * add a registration path that an instance's real identity provider never
 * sees, and Kaneo's DISABLE_REGISTRATION check does not cover it: that check
 * only guards `/sign-up/email`.
 *
 * Existing users can still sign in with GitHub once they have connected it.
 */
export function getGithubSocialProvider() {
  const { clientId, clientSecret } = getGithubSsoOAuthCredentials();

  return {
    clientId,
    clientSecret,
    scope: ["user:email"],
    disableSignUp: true,
  };
}
