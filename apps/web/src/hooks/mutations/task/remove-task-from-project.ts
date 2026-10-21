import { mapBacklogSections } from "@/lib/backlog-sections";
import type { ProjectWithTasks } from "@/types/project";

export function removeTaskFromProject(
  project: ProjectWithTasks,
  taskId: string,
): ProjectWithTasks {
  return {
    ...project,
    columns: project.columns.map((column) => ({
      ...column,
      tasks: column.tasks.filter((task) => task.id !== taskId),
    })),
    backlogSections: mapBacklogSections(project, (tasks) =>
      tasks.filter((task) => task.id !== taskId),
    ),
  };
}
