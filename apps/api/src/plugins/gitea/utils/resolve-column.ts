import { and, asc, eq } from "drizzle-orm";
import db from "../../../database";
import { columnTable, workflowRuleTable } from "../../../database/schema";

export async function resolveTargetStatus(
  projectId: string,
  eventType: string,
  fallbackStatus: string,
  database: Pick<typeof db, "select" | "query"> = db,
): Promise<string> {
  const projectColumns = await database
    .select({
      id: columnTable.id,
      slug: columnTable.slug,
      kind: columnTable.kind,
    })
    .from(columnTable)
    .where(eq(columnTable.projectId, projectId))
    .orderBy(asc(columnTable.position));

  if (projectColumns.length === 0) {
    return fallbackStatus;
  }

  const rule = await database.query.workflowRuleTable.findFirst({
    where: and(
      eq(workflowRuleTable.projectId, projectId),
      eq(workflowRuleTable.integrationType, "gitea"),
      eq(workflowRuleTable.eventType, eventType),
    ),
  });

  if (rule) {
    const mappedColumn = projectColumns.find(
      (column) => column.id === rule.columnId,
    );
    if (mappedColumn) {
      return mappedColumn.slug;
    }
  }

  // A workflow rule may target a backlog section, but the fallbacks only ever
  // land on the board.
  const boardColumns = projectColumns.filter(
    (column) => column.kind === "board",
  );
  const fallbackColumn = boardColumns.find(
    (column) => column.slug === fallbackStatus,
  );
  if (fallbackColumn) {
    return fallbackColumn.slug;
  }

  return boardColumns[0]?.slug ?? fallbackStatus;
}
