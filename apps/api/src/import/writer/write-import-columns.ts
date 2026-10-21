import { createId } from "@paralleldrive/cuid2";
import { and, asc, eq, isNotNull } from "drizzle-orm";
import type db from "../../database";
import { columnTable } from "../../database/schema";
import { chunk } from "./chunk";
import type { ImportColumnPlan } from "./plan-import-columns";
import type { BoardColumn, SystemSections } from "./plan-import-tasks";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type ImportBoard = {
  byKey: Map<string, BoardColumn>;
  fallback: BoardColumn | null;
  sections: SystemSections;
  count: number;
};

export async function writeImportColumns(
  tx: Transaction,
  projectId: string,
  plan: ImportColumnPlan,
): Promise<ImportBoard> {
  const sections = await systemSectionsOf(tx, projectId);
  if (plan.columns.length === 0) {
    const defaults = await tx
      .select({ id: columnTable.id, slug: columnTable.slug })
      .from(columnTable)
      .where(boardColumnsOf(projectId))
      .orderBy(asc(columnTable.position));
    return {
      byKey: new Map(),
      fallback: defaults[0] ?? null,
      sections,
      count: defaults.length,
    };
  }

  // Backlog sections are not part of the imported board and must survive.
  await tx.delete(columnTable).where(boardColumnsOf(projectId));

  const planned = plan.columns.map((column) => ({
    key: column.key,
    row: {
      id: createId(),
      projectId,
      name: column.name,
      slug: column.slug,
      position: column.position,
      isFinal: column.isFinal,
    },
  }));
  for (const batch of chunk(planned.map(({ row }) => row))) {
    await tx.insert(columnTable).values(batch);
  }

  const byKey = new Map(
    planned.map(({ key, row }) => [key, { id: row.id, slug: row.slug }]),
  );
  const first = planned[0]?.row;
  return {
    byKey,
    fallback: first ? { id: first.id, slug: first.slug } : null,
    sections,
    count: planned.length,
  };
}

async function systemSectionsOf(
  tx: Transaction,
  projectId: string,
): Promise<SystemSections> {
  const rows = await tx
    .select({ id: columnTable.id, systemKey: columnTable.systemKey })
    .from(columnTable)
    .where(
      and(
        eq(columnTable.projectId, projectId),
        isNotNull(columnTable.systemKey),
      ),
    );
  return Object.fromEntries(rows.map((row) => [row.systemKey, row.id]));
}

function boardColumnsOf(projectId: string) {
  return and(
    eq(columnTable.projectId, projectId),
    eq(columnTable.kind, "board"),
  );
}
