import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { craftTable } from "../../database/schema";
import { publishEvent } from "../../events";
import findCraftTasks from "./find-craft-tasks";

async function deleteCraft(id: string) {
  const { deleted, targets } = await db.transaction(async (tx) => {
    const existing = await tx.query.craftTable.findFirst({
      where: eq(craftTable.id, id),
    });

    if (!existing) {
      throw new HTTPException(404, { message: "Craft not found" });
    }

    // Must be read before the delete: `task.craft_id` is ON DELETE SET NULL,
    // so afterwards nothing identifies the tasks that carried this craft.
    const syncTargets = await findCraftTasks(id, tx);

    await tx.delete(craftTable).where(eq(craftTable.id, id));

    return { deleted: existing, targets: syncTargets };
  });

  if (targets.length > 0) {
    await publishEvent("craft.deleted", {
      craftId: id,
      workspaceId: deleted.workspaceId,
      name: deleted.name,
      targets,
    });
  }

  return deleted;
}

export default deleteCraft;
