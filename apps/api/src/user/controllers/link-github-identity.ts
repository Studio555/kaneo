import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { userGithubIdentityTable } from "../../database/schema";
import {
  getAnyInstallationOctokit,
  getGithubApp,
} from "../../plugins/github/utils/github-app";

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { status?: unknown }).status === 404
  );
}

/**
 * Links the caller's Kaneo account to a GitHub handle so assignment can name
 * the same person on both sides.
 *
 * The handle is resolved through GitHub and the numeric id it returns is what
 * gets stored, so a typo fails here rather than silently at assign time, and a
 * later rename still resolves.
 *
 * Typing a handle asserts ownership but does not prove it, so the link is
 * stored unverified: it drives assignment out to GitHub, and never routes
 * GitHub's events back to this user. Signing in with GitHub is what proves it.
 */
async function linkGithubIdentity({
  userId,
  login,
}: {
  userId: string;
  login: string;
}) {
  const githubApp = getGithubApp();

  // Verification needs a GitHub credential, and without the App there is no
  // sync for a link to feed, so refusing beats storing something unverified.
  if (!githubApp) {
    throw new HTTPException(503, {
      message: "GitHub integration is not configured on this instance",
    });
  }

  // Not app.octokit: that client only works for /app* routes and throws
  // before sending anything else.
  const octokit = await getAnyInstallationOctokit(githubApp);
  if (!octokit) {
    throw new HTTPException(503, {
      message:
        "The GitHub App is not installed on any repository yet, so usernames cannot be verified",
    });
  }

  let githubUser: { id: number; login: string };
  try {
    const response = await octokit.request("GET /users/{username}", {
      username: login,
    });
    githubUser = { id: response.data.id, login: response.data.login };
  } catch (error) {
    if (isNotFound(error)) {
      throw new HTTPException(404, {
        message: `No GitHub user found for "${login}"`,
      });
    }

    // A rate limit, an outage or a bad app credential is not the user getting
    // the username wrong, and saying 404 sends them off to fix the wrong thing.
    console.error("Failed to look up GitHub user while linking:", error);
    throw new HTTPException(502, {
      message: "Could not reach GitHub to verify that username",
    });
  }

  const githubUserId = githubUser.id.toString();

  const existing = await db.query.userGithubIdentityTable.findFirst({
    where: eq(userGithubIdentityTable.githubUserId, githubUserId),
  });

  if (existing && existing.userId !== userId) {
    throw new HTTPException(409, {
      message: "That GitHub account is already linked to another user",
    });
  }

  await db
    .insert(userGithubIdentityTable)
    .values({
      userId,
      githubUserId,
      githubLogin: githubUser.login,
      verified: false,
    })
    .onConflictDoUpdate({
      target: userGithubIdentityTable.userId,
      set: {
        githubUserId,
        githubLogin: githubUser.login,
        verified: false,
        updatedAt: new Date(),
      },
    });

  return { githubUserId, githubLogin: githubUser.login, verified: false };
}

export default linkGithubIdentity;
