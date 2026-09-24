import { and, eq, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { type ColumnKind, columnTable } from "../../database/schema";
import { SYSTEM_BACKLOG_STATUSES } from "../../task/validate-task-fields";

export function toSlug(name: string): string {
  const slug = name
    .normalize("NFKC")
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");

  return /[\p{L}\p{N}]/u.test(slug) ? slug : "";
}

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

  const existing = await db
    .select({ id: columnTable.id })
    .from(columnTable)
    .where(
      sql`${columnTable.projectId} = ${projectId} AND ${columnTable.slug} = ${slug}`,
    );

  if (existing.length > 0) {
    throw new HTTPException(409, {
      message: `Column with slug "${slug}" already exists in this project`,
    });
  }

  const [maxPos] = await db
    .select({
      maxPosition: sql<number>`COALESCE(MAX(${columnTable.position}), -1)`,
    })
    .from(columnTable)
    .where(
      and(eq(columnTable.projectId, projectId), eq(columnTable.kind, kind)),
    );

  const position = (maxPos?.maxPosition ?? -1) + 1;

  const [created] = await db
    .insert(columnTable)
    .values({
      projectId,
      name,
      slug,
      position,
      icon: icon || null,
      color: color || null,
      isFinal: isFinal ?? false,
      kind,
    })
    .returning();

  if (!created) {
    throw new HTTPException(500, { message: "Failed to create column" });
  }

  return created;
}

export default createColumn;
