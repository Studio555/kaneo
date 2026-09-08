import { asc, eq } from "drizzle-orm";
import db from "../../database";
import { craftTable } from "../../database/schema";

function getCraftsByWorkspaceId(workspaceId: string) {
  return db
    .select()
    .from(craftTable)
    .where(eq(craftTable.workspaceId, workspaceId))
    .orderBy(asc(craftTable.name));
}

export default getCraftsByWorkspaceId;
