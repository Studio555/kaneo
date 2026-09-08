import { eq } from "drizzle-orm";
import db from "../../database";
import { userGithubIdentityTable } from "../../database/schema";
import { resolveGithubIdentity } from "../../plugins/github/services/user-link";
import { getGithubApp } from "../../plugins/github/utils/github-app";

/** The caller's GitHub link, or null when they have none. */
async function getGithubIdentity(userId: string) {
  const githubApp = getGithubApp();

  // Seeding from a GitHub SSO sign-in is lazy, so a user who has never had a
  // task synced has no row yet. Reading their settings is a fine moment to
  // seed it, otherwise the page claims nothing is linked when a proven
  // account is sitting right there. Without the App there is nothing to
  // resolve a handle with, so fall back to whatever is already stored.
  if (githubApp) {
    return resolveGithubIdentity(userId, githubApp.octokit);
  }

  const identity = await db.query.userGithubIdentityTable.findFirst({
    where: eq(userGithubIdentityTable.userId, userId),
  });

  return identity
    ? {
        githubUserId: identity.githubUserId,
        githubLogin: identity.githubLogin,
        verified: identity.verified,
      }
    : null;
}

export default getGithubIdentity;
