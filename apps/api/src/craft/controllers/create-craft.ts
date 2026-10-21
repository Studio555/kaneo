import { and, eq, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { craftTable } from "../../database/schema";

/** Craft names are unique per workspace case-insensitively, matching how
 * inbound `craft:` labels are resolved. */
function findByName(workspaceId: string, name: string) {
  return db.query.craftTable.findFirst({
    where: and(
      eq(craftTable.workspaceId, workspaceId),
      sql`lower(${craftTable.name}) = lower(${name})`,
    ),
  });
}

function isUniqueViolation(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

async function createCraft(name: string, color: string, workspaceId: string) {
  const existing = await findByName(workspaceId, name);
  if (existing) {
    return existing;
  }

  try {
    const [inserted] = await db
      .insert(craftTable)
      .values({ name, color, workspaceId })
      .returning();

    if (!inserted) {
      throw new HTTPException(500, { message: "Failed to create craft" });
    }

    return inserted;
  } catch (error) {
    // A concurrent create won the unique index; return the craft that holds
    // the name so a double-submit stays idempotent rather than 500ing.
    if (!isUniqueViolation(error)) {
      throw error;
    }

    const raced = await findByName(workspaceId, name);
    if (!raced) {
      throw error;
    }

    return raced;
  }
}

export default createCraft;
