export type TaskRelationEdge = {
  sourceTaskId: string;
  targetTaskId: string;
  relationType: string;
};

export type SubtaskRow<T> = {
  task: T;
  /** Nesting level; 0 for a top-level row in its own status group. */
  depth: number;
  /**
   * Unique per rendered row rather than per task. A task with several parents
   * is rendered under each of them, so `task.id` can appear more than once and
   * cannot key a row or identify a drag target.
   */
  rowId: string;
  childCount: number;
  /**
   * Whether this row's children are actually rendered beneath it. Not the same
   * as the stored preference: a drag collapses every row, and the budget stops
   * deep ones expanding. The chevron and its aria-expanded must follow this,
   * or the control describes a subtree that is not on screen.
   */
  isExpanded: boolean;
};

/**
 * Maps each parent to its children, in the order the relations were returned.
 *
 * Hierarchy is a graph edge rather than a column on the task, so a task may
 * have several parents and the edges may form a cycle. Neither the schema nor
 * the create endpoint prevents it, so consumers must not assume a tree.
 */
export function buildSubtaskChildren(
  relations: readonly TaskRelationEdge[],
): Map<string, string[]> {
  // A Set rather than scanning the accumulated array: this runs on every
  // relation response, and `includes` per edge is quadratic in one parent's
  // children. Insertion order is preserved, so the rendered order is the order
  // the relations arrived in.
  const children = new Map<string, Set<string>>();

  for (const relation of relations) {
    if (relation.relationType !== "subtask") continue;
    if (relation.sourceTaskId === relation.targetTaskId) continue;

    const existing = children.get(relation.sourceTaskId);
    if (existing) {
      existing.add(relation.targetTaskId);
    } else {
      children.set(relation.sourceTaskId, new Set([relation.targetTaskId]));
    }
  }

  return new Map(
    [...children].map(([parentId, childIds]) => [parentId, [...childIds]]),
  );
}

/**
 * The tasks that are shown only beneath a parent, not as rows of their own.
 *
 * A subtask whose parent is in view belongs under that parent, so listing it
 * again at the top level would show it twice. Membership is decided by
 * reachability from a task that has no parent in view: a task whose only
 * parents form a cycle has no root to hang from and would otherwise vanish,
 * so it keeps its top-level row.
 */
export function findNestedTaskIds<T extends { id: string }>(
  children: Map<string, string[]>,
  tasksById: Map<string, T>,
): Set<string> {
  const hasParent = new Set<string>();
  for (const [parentId, childIds] of children) {
    if (!tasksById.has(parentId)) continue;
    for (const childId of childIds) {
      if (childId !== parentId && tasksById.has(childId)) {
        hasParent.add(childId);
      }
    }
  }

  const nested = new Set<string>();
  const stack = [...tasksById.keys()].filter((id) => !hasParent.has(id));
  while (stack.length > 0) {
    const id = stack.pop() as string;
    for (const childId of children.get(id) ?? []) {
      if (hasParent.has(childId) && !nested.has(childId)) {
        nested.add(childId);
        stack.push(childId);
      }
    }
  }

  return nested;
}

/**
 * A task may have several parents, so expanding every occurrence enumerates
 * simple paths rather than tasks and can grow exponentially: twelve layers of
 * two tasks each, 24 tasks and 44 edges, reach 16,356 rows. Reaching that
 * needs a viewer to expand exponentially many rows by hand, since every row
 * starts collapsed and nested rows carry their own path ids rather than
 * inheriting their task's state. The cap is a backstop for the shapes that
 * would otherwise freeze the tab, not the mechanism that keeps the common
 * case small.
 */
const MAX_NESTED_ROWS = 1000;

/**
 * Expands a column's tasks into rows, rendering each subtask beneath its
 * parent when that parent is expanded.
 *
 * A subtask with a parent in view is rendered only there, under the parent's
 * status group, and not again in its own; see {@link findNestedTaskIds}.
 * Pass `nestedTaskIds` when flattening several columns of one project, so it
 * is computed once rather than per column.
 */
export function flattenSubtaskRows<T extends { id: string }>({
  tasks,
  children,
  tasksById,
  isExpanded,
  nestedTaskIds = findNestedTaskIds(children, tasksById),
  maxNestedRows = MAX_NESTED_ROWS,
}: {
  tasks: readonly T[];
  children: Map<string, string[]>;
  tasksById: Map<string, T>;
  isExpanded: (rowId: string) => boolean;
  nestedTaskIds?: Set<string>;
  maxNestedRows?: number;
}): SubtaskRow<T>[] {
  const rows: SubtaskRow<T>[] = [];
  let nested = 0;

  const walk = (
    task: T,
    depth: number,
    ancestors: Set<string>,
    path: string,
  ) => {
    const rowId = path ? `${path}/${task.id}` : task.id;

    // Only children the view can actually render count; a subtask in another
    // project is not returned by the endpoint and must not show a chevron.
    const childTasks: T[] = [];
    for (const childId of children.get(task.id) ?? []) {
      const child = tasksById.get(childId);
      if (child && !ancestors.has(childId) && childId !== task.id) {
        childTasks.push(child);
      }
    }

    if (depth > 0) nested += 1;

    // Past the budget the row reports no children, so it renders no chevron
    // rather than an expanded one with nothing beneath it.
    const childCount = nested >= maxNestedRows ? 0 : childTasks.length;

    const expanded = childCount > 0 && isExpanded(rowId);

    rows.push({ task, depth, rowId, childCount, isExpanded: expanded });

    if (!expanded) return;

    const nextAncestors = new Set(ancestors);
    nextAncestors.add(task.id);
    for (const child of childTasks) {
      // Checked per child, not once per parent: a single parent with more
      // children than the budget would otherwise emit all of them.
      if (nested >= maxNestedRows) return;
      walk(child, depth + 1, nextAncestors, rowId);
    }
  };

  // Top-level rows are always emitted; the cap governs nesting only.
  for (const task of tasks) {
    if (nestedTaskIds.has(task.id)) continue;
    walk(task, 0, new Set(), "");
  }

  return rows;
}
