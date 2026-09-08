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

type UseTaskColumnDndOptions = {
  disabled?: boolean;
};

/**
 * Drag-to-reorder and drag-between-status behavior shared by the list and
 * table views. Both render tasks grouped into status sections, so they need
 * identical reindexing on drop; the kanban board's column semantics differ and
 * it keeps its own handlers.
 */
export function useTaskColumnDnd(
  project: ProjectWithTasks | undefined,
  { disabled = false }: UseTaskColumnDndOptions = {},
) {
  const { setProject } = useProjectStore();
  const { mutate: updateTask } = useUpdateTask();
  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null);
  const [overColumnId, setOverColumnId] = useState<string | null>(null);

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
        setOverColumnId(null);
        return;
      }

      if (project?.columns?.some((col) => col.id === over.id)) {
        setOverColumnId(over.id.toString());
        return;
      }

      const taskId = over.id.toString();
      const columnWithTask = project?.columns?.find((col) =>
        col.tasks.some((task) => task.id === taskId),
      );

      setOverColumnId(columnWithTask ? columnWithTask.id : null);
    },
    [project],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveId(null);
      setOverColumnId(null);

      if (!over || !project?.columns) return;

      const activeTaskId = active.id.toString();
      const overId = over.id.toString();

      // Dropping a task on itself is not a move. Falling through would look for
      // the task's index after removing it from the list, get -1, and splice it
      // back one slot from the end.
      if (activeTaskId === overId) return;

      const updatedProject = produce(project, (draft) => {
        const sourceColumn = draft?.columns?.find((col) =>
          col.tasks.some((task) => task.id === activeTaskId),
        );
        const destinationColumn = draft?.columns?.find(
          (col) =>
            col.id === overId || col.tasks.some((task) => task.id === overId),
        );

        if (!sourceColumn || !destinationColumn) return;

        const sourceTaskIndex = sourceColumn.tasks.findIndex(
          (task) => task.id === activeTaskId,
        );
        const task = sourceColumn.tasks[sourceTaskIndex];

        sourceColumn.tasks = sourceColumn.tasks.filter(
          (t) => t.id !== activeTaskId,
        );

        if (sourceColumn.id === destinationColumn.id) {
          let destinationIndex = destinationColumn.tasks.findIndex(
            (t) => t.id === overId,
          );
          if (sourceTaskIndex <= destinationIndex) {
            destinationIndex += 1;
          }
          destinationColumn.tasks.splice(destinationIndex, 0, task);

          destinationColumn.tasks.forEach((t, index) => {
            updateTask({
              ...t,
              status: destinationColumn.slug,
              position: index,
            });
          });
        } else {
          // A task's status is a column slug. The column id is only the
          // droppable identity here, and the two are interchangeable only
          // because the tasks endpoint happens to return `id: column.slug`.
          task.status = destinationColumn.slug;
          const destinationIndex =
            overId === destinationColumn.id
              ? destinationColumn.tasks.length
              : destinationColumn.tasks.findIndex((t) => t.id === overId) + 1;

          destinationColumn.tasks.splice(destinationIndex, 0, task);

          destinationColumn.tasks.forEach((t, index) => {
            updateTask({
              ...t,
              status: destinationColumn.slug,
              position: index,
            });
          });

          sourceColumn.tasks.forEach((t, index) => {
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
    setOverColumnId(null);
  }, []);

  const activeTask = useMemo(() => {
    if (!activeId) return null;
    return (
      project?.columns
        ?.flatMap((col) => col.tasks)
        .find((task) => task.id === activeId) ?? null
    );
  }, [activeId, project]);

  return {
    sensors,
    activeId,
    activeTask,
    overColumnId,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleDragCancel,
  };
}
