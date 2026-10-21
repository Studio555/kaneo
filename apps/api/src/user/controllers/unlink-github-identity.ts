import { eq } from "drizzle-orm";
import db from "../../database";
import { userGithubIdentityTable } from "../../database/schema";

/** Removes the caller's GitHub link. Succeeds when there was nothing to remove. */
async function unlinkGithubIdentity(userId: string) {
  await db
    .delete(userGithubIdentityTable)
    .where(eq(userGithubIdentityTable.userId, userId));

  return { success: true as const };
}

export default unlinkGithubIdentity;
