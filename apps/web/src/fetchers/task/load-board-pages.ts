import type { ProjectWithTasks } from "@/types/project";
import type Task from "@/types/task";

// The API still sends plannedTasks and archivedTasks; the public board reads them.
type BoardData = ProjectWithTasks & {
  plannedTasks?: Task[];
  archivedTasks?: Task[];
};

export type BoardPage<T extends BoardData> = {
  data: T;
  pagination: {
    page: number;
    pageSize: number;
    totalPages: number;
    total: number;
    relatedTotalPages?: number;
  };
};

/** Publish immutable snapshots as bounded pages arrive. */
export async function loadBoardPages<T extends BoardData>(
  load: (page: number, relatedPage?: number) => Promise<BoardPage<T>>,
  signal?: AbortSignal,
  onProgress?: (board: T) => void,
): Promise<T> {
  signal?.throwIfAborted();
  const first = await load(1);
  const result = first.data;
  result.backlogSections ??= [];
  const columns = new Map(result.columns.map((column) => [column.id, column]));
  const sections = new Map(
    result.backlogSections.map((section) => [section.id, section]),
  );
  const seen = new Map(
    [
      ...result.columns.flatMap((column) => column.tasks),
      ...result.backlogSections.flatMap((section) => section.tasks),
    ].map((task) => [task.id, task]),
  );
  // The legacy lists duplicate backlog section tasks, so they dedupe apart.
  const seenLegacy = new Map(
    [...(result.archivedTasks ?? []), ...(result.plannedTasks ?? [])].map(
      (task) => [task.id, task],
    ),
  );
  let progressWeight =
    result.columns.length +
    result.backlogSections.length +
    seen.size +
    seenLegacy.size +
    [...seen.values(), ...seenLegacy.values()].reduce(
      (count, task) =>
        count + (task.labels?.length ?? 0) + (task.externalLinks?.length ?? 0),
      0,
    );
  let nextProgressWeight = 0;
  const reportProgress = (force = false) => {
    signal?.throwIfAborted();
    if (!onProgress || (!force && progressWeight < nextProgressWeight)) return;
    result.columns.sort(
      (left, right) => (left.position ?? 0) - (right.position ?? 0),
    );
    onProgress(structuredClone(result));
    nextProgressWeight = Math.max(1, progressWeight * 2);
  };
  reportProgress(true);
  const relationIndexes = new WeakMap<object[], Map<string, number>>();
  const mergeById = <U extends { id: string }>(
    left: U[] = [],
    right: U[] = [],
  ) => {
    let indexes = relationIndexes.get(left);
    if (!indexes) {
      indexes = new Map(left.map((value, index) => [value.id, index]));
      relationIndexes.set(left, indexes);
    }
    for (const value of right) {
      const index = indexes.get(value.id);
      if (index === undefined) {
        indexes.set(value.id, left.length);
        left.push(value);
        progressWeight++;
      } else left[index] = value;
    }
    return left;
  };
  const append = (
    target: Task[] | undefined,
    tasks: Task[] = [],
    known = seen,
  ) => {
    if (!target) return;
    for (const task of tasks) {
      if (!known.has(task.id)) {
        known.set(task.id, task);
        target.push(task);
        progressWeight +=
          1 + (task.labels?.length ?? 0) + (task.externalLinks?.length ?? 0);
      } else {
        const existing = known.get(task.id);
        if (existing) {
          existing.labels = mergeById(existing.labels, task.labels);
          existing.externalLinks = mergeById(
            existing.externalLinks,
            task.externalLinks,
          );
        }
      }
    }
  };
  const merge = (next: BoardPage<T>) => {
    for (const column of next.data.columns) {
      let target = columns.get(column.id);
      if (!target) {
        target = { ...column, tasks: [] };
        columns.set(column.id, target);
        result.columns.push(target);
        progressWeight++;
      }
      append(target.tasks, column.tasks);
    }
    for (const section of next.data.backlogSections ?? []) {
      let target = sections.get(section.id);
      if (!target) {
        target = { ...section, tasks: [] };
        sections.set(section.id, target);
        result.backlogSections.push(target);
        progressWeight++;
      }
      append(target.tasks, section.tasks);
    }
    append(result.archivedTasks, next.data.archivedTasks, seenLegacy);
    append(result.plannedTasks, next.data.plannedTasks, seenLegacy);
  };
  const loadRelated = async (page: number, initial: BoardPage<T>) => {
    // Each collection uses its initial count; live additions cannot indefinitely
    // extend a refresh. The next refresh sees changes made during pagination.
    const total = initial.pagination.relatedTotalPages ?? 1;
    for (let relatedPage = 2; relatedPage <= total; relatedPage++) {
      signal?.throwIfAborted();
      merge(await load(page, relatedPage));
      reportProgress();
    }
  };
  await loadRelated(1, first);
  for (let page = 2; page <= first.pagination.totalPages; page++) {
    signal?.throwIfAborted();
    const next = await load(page);
    merge(next);
    reportProgress();
    await loadRelated(page, next);
  }
  result.columns.sort(
    (left, right) => (left.position ?? 0) - (right.position ?? 0),
  );
  signal?.throwIfAborted();
  reportProgress(true);
  return result;
}
