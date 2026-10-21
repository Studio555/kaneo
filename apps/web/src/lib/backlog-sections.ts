import type { TFunction } from "i18next";
import type { BacklogSection, ProjectWithTasks } from "@/types/project";
import type Task from "@/types/task";

type SectionLike = Pick<BacklogSection, "name" | "systemKey">;

/** The built-in sections are named by translation; custom ones by the user. */
export function getBacklogSectionLabel(section: SectionLike, t: TFunction) {
  return section.systemKey
    ? t(`tasks:backlog.sections.${section.systemKey}`)
    : section.name;
}

export function getBacklogTasks(
  project: Pick<ProjectWithTasks, "backlogSections"> | undefined | null,
): Task[] {
  return project?.backlogSections.flatMap((section) => section.tasks) ?? [];
}

export function findBacklogSection(
  project: Pick<ProjectWithTasks, "backlogSections"> | undefined | null,
  slug: string,
) {
  return project?.backlogSections.find((section) => section.slug === slug);
}

export function mapBacklogSections(
  project: ProjectWithTasks,
  mapTasks: (tasks: Task[]) => Task[],
): ProjectWithTasks["backlogSections"] {
  return project.backlogSections.map((section) => ({
    ...section,
    tasks: mapTasks(section.tasks),
  }));
}
