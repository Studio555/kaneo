import {
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  type UniqueIdentifier,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { produce } from "immer";
import { useCallback, useMemo, useState } from "react";
import { useUpdateTask } from "@/hooks/mutations/task/use-update-task";
import useProjectStore from "@/store/project";
import type { ProjectWithTasks } from "@/types/project";

// Pointer activation is pushed out of reach rather than dropping the sensors,
// because removing them mid-render would tear down dnd-kit state while a sort
// is toggled on and off. The keyboard sensor has no activation constraint to
// push, so it is withheld outright while dragging is disabled.
const UNREACHABLE_ACTIVATION = 999999;

// Section drop targets share dnd-kit's id space with the tasks inside them, so
// they carry a prefix that no task id can have.
const SECTION_DROP_PREFIX = "backlog-section:";

export function backlogSectionDropId(slug: string) {
  return `${SECTION_DROP_PREFIX}${slug}`;
}

function sectionSlugForDropId(
  project: ProjectWithTasks,
  id: string,
): string | null {
  if (id.startsWith(SECTION_DROP_PREFIX)) {
    const slug = id.slice(SECTION_DROP_PREFIX.length);
    return project.backlogSections.some((section) => section.slug === slug)
      ? slug
      : null;
  }

  return (
    project.backlogSections.find((section) =>
      section.tasks.some((task) => task.id === id),
    )?.slug ?? null
  );
}

type UseBacklogSectionDndOptions = {
  disabled?: boolean;
};

/**
 * Drag behavior shared by the backlog's list and table views. Dropping a task
 * on another section moves it there, which is a status change, and dropping it
 * among its own section's tasks reorders them. The backlog's sections are not
 * the board's columns, so this cannot reuse useTaskColumnDnd.
 */
export function useBacklogSectionDnd(
  project: ProjectWithTasks | undefined,
  { disabled = false }: UseBacklogSectionDndOptions = {},
) {
  const { setProject } = useProjectStore();
  const { mutate: updateTask } = useUpdateTask();
  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null);
  const [overSectionId, setOverSectionId] = useState<string | null>(null);

  const mouseSensor = useSensor(MouseSensor, {
    activationConstraint: { distance: disabled ? UNREACHABLE_ACTIVATION : 8 },
  });
  const touchSensor = useSensor(TouchSensor, {
    activationConstraint: {
      delay: disabled ? UNREACHABLE_ACTIVATION : 200,
      tolerance: 8,
    },
  });
  const keyboardSensor = useSensor(KeyboardSensor);
  const sensors = useSensors(
    mouseSensor,
    touchSensor,
    disabled ? null : keyboardSensor,
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id);
  }, []);

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const { over } = event;
      setOverSectionId(
        over && project
          ? sectionSlugForDropId(project, over.id.toString())
          : null,
      );
    },
    [project],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveId(null);
      setOverSectionId(null);

      if (!over || !project) return;

      const activeTaskId = active.id.toString();
      const overId = over.id.toString();

      // Dropping a task on itself is not a move. Falling through would look for
      // the task's index after removing it from the section, get -1, and splice
      // it back one slot from the end.
      if (activeTaskId === overId) return;

      const sourceSlug = sectionSlugForDropId(project, activeTaskId);
      const targetSlug = sectionSlugForDropId(project, overId);

      if (!sourceSlug || !targetSlug) return;

      const updatedProject = produce(project, (draft) => {
        const source = draft.backlogSections.find(
          (section) => section.slug === sourceSlug,
        );
        const target = draft.backlogSections.find(
          (section) => section.slug === targetSlug,
        );
        if (!source || !target) return;

        const sourceTaskIndex = source.tasks.findIndex(
          (task) => task.id === activeTaskId,
        );
        const [task] = source.tasks.splice(sourceTaskIndex, 1);
        if (!task) return;

        if (source === target) {
          // Over the section itself rather than one of its tasks means the
          // empty space below them, so the task goes to the end.
          let destinationIndex = target.tasks.findIndex((t) => t.id === overId);
          if (destinationIndex === -1) {
            destinationIndex = target.tasks.length;
          } else if (sourceTaskIndex <= destinationIndex) {
            destinationIndex += 1;
          }

          target.tasks.splice(destinationIndex, 0, task);

          target.tasks.forEach((t, index) => {
            updateTask({ ...t, position: index });
          });
          return;
        }

        task.status = targetSlug;
        target.tasks.push(task);

        target.tasks.forEach((t, index) => {
          updateTask({ ...t, status: targetSlug, position: index });
        });

        source.tasks.forEach((t, index) => {
          updateTask({ ...t, position: index });
        });
      });

      setProject(updatedProject);
    },
    [project, setProject, updateTask],
  );

  const handleDragCancel = useCallback(() => {
    setActiveId(null);
    setOverSectionId(null);
  }, []);

  const activeTask = useMemo(() => {
    if (!activeId) return null;
    return (
      project?.backlogSections
        .flatMap((section) => section.tasks)
        .find((task) => task.id === activeId) ?? null
    );
  }, [activeId, project]);

  return {
    sensors,
    activeId,
    activeTask,
    overSectionId,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleDragCancel,
  };
}
