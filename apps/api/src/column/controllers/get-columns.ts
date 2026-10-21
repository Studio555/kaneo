import { and, asc, eq } from "drizzle-orm";
import db from "../../database";
import { type ColumnKind, columnTable } from "../../database/schema";

async function getColumns(projectId: string, kind: ColumnKind = "board") {
  const columns = await db
    .select()
    .from(columnTable)
    .where(
      and(eq(columnTable.projectId, projectId), eq(columnTable.kind, kind)),
    )
    .orderBy(asc(columnTable.position));

  return columns;
}

export default getColumns;
