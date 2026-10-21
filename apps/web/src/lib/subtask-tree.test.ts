import { describe, expect, it } from "vite-plus/test";
import {
  buildSubtaskChildren,
  findNestedTaskIds,
  flattenSubtaskRows,
  type TaskRelationEdge,
} from "./subtask-tree";

type T = { id: string };

const task = (id: string): T => ({ id });

const subtask = (source: string, target: string): TaskRelationEdge => ({
  sourceTaskId: source,
  targetTaskId: target,
  relationType: "subtask",
});

function flatten(
  tasks: T[],
  relations: TaskRelationEdge[],
  {
    all = tasks,
    expanded = true,
  }: { all?: T[]; expanded?: boolean | ((rowId: string) => boolean) } = {},
) {
  return flattenSubtaskRows({
    tasks,
    children: buildSubtaskChildren(relations),
    tasksById: new Map(all.map((entry) => [entry.id, entry])),
    isExpanded: typeof expanded === "function" ? expanded : () => expanded,
  });
}

describe("buildSubtaskChildren", () => {
  it("keeps only subtask edges", () => {
    const children = buildSubtaskChildren([
      subtask("a", "b"),
      { sourceTaskId: "a", targetTaskId: "c", relationType: "blocks" },
      { sourceTaskId: "a", targetTaskId: "d", relationType: "related" },
    ]);

    expect(children.get("a")).toEqual(["b"]);
  });

  it("ignores a self-referencing edge", () => {
    expect(buildSubtaskChildren([subtask("a", "a")]).size).toBe(0);
  });

  it("does not repeat a duplicated edge", () => {
    const children = buildSubtaskChildren([
      subtask("a", "b"),
      subtask("a", "b"),
    ]);

    expect(children.get("a")).toEqual(["b"]);
  });
});

describe("flattenSubtaskRows", () => {
  it("leaves a flat column untouched", () => {
    const rows = flatten([task("a"), task("b")], []);

    expect(rows.map((row) => [row.rowId, row.depth, row.childCount])).toEqual([
      ["a", 0, 0],
      ["b", 0, 0],
    ]);
  });

  it("shows a child only under its parent", () => {
    const tasks = [task("parent"), task("child")];
    const rows = flatten(tasks, [subtask("parent", "child")]);

    expect(rows.map((row) => [row.rowId, row.depth])).toEqual([
      ["parent", 0],
      ["parent/child", 1],
    ]);
  });

  it("shows a child under a parent from another status group", () => {
    // Each column is flattened on its own; the child's column skips it
    // because its parent, in view elsewhere, renders it.
    const parent = task("parent");
    const child = task("child");
    const all = [parent, child];
    const relations = [subtask("parent", "child")];

    expect(
      flatten([child], relations, { all }).map((row) => row.rowId),
    ).toEqual([]);
    expect(
      flatten([parent], relations, { all }).map((row) => row.rowId),
    ).toEqual(["parent", "parent/child"]);
  });

  it("reports a child count but no nested row while collapsed", () => {
    const rows = flatten(
      [task("parent"), task("child")],
      [subtask("parent", "child")],
      {
        expanded: false,
      },
    );

    expect(rows.map((row) => row.rowId)).toEqual(["parent"]);
    expect(rows[0].childCount).toBe(1);
  });

  it("nests to arbitrary depth", () => {
    const tasks = [task("a"), task("b"), task("c")];
    const rows = flatten(tasks, [subtask("a", "b"), subtask("b", "c")]);

    expect(rows.map((row) => row.rowId)).toEqual(["a", "a/b", "a/b/c"]);
  });

  it("terminates on a cycle instead of recursing forever", () => {
    const tasks = [task("a"), task("b")];
    const rows = flatten(tasks, [subtask("a", "b"), subtask("b", "a")]);

    // Without the ancestor check this never returns and takes the tab with it.
    expect(rows.map((row) => row.rowId)).toEqual(["a", "a/b", "b", "b/a"]);
  });

  it("terminates on a longer cycle", () => {
    const tasks = [task("a"), task("b"), task("c")];
    const rows = flatten(tasks, [
      subtask("a", "b"),
      subtask("b", "c"),
      subtask("c", "a"),
    ]);

    expect(rows.every((row) => row.rowId.split("/").length <= 3)).toBe(true);
    expect(rows.map((row) => row.rowId)).toContain("a/b/c");
  });

  it("renders a task under each of its parents", () => {
    const tasks = [task("p1"), task("p2"), task("shared")];
    const rows = flatten(tasks, [
      subtask("p1", "shared"),
      subtask("p2", "shared"),
    ]);

    expect(rows.map((row) => row.rowId)).toEqual([
      "p1",
      "p1/shared",
      "p2",
      "p2/shared",
    ]);
  });

  it("gives every row a unique id so rows can be keyed and dragged", () => {
    const tasks = [task("p1"), task("p2"), task("shared")];
    const rows = flatten(tasks, [
      subtask("p1", "shared"),
      subtask("p2", "shared"),
    ]);
    const ids = rows.map((row) => row.rowId);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it("caps nesting on a layered graph with shared descendants", () => {
    // Every task on a level parents every task on the next. Expanding each
    // occurrence would enumerate simple paths: this shape produced 16,356 rows
    // before expansion was bounded, with no cycle anywhere in it.
    const LEVELS = 12;
    const WIDTH = 2;
    const tasks: T[] = [];
    const relations: TaskRelationEdge[] = [];

    for (let level = 0; level < LEVELS; level += 1) {
      for (let index = 0; index < WIDTH; index += 1) {
        tasks.push(task(`l${level}n${index}`));
      }
    }
    for (let level = 0; level < LEVELS - 1; level += 1) {
      for (let from = 0; from < WIDTH; from += 1) {
        for (let to = 0; to < WIDTH; to += 1) {
          relations.push(subtask(`l${level}n${from}`, `l${level + 1}n${to}`));
        }
      }
    }

    const rows = flattenSubtaskRows({
      tasks,
      children: buildSubtaskChildren(relations),
      tasksById: new Map(tasks.map((entry) => [entry.id, entry])),
      isExpanded: () => true,
      maxNestedRows: 200,
    });

    // Unbounded, this shape reaches 16,356 rows with no cycle in it. Reaching
    // it in the app would need a viewer to expand that many rows by hand, but
    // the walk itself has to terminate regardless of who calls it.
    const nested = rows.filter((row) => row.depth > 0);
    expect(nested.length).toBeLessThan(400);
    // Only the first level has no parent, so only it is top-level.
    expect(rows.filter((row) => row.depth === 0)).toHaveLength(WIDTH);
  });

  it("caps a single parent with more children than the budget", () => {
    const parent = task("parent");
    const children = Array.from({ length: 50 }, (_, index) =>
      task(`child-${index}`),
    );
    const relations = children.map((child) => subtask("parent", child.id));

    const rows = flattenSubtaskRows({
      tasks: [parent],
      children: buildSubtaskChildren(relations),
      tasksById: new Map(
        [parent, ...children].map((entry) => [entry.id, entry]),
      ),
      isExpanded: () => true,
      maxNestedRows: 10,
    });

    // The budget used to be checked once per parent, so a wide parent emitted
    // every child regardless of it.
    expect(rows.filter((row) => row.depth > 0)).toHaveLength(10);
  });

  it("reports the expansion that was actually rendered", () => {
    const tasks = [task("parent"), task("child")];
    const relations = [subtask("parent", "child")];

    const open = flatten(tasks, relations);
    expect(open.find((row) => row.rowId === "parent")?.isExpanded).toBe(true);

    // The stored preference is irrelevant once the flattener declines to
    // expand — during a drag, say — and the chevron follows this, not the map.
    const shut = flatten(tasks, relations, { expanded: false });
    expect(shut.find((row) => row.rowId === "parent")?.isExpanded).toBe(false);
    expect(shut.find((row) => row.rowId === "parent")?.childCount).toBe(1);
  });

  it("never reports a childless row as expanded", () => {
    const rows = flatten([task("a")], []);

    expect(rows[0].isExpanded).toBe(false);
  });

  it("reports no children once the budget is spent", () => {
    const tasks = [task("a"), task("b")];
    const rows = flattenSubtaskRows({
      tasks,
      children: buildSubtaskChildren([subtask("a", "b"), subtask("b", "c")]),
      tasksById: new Map(
        [...tasks, task("c")].map((entry) => [entry.id, entry]),
      ),
      isExpanded: () => true,
      maxNestedRows: 1,
    });

    // The nested "a/b" is the row that spends the budget, so it must not
    // advertise a chevron that can reveal nothing.
    expect(rows.find((row) => row.rowId === "a/b")).toMatchObject({
      childCount: 0,
    });
    expect(rows.map((row) => row.rowId)).not.toContain("a/b/c");
  });

  it("keeps the root row even when nesting is capped", () => {
    const tasks = [task("a"), task("b"), task("c")];
    const rows = flattenSubtaskRows({
      tasks,
      children: buildSubtaskChildren([subtask("a", "b"), subtask("b", "c")]),
      tasksById: new Map(tasks.map((entry) => [entry.id, entry])),
      isExpanded: () => true,
      maxNestedRows: 0,
    });

    expect(rows.map((row) => row.rowId)).toEqual(["a"]);
  });

  it("ignores a child the view is not rendering", () => {
    // A subtask in another project is not returned by the endpoint, so a
    // chevron would open onto nothing.
    const rows = flatten([task("parent")], [subtask("parent", "elsewhere")], {
      all: [task("parent")],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].childCount).toBe(0);
  });

  it("expands only the row that is open", () => {
    const tasks = [task("p1"), task("p2"), task("shared")];
    const rows = flatten(
      tasks,
      [subtask("p1", "shared"), subtask("p2", "shared")],
      { expanded: (rowId) => rowId === "p1" },
    );

    expect(rows.map((row) => row.rowId)).toEqual(["p1", "p1/shared", "p2"]);
  });
});

describe("findNestedTaskIds", () => {
  const byId = (...ids: string[]) =>
    new Map(ids.map((id) => [id, task(id)] as const));

  it("marks tasks below a root at any depth", () => {
    const nested = findNestedTaskIds(
      buildSubtaskChildren([subtask("a", "b"), subtask("b", "c")]),
      byId("a", "b", "c"),
    );

    expect([...nested].sort()).toEqual(["b", "c"]);
  });

  it("keeps a child top-level when its parent is not in view", () => {
    const nested = findNestedTaskIds(
      buildSubtaskChildren([subtask("archived", "child")]),
      byId("child"),
    );

    expect(nested.size).toBe(0);
  });

  it("keeps tasks top-level when their only parents form a cycle", () => {
    // Neither has a root above it; hiding both would lose them from the view.
    const nested = findNestedTaskIds(
      buildSubtaskChildren([subtask("a", "b"), subtask("b", "a")]),
      byId("a", "b"),
    );

    expect(nested.size).toBe(0);
  });

  it("nests a cycle hanging below a root", () => {
    const nested = findNestedTaskIds(
      buildSubtaskChildren([
        subtask("root", "a"),
        subtask("a", "b"),
        subtask("b", "a"),
      ]),
      byId("root", "a", "b"),
    );

    expect([...nested].sort()).toEqual(["a", "b"]);
  });
});
