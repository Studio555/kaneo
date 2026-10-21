import { and, eq } from "drizzle-orm";
import db from "../../../database";
import {
  accountTable,
  userGithubIdentityTable,
} from "../../../database/schema";

/**
 * Resolving a numeric GitHub id to a handle needs nothing more than a public
 * user read, so callers hand in whichever client they already hold: the
 * installation Octokit inside a plugin handler, or the app-authenticated one
 * on the HTTP routes.
 */
export type UserResolvingOctokit = {
  request: (
    route: "GET /user/{account_id}",
    params: { account_id: number },
  ) => Promise<{ data: { login: string } }>;
};

const GITHUB_PROVIDER_ID = "github";

async function findGithubSsoAccount(userId: string) {
  return db.query.accountTable.findFirst({
    where: and(
      eq(accountTable.userId, userId),
      eq(accountTable.providerId, GITHUB_PROVIDER_ID),
    ),
  });
}

async function storeIdentity(params: {
  userId: string;
  githubUserId: string;
  githubLogin: string;
}) {
  await db
    .insert(userGithubIdentityTable)
    .values(params)
    .onConflictDoUpdate({
      target: userGithubIdentityTable.userId,
      set: {
        githubUserId: params.githubUserId,
        githubLogin: params.githubLogin,
        updatedAt: new Date(),
      },
    });
}

export type GithubIdentity = {
  githubUserId: string;
  githubLogin: string;
};

/**
 * The GitHub account linked to a Kaneo user, or null when there is none.
 *
 * Falls back to the Better Auth account row so anyone who signed in through
 * GitHub SSO is linked without doing anything, and caches what it resolves so
 * the lookup happens once.
 */
export async function resolveGithubIdentity(
  userId: string,
  octokit: UserResolvingOctokit,
): Promise<GithubIdentity | null> {
  const identity = await db.query.userGithubIdentityTable.findFirst({
    where: eq(userGithubIdentityTable.userId, userId),
  });

  if (identity) {
    return {
      githubUserId: identity.githubUserId,
      githubLogin: identity.githubLogin,
    };
  }

  const account = await findGithubSsoAccount(userId);
  if (!account) {
    return null;
  }

  const githubUserId = Number.parseInt(account.accountId, 10);
  if (!Number.isFinite(githubUserId)) {
    return null;
  }

  let login: string;
  try {
    const response = await octokit.request("GET /user/{account_id}", {
      account_id: githubUserId,
    });
    login = response.data.login;
  } catch (error) {
    // A deleted account or a network blip must not cache an empty handle that
    // every later assignment would trust; leaving it unstored retries later.
    console.error("Failed to resolve GitHub login for Kaneo user:", error);
    return null;
  }

  await storeIdentity({
    userId,
    githubUserId: account.accountId,
    githubLogin: login,
  });

  return { githubUserId: account.accountId, githubLogin: login };
}

/** The GitHub handle to assign for a Kaneo user, or null when we cannot name one. */
export async function getGithubLoginForUser(
  userId: string,
  octokit: UserResolvingOctokit,
): Promise<string | null> {
  const identity = await resolveGithubIdentity(userId, octokit);
  return identity?.githubLogin ?? null;
}

/**
 * The Kaneo user behind a GitHub account, or null when nobody has connected
 * it.
 *
 * This reads the Better Auth account row rather than our own cache, because
 * that row *is* the proof: GitHub only issues it to whoever completed the
 * OAuth flow, and it disappears the moment they disconnect. Reading it
 * directly means inbound assignment stops immediately on disconnect, with no
 * cache to invalidate.
 */
export async function getUserIdForGithubUser(githubUser: {
  id: number;
  login: string;
}): Promise<string | null> {
  const githubUserId = githubUser.id.toString();

  const account = await db.query.accountTable.findFirst({
    where: and(
      eq(accountTable.providerId, GITHUB_PROVIDER_ID),
      eq(accountTable.accountId, githubUserId),
    ),
  });

  if (!account) {
    return null;
  }

  // The event names the current handle, so it is a free chance to correct a
  // cache that a rename has left stale.
  await storeIdentity({
    userId: account.userId,
    githubUserId,
    githubLogin: githubUser.login,
  });

  return account.userId;
}

/**
 * Re-reads the handle for a user's stored GitHub account id and updates the
 * cache. Assignment discovers a rename only when the cached handle stops being
 * assignable, so this is the recovery path from that point.
 */
export async function refreshGithubLoginForUser(
  userId: string,
  octokit: UserResolvingOctokit,
): Promise<string | null> {
  const identity = await db.query.userGithubIdentityTable.findFirst({
    where: eq(userGithubIdentityTable.userId, userId),
  });

  if (!identity) {
    return null;
  }

  const githubUserId = Number.parseInt(identity.githubUserId, 10);
  if (!Number.isFinite(githubUserId)) {
    return null;
  }

  let login: string;
  try {
    const response = await octokit.request("GET /user/{account_id}", {
      account_id: githubUserId,
    });
    login = response.data.login;
  } catch (error) {
    console.error("Failed to refresh GitHub login for Kaneo user:", error);
    return null;
  }

  if (login === identity.githubLogin) {
    return login;
  }

  await db
    .update(userGithubIdentityTable)
    .set({ githubLogin: login, updatedAt: new Date() })
    .where(eq(userGithubIdentityTable.id, identity.id));

  return login;
}
