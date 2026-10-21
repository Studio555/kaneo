import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { columnTable } from "../../database/schema";
import { publishEvent } from "../../events";
import { getProjectSubtaskParentProjects } from "../../task/get-subtask-parent-projects";

async function updateColumn(
  id: string,
  data: {
    name?: string;
    icon?: string | null;
    color?: string | null;
    isFinal?: boolean;
  },
) {
  const existing = await db.query.columnTable.findFirst({
    where: eq(columnTable.id, id),
  });

  if (!existing) {
    throw new HTTPException(404, { message: "Column not found" });
  }

  // The built-in sections are named by the web app's translations, so a
  // stored rename would show in API responses but never on screen.
  if (existing.systemKey && data.name !== undefined) {
    throw new HTTPException(400, {
      message: "Built-in backlog sections cannot be renamed",
    });
  }

  if (existing.kind === "backlog" && data.isFinal) {
    throw new HTTPException(400, {
      message: "A backlog section cannot be a final column",
    });
  }

  const [updated] = await db
    .update(columnTable)
    .set({
      ...(data.name !== undefined && { name: data.name }),
      ...(data.icon !== undefined && { icon: data.icon }),
      ...(data.color !== undefined && { color: data.color }),
      ...(data.isFinal !== undefined && { isFinal: data.isFinal }),
    })
    .where(eq(columnTable.id, id))
    .returning();

  if (!updated) {
    throw new HTTPException(500, { message: "Failed to update column" });
  }

  if (existing.isFinal !== updated.isFinal) {
    const parents = await getProjectSubtaskParentProjects(
      updated.projectId,
      updated.slug,
    );
    await publishEvent("subtask-parents.refresh", {
      projects: [
        { projectId: updated.projectId },
        ...parents.filter((p) => p.projectId !== updated.projectId),
      ],
    });
  }

  await publishEvent("project.updated", { projectId: updated.projectId });

  return updated;
}

export default updateColumn;
