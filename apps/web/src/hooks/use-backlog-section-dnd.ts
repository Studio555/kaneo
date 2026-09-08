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

const SECTIONS = ["planned", "archived"] as const;
type BacklogSection = (typeof SECTIONS)[number];

function isBacklogSection(value: string): value is BacklogSection {
  return SECTIONS.some((section) => section === value);
}

type UseBacklogSectionDndOptions = {
  disabled?: boolean;
};

/**
 * Drag behavior shared by the backlog's list and table views. The backlog has
 * two fixed sections rather than the project's status columns, and dropping
 * across them archives or un-archives the task, so this cannot reuse
 * useTaskColumnDnd.
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
      if (!over) {
        setOverSectionId(null);
        return;
      }

      const overId = over.id.toString();
      if (isBacklogSection(overId)) {
        setOverSectionId(overId);
        return;
      }

      if ((project?.plannedTasks ?? []).some((task) => task.id === overId)) {
        setOverSectionId("planned");
      } else if (
        (project?.archivedTasks ?? []).some((task) => task.id === overId)
      ) {
        setOverSectionId("archived");
      } else {
        setOverSectionId(null);
      }
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

      const plannedTasks = project.plannedTasks || [];
      const archivedTasks = project.archivedTasks || [];
      const activeTask = [...plannedTasks, ...archivedTasks].find(
        (task) => task.id === activeTaskId,
      );

      if (!activeTask) return;

      let targetSection = overId;
      if (!isBacklogSection(overId)) {
        if (plannedTasks.some((task) => task.id === overId)) {
          targetSection = "planned";
        } else if (archivedTasks.some((task) => task.id === overId)) {
          targetSection = "archived";
        } else {
          return;
        }
      }

      const updatedProject = produce(project, (draft) => {
        const sourceSection =
          activeTask.status === "planned"
            ? draft.plannedTasks || []
            : draft.archivedTasks || [];

        const sourceTaskIndex = sourceSection.findIndex(
          (task) => task.id === activeTaskId,
        );
        const task = sourceSection[sourceTaskIndex];

        if (!task) return;

        if (activeTask.status === "planned") {
          draft.plannedTasks =
            draft.plannedTasks?.filter((t) => t.id !== activeTaskId) || [];
        } else {
          draft.archivedTasks =
            draft.archivedTasks?.filter((t) => t.id !== activeTaskId) || [];
        }

        if (activeTask.status === targetSection) {
          const targetSectionTasks =
            activeTask.status === "planned"
              ? draft.plannedTasks || []
              : draft.archivedTasks || [];

          let destinationIndex = targetSectionTasks.findIndex(
            (t) => t.id === overId,
          );

          if (sourceTaskIndex <= destinationIndex) {
            destinationIndex += 1;
          }

          if (activeTask.status === "planned") {
            draft.plannedTasks?.splice(destinationIndex, 0, task);
          } else {
            draft.archivedTasks?.splice(destinationIndex, 0, task);
          }

          const finalTasks =
            activeTask.status === "planned"
              ? draft.plannedTasks || []
              : draft.archivedTasks || [];

          finalTasks.forEach((t, index) => {
            updateTask({
              ...t,
              position: index,
            });
          });
        } else {
          task.status = targetSection;

          if (targetSection === "planned") {
            draft.plannedTasks = [...(draft.plannedTasks || []), task];
          } else {
            draft.archivedTasks = [...(draft.archivedTasks || []), task];
          }

          const updatedTasks =
            targetSection === "planned"
              ? draft.plannedTasks || []
              : draft.archivedTasks || [];

          updatedTasks.forEach((t, index) => {
            updateTask({
              ...t,
              status: targetSection,
              position: index,
            });
          });

          const sourceTasks =
            activeTask.status === "planned"
              ? draft.plannedTasks || []
              : draft.archivedTasks || [];

          sourceTasks.forEach((t, index) => {
            updateTask({
              ...t,
              position: index,
            });
          });
        }
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
      [
        ...(project?.plannedTasks ?? []),
        ...(project?.archivedTasks ?? []),
      ].find((task) => task.id === activeId) ?? null
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
