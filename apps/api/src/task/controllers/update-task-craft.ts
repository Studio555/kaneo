import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { craftTable, projectTable, taskTable } from "../../database/schema";
import { publishEvent } from "../../events";

async function updateTaskCraft({
  id,
  craftId,
  currentUserId,
}: {
  id: string;
  craftId: string | null;
  // Null when a forge webhook drove the change rather than a person in Kaneo,
  // matching how the inbound status path publishes its event.
  currentUserId: string | null;
}) {
  const [existingTask] = await db
    .select({
      id: taskTable.id,
      title: taskTable.title,
      projectId: taskTable.projectId,
      craftId: taskTable.craftId,
      workspaceId: projectTable.workspaceId,
    })
    .from(taskTable)
    .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .where(eq(taskTable.id, id))
    .limit(1);

  if (!existingTask) {
    throw new HTTPException(404, { message: "Task not found" });
  }

  let newCraft: { id: string; name: string; color: string } | null = null;

  if (craftId) {
    // The foreign key cannot express "craft and task share a workspace", so
    // the check lives here, as it does for label assignment.
    const craft = await db.query.craftTable.findFirst({
      where: and(
        eq(craftTable.id, craftId),
        eq(craftTable.workspaceId, existingTask.workspaceId),
      ),
    });

    if (!craft) {
      throw new HTTPException(400, {
        message: "Craft not found in this task's workspace",
      });
    }

    newCraft = { id: craft.id, name: craft.name, color: craft.color };
  }

  // Nothing moved. Returning early keeps a webhook echo of our own outbound
  // label write from publishing an event and looping back out to the forge.
  if (existingTask.craftId === (craftId ?? null)) {
    const task = await db.query.taskTable.findFirst({
      where: eq(taskTable.id, id),
    });

    if (!task) {
      throw new HTTPException(404, { message: "Task not found" });
    }

    return task;
  }

  const oldCraft = existingTask.craftId
    ? ((await db.query.craftTable.findFirst({
        where: eq(craftTable.id, existingTask.craftId),
      })) ?? null)
    : null;

  const [updatedTask] = await db
    .update(taskTable)
    .set({ craftId: craftId ?? null })
    .where(eq(taskTable.id, id))
    .returning();

  if (!updatedTask) {
    throw new HTTPException(500, { message: "Failed to update task craft" });
  }

  // Names travel with the event: the forge handler re-labels an issue by name,
  // and by the time it runs the craft row may already be gone.
  await publishEvent("task.craft_changed", {
    taskId: updatedTask.id,
    projectId: updatedTask.projectId,
    userId: currentUserId,
    oldCraftId: existingTask.craftId,
    newCraftId: craftId ?? null,
    oldCraftName: oldCraft?.name ?? null,
    newCraftName: newCraft?.name ?? null,
    newCraftColor: newCraft?.color ?? null,
    title: updatedTask.title,
    type: "craft_changed",
  });

  return updatedTask;
}

export default updateTaskCraft;
