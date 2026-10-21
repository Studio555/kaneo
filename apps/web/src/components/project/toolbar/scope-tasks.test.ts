import { expect, it } from "vite-plus/test";
import type { ProjectWithTasks } from "@/types/project";
import { scopeTasks } from "./scope-tasks";

const project = {
  columns: [{ tasks: [{ id: "board" }] }],
  backlogSections: [
    { slug: "planned", tasks: [{ id: "planned" }] },
    { slug: "archived", tasks: [{ id: "archived" }] },
  ],
} as unknown as ProjectWithTasks;

const ids = (scope: Parameters<typeof scopeTasks>[1]) =>
  scopeTasks(project, scope).map((task) => task.id);

it("picks the tasks each view works with", () => {
  expect(ids("board")).toEqual(["board"]);
  expect(ids("backlog")).toEqual(["planned", "archived"]);
  expect(ids("schedule")).toEqual(["board", "planned"]);
  expect(scopeTasks(null, "board")).toEqual([]);
});
