import type { ProjectWithTasks } from "@/types/project";

type TaskSource = Pick<ProjectWithTasks, "columns" | "backlogSections">;

export function countColumnTasks(project: TaskSource | null | undefined) {
  return (
    project?.columns.reduce((sum, column) => sum + column.tasks.length, 0) ?? 0
  );
}

export function countBacklogTasks(project: TaskSource | null | undefined) {
  return (
    project?.backlogSections?.reduce(
      (sum, section) => sum + section.tasks.length,
      0,
    ) ?? 0
  );
}
