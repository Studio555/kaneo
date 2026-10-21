import { availableSlug } from "../available-slug";
import { toSlug } from "../to-slug";
import { publishEvent } from "../../events";
import { eq, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { type ColumnKind, columnTable } from "../../database/schema";
import { SYSTEM_BACKLOG_STATUSES } from "../../task/validate-task-fields";

async function createColumn({
  projectId,
  name,
  icon,
  color,
  isFinal,
  kind = "board",
}: {
  projectId: string;
  name: string;
  icon?: string;
  color?: string;
  isFinal?: boolean;
  kind?: ColumnKind;
}) {
  const slug = toSlug(name);

  if (!slug) {
    throw new HTTPException(400, {
      message: "Column name must contain at least one alphanumeric character",
    });
  }

  if ((SYSTEM_BACKLOG_STATUSES as readonly string[]).includes(slug)) {
    throw new HTTPException(409, {
      message: `Column slug "${slug}" is reserved for a built-in backlog section`,
    });
  }

  // A backlog section is never done work: a final one would stop reminders
  // and close linked issues for tasks that were merely parked there.
  if (kind === "backlog" && isFinal) {
    throw new HTTPException(400, {
      message: "A backlog section cannot be a final column",
    });
  }

  const created = await db.transaction(async (tx) => {
    // Serialize creates per project so concurrent requests cannot pick the
    // same slug or position.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(1525, hashtext(${projectId}))`,
    );

    const columns = await tx
      .select({
        slug: columnTable.slug,
        position: columnTable.position,
        kind: columnTable.kind,
      })
      .from(columnTable)
      .where(eq(columnTable.projectId, projectId));

    // Positions are ordered within a kind, so board and backlog count apart.
    const sameKind = columns.filter((c) => c.kind === kind);

    const [row] = await tx
      .insert(columnTable)
      .values({
        projectId,
        name,
        slug: availableSlug(slug, new Set(columns.map((c) => c.slug))),
        position: Math.max(-1, ...sameKind.map((c) => c.position)) + 1,
        icon: icon || null,
        color: color || null,
        isFinal: isFinal ?? false,
        kind,
      })
      .returning();
    return row;
  });

  if (!created) {
    throw new HTTPException(500, { message: "Failed to create column" });
  }

  await publishEvent("project.updated", { projectId: created.projectId });

  return created;
}

export default createColumn;
