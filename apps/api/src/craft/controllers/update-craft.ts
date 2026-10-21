import { and, eq, ne, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { craftTable } from "../../database/schema";
import { publishEvent } from "../../events";
import findCraftTasks from "./find-craft-tasks";

async function updateCraft(id: string, name: string, color: string) {
  const existing = await db.query.craftTable.findFirst({
    where: eq(craftTable.id, id),
  });

  if (!existing) {
    throw new HTTPException(404, { message: "Craft not found" });
  }

  if (name !== existing.name) {
    // Case-insensitive, matching the unique index and inbound label resolution.
    const conflict = await db.query.craftTable.findFirst({
      where: and(
        eq(craftTable.workspaceId, existing.workspaceId),
        sql`lower(${craftTable.name}) = lower(${name})`,
        ne(craftTable.id, id),
      ),
    });

    if (conflict) {
      throw new HTTPException(409, {
        message: "A craft with that name already exists in this workspace",
      });
    }
  }

  const [updated] = await db
    .update(craftTable)
    .set({ name, color })
    .where(eq(craftTable.id, id))
    .returning();

  if (!updated) {
    throw new HTTPException(500, { message: "Failed to update craft" });
  }

  // A rename leaves a stale `craft:<old name>` label on every linked issue.
  // Re-labelling is best-effort and can span many repos, so it runs off an
  // event instead of holding up the response. A colour-only edit changes no
  // label name, so nothing needs re-labelling.
  if (name !== existing.name) {
    const targets = await findCraftTasks(id);
    if (targets.length > 0) {
      await publishEvent("craft.renamed", {
        craftId: id,
        workspaceId: existing.workspaceId,
        oldName: existing.name,
        newName: name,
        color,
        targets,
      });
    }
  }

  return updated;
}

export default updateCraft;
