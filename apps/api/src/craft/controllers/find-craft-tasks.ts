import { eq } from "drizzle-orm";
import type db from "../../database";
import dbDefault from "../../database";
import { taskTable } from "../../database/schema";

export type CraftTaskTarget = { taskId: string; projectId: string };

/**
 * Every task carrying `craftId`, with its project.
 *
 * Serves both consumers of a craft rename or delete: the forge handlers, which
 * re-label whichever of these tasks have a linked issue, and the WebSocket
 * fan-out, which invalidates the boards of every project involved. It
 * deliberately does not filter to tasks with issue links — that would hide
 * projects with no integration from the realtime path.
 *
 * Takes an executor so a delete can capture its targets inside the same
 * transaction that removes the craft — once the row is gone, `onDelete: set
 * null` has already erased every `craftId` that would identify them.
 */
function findCraftTasks(
  craftId: string,
  executor: Pick<typeof db, "select"> = dbDefault,
): Promise<CraftTaskTarget[]> {
  return executor
    .select({ taskId: taskTable.id, projectId: taskTable.projectId })
    .from(taskTable)
    .where(eq(taskTable.craftId, craftId));
}

export default findCraftTasks;
