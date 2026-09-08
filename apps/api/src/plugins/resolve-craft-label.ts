import { and, eq, sql } from "drizzle-orm";
import db from "../database";
import { craftTable, projectTable, taskTable } from "../database/schema";
import { parseCraftLabelName } from "./system-labels";

/**
 * Find a craft by name in a workspace, matched case-insensitively so
 * `craft:engineering` resolves to `Engineering`.
 *
 * Returns null when the workspace has no craft by that name. An unknown name
 * is deliberately ignored rather than auto-created: the craft vocabulary
 * stays curated in Kaneo, which is the whole reason it is separate from
 * labels.
 */
export async function resolveCraftByName(
  workspaceId: string,
  craftName: string,
): Promise<{ id: string; name: string } | null> {
  const [craft] = await db
    .select({ id: craftTable.id, name: craftTable.name })
    .from(craftTable)
    .where(
      and(
        eq(craftTable.workspaceId, workspaceId),
        sql`lower(${craftTable.name}) = lower(${craftName})`,
      ),
    )
    .limit(1);

  return craft ?? null;
}

/** The first `craft:` label in a forge issue's label set, if any. */
export function findCraftLabelName(
  labels: Array<string | { name?: string }> | undefined,
): string | null {
  if (!labels) return null;

  for (const label of labels) {
    const name = typeof label === "string" ? label : label?.name;
    if (!name) continue;
    const craftName = parseCraftLabelName(name);
    if (craftName) return craftName;
  }

  return null;
}

/** Resolve a forge label like `craft:Engineering` against a task's workspace. */
export async function resolveCraftLabel(
  taskId: string,
  labelName: string,
): Promise<{ id: string; name: string } | null> {
  const craftName = parseCraftLabelName(labelName);
  if (!craftName) return null;

  const [row] = await db
    .select({ workspaceId: projectTable.workspaceId })
    .from(taskTable)
    .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .where(eq(taskTable.id, taskId))
    .limit(1);

  if (!row?.workspaceId) return null;

  return resolveCraftByName(row.workspaceId, craftName);
}
