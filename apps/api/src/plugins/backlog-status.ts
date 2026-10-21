import { and, eq } from "drizzle-orm";
import db from "../database";
import { columnTable } from "../database/schema";
import { SYSTEM_BACKLOG_STATUSES } from "../task/validate-task-fields";

/**
 * Backlog sections are buckets rather than board columns. A task sitting in
 * one is not committed work, so forge integrations leave it without an issue
 * until it lands in a board column.
 */
export async function isBacklogStatus(
  projectId: string,
  status: string,
): Promise<boolean> {
  if ((SYSTEM_BACKLOG_STATUSES as readonly string[]).includes(status)) {
    return true;
  }

  const column = await db.query.columnTable.findFirst({
    columns: { kind: true },
    where: and(
      eq(columnTable.projectId, projectId),
      eq(columnTable.slug, status),
    ),
  });

  return column?.kind === "backlog";
}
