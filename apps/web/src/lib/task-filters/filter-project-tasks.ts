import { mapBacklogSections } from "@/lib/backlog-sections";
import type { ProjectWithTasks } from "@/types/project";
import type Task from "@/types/task";

export function filterProjectTasks(
  project: ProjectWithTasks,
  keep: (task: Task) => boolean,
): ProjectWithTasks {
  return {
    ...project,
    columns: (project.columns ?? []).map((column) => ({
      ...column,
      tasks: column.tasks.filter(keep),
    })),
    backlogSections: mapBacklogSections(project, (tasks) => tasks.filter(keep)),
  };
}
