import type { client } from "@kaneo/libs";
import type { InferResponseType } from "hono/client";
import type Task from "@/types/task";

export type Project = Extract<
  InferResponseType<(typeof client)["project"][":id"]["$get"], 200>,
  { id: string }
>;

type TasksApiResponse = InferResponseType<
  (typeof client)["task"]["tasks"][":projectId"]["$get"],
  200
>;

type ProjectWithTasksRaw = TasksApiResponse["data"];

export type BacklogSection = Omit<
  ProjectWithTasksRaw["backlogSections"][number],
  "tasks"
> & {
  tasks: Task[];
};

// The API still sends plannedTasks and archivedTasks for older clients; the
// fetcher drops them because backlogSections already holds those tasks.
export type ProjectWithTasks = Omit<
  ProjectWithTasksRaw,
  "archivedTasks" | "backlogSections" | "columns" | "plannedTasks"
> & {
  backlogSections: BacklogSection[];
  columns: Array<
    Omit<ProjectWithTasksRaw["columns"][number], "tasks"> & {
      tasks: Task[];
    }
  >;
};
