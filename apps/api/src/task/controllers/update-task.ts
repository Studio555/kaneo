import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { columnTable, taskTable } from "../../database/schema";
import { publishEvent } from "../../events";
import { deleteOrphanedAssets } from "../../storage/cleanup-assets";
import {
  assertAssignableUser,
  getProjectWorkspaceId,
} from "../../utils/assert-assignable-user";
import { areDatesEnabled } from "../../utils/dates-enabled";
import { assertValidTaskStatus } from "../validate-task-fields";

/**
 * While dates are disabled this route never writes the date columns at all
 * (see the `.set()` below), so a caller that omits them — including a
 * third-party script doing a legitimate full PUT — keeps whatever is stored
 * instead of silently wiping it. Echoing the stored value is likewise a
 * no-op. Only a value that actually differs from what's stored is a real
 * change, and that still gets rejected rather than quietly ignored.
 *
 * The accepted consequence: while disabled, a stored date cannot be cleared
 * through this route. `PUT /task/due-date/:id` and the bulk operation still
 * clear a due date; clearing a start date needs the feature back on.
 */
function assertDateUnchanged(
  incoming: Date | undefined,
  stored: Date | null,
): void {
  if (incoming === undefined) return;
  if (stored !== null && incoming.getTime() === stored.getTime()) return;
  throw new HTTPException(422, {
    message: "Date fields are disabled on this instance",
  });
}

async function updateTask(
  id: string,
  title: string,
  status: string,
  startDate: Date | undefined,
  dueDate: Date | undefined,
  projectId: string,
  description: string,
  priority: string,
  position: number,
  userId?: string,
  currentUserId?: string,
) {
  const [existingTask] = await db
    .select({
      id: taskTable.id,
      description: taskTable.description,
      status: taskTable.status,
      projectId: taskTable.projectId,
      startDate: taskTable.startDate,
      dueDate: taskTable.dueDate,
    })
    .from(taskTable)
    .where(eq(taskTable.id, id))
    .limit(1);

  if (!existingTask) {
    throw new HTTPException(404, {
      message: "Task not found",
    });
  }

  if (projectId !== existingTask.projectId) {
    throw new HTTPException(400, {
      message: "Use the task move endpoint to move tasks between projects",
    });
  }

  const datesEnabled = areDatesEnabled();

  if (!datesEnabled) {
    assertDateUnchanged(startDate, existingTask.startDate);
    assertDateUnchanged(dueDate, existingTask.dueDate);
  }

  await assertValidTaskStatus(status, projectId);

  const normalizedUserId = userId?.trim() || undefined;

  if (normalizedUserId) {
    await assertAssignableUser(
      normalizedUserId,
      await getProjectWorkspaceId(projectId),
    );
  }

  const column = await db.query.columnTable.findFirst({
    where: and(
      eq(columnTable.projectId, projectId),
      eq(columnTable.slug, status),
    ),
  });

  const [updatedTask] = await db
    .update(taskTable)
    .set({
      title,
      status,
      columnId: column?.id ?? null,
      ...(datesEnabled
        ? { startDate: startDate || null, dueDate: dueDate || null }
        : {}),
      projectId,
      description,
      priority,
      position,
      userId: normalizedUserId ?? null,
    })
    .where(eq(taskTable.id, id))
    .returning();

  if (!updatedTask) {
    throw new HTTPException(500, {
      message: "Failed to update task",
    });
  }

  if (existingTask.status !== status) {
    await publishEvent("task.status_changed", {
      taskId: updatedTask.id,
      projectId: updatedTask.projectId,
      userId: currentUserId,
      oldStatus: existingTask.status,
      newStatus: status,
      title: updatedTask.title,
      assigneeId: updatedTask.userId,
      type: "status_changed",
    });

    await publishEvent("task-relation.refresh", {
      projectId: updatedTask.projectId,
      userId: currentUserId,
    });
  }

  await publishEvent("task.updated", {
    taskId: updatedTask.id,
    projectId: updatedTask.projectId,
    title: updatedTask.title,
    status: updatedTask.status,
    userId: currentUserId,
  });

  if (existingTask.description !== description) {
    deleteOrphanedAssets(existingTask.description, description, {
      taskId: id,
    }).catch(() => {});
  }

  return updatedTask;
}

export default updateTask;
