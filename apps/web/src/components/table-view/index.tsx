import {
  closestCorners,
  DndContext,
  DragOverlay,
  useDroppable,
} from "@dnd-kit/core";
import { snapCenterToCursor } from "@dnd-kit/modifiers";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useNavigate } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";
import { produce } from "immer";
import { Archive, ChevronRight, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useUpdateTask } from "@/hooks/mutations/task/use-update-task";
import { useRegisterShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { useTaskColumnDnd } from "@/hooks/use-task-column-dnd";
import { cn } from "@/lib/cn";
import { getColumnIcon } from "@/lib/column";
import type { SortConfig } from "@/lib/sort-tasks";
import { toast } from "@/lib/toast";
import useBulkSelectionStore from "@/store/bulk-selection";
import useProjectStore from "@/store/project";
import { useUserPreferencesStore } from "@/store/user-preferences";
import type { ProjectWithTasks } from "@/types/project";
import BulkToolbar from "../bulk-selection/bulk-toolbar";
import { ArchiveTasksModal } from "../shared/modals/archive-tasks-modal";
import CreateTaskModal from "../shared/modals/create-task-modal";
import { getVisibleTableColumns, type TableColumn } from "./columns";
import { TableHeaderRow } from "./table-header";
import TaskTableRow from "./task-table-row";

type TableViewProps = {
  project: ProjectWithTasks;
  sort: SortConfig;
  onSortChange: (sort: SortConfig) => void;
  disableDragDrop?: boolean;
};

type ColumnSectionProps = {
  column: ProjectWithTasks["columns"][number];
  columns: TableColumn[];
  projectSlug: string;
  isExpanded: boolean;
  isDropTarget: boolean;
  onToggle: (sectionId: string) => void;
  onAddTask: (sectionId: string) => void;
  onArchive: (column: ProjectWithTasks["columns"][number]) => void;
};

// Declared at module scope on purpose: nesting it inside TableView would make a
// new component type on every render, remounting every row whenever drag state
// changed and refiring each row's queries.
function ColumnSection({
  column,
  columns,
  projectSlug,
  isExpanded,
  isDropTarget,
  onToggle,
  onAddTask,
  onArchive,
}: ColumnSectionProps) {
  const { t } = useTranslation();
  const { setNodeRef } = useDroppable({
    id: column.id,
    data: {
      type: "column",
      column,
    },
  });

  return (
    <div
      className={cn(
        "border-b border-border/50 transition-colors duration-150",
        isDropTarget && "border-l-4 border-l-ring bg-accent/35",
      )}
    >
      <div className="flex items-center justify-between border-b border-border/50 bg-muted/60 px-4 py-2">
        <button
          type="button"
          onClick={() => onToggle(column.id)}
          className="flex items-center gap-2 text-sm font-medium text-foreground transition-colors"
        >
          <ChevronRight
            className={cn(
              "size-3 transition-transform",
              isExpanded && "rotate-90",
            )}
          />
          <span className="flex h-4 items-center gap-2">
            {getColumnIcon(column.id, column.isFinal, column.icon)}
            <span className="flex items-center gap-1.5">
              <span>{column.name}</span>
              <span className="text-xs text-muted-foreground">
                {column.tasks.length}
              </span>
            </span>
          </span>
        </button>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onAddTask(column.id)}
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            title={t("tasks:listView.addTask")}
          >
            <Plus className="size-3" />
          </button>

          {column.isFinal && column.tasks.length > 0 && (
            <button
              type="button"
              onClick={() => onArchive(column)}
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              title={t("tasks:listView.archiveAllTooltip")}
            >
              <Archive className="size-3" />
            </button>
          )}
        </div>
      </div>

      {isExpanded && (
        <div ref={setNodeRef} className="bg-card">
          <SortableContext
            items={column.tasks}
            strategy={verticalListSortingStrategy}
          >
            <AnimatePresence initial={false} mode="popLayout">
              {column.tasks.map((task) => (
                <motion.div
                  key={task.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15, ease: [0.23, 1, 0.32, 1] }}
                >
                  <TaskTableRow
                    task={task}
                    projectSlug={projectSlug}
                    columns={columns}
                  />
                </motion.div>
              ))}
            </AnimatePresence>
          </SortableContext>

          {column.tasks.length === 0 && (
            <div className="px-4 py-6 text-center text-xs text-muted-foreground">
              {t("tasks:listView.noTasks")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TableView({
  project,
  sort,
  onSortChange,
  disableDragDrop = false,
}: TableViewProps) {
  const { t } = useTranslation();
  const { setProject } = useProjectStore();
  const {
    setAvailableTasks,
    focusNext,
    focusPrevious,
    focusedTaskId,
    clearFocus,
  } = useBulkSelectionStore();
  const { mutate: updateTask } = useUpdateTask();
  const navigate = useNavigate();
  const { showAssignees, showDueDates, showLabels, showPriority } =
    useUserPreferencesStore();
  const {
    sensors,
    activeId,
    activeTask,
    overColumnId,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleDragCancel,
  } = useTaskColumnDnd(project, { disabled: disableDragDrop });
  const [expandedSections, setExpandedSections] = useState<
    Record<string, boolean>
  >(() => {
    const sections: Record<string, boolean> = {};
    for (const col of project?.columns ?? []) {
      sections[col.id] = true;
    }
    return sections;
  });
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [activeColumn, setActiveColumn] = useState<string | null>(null);
  const [isArchiveModalOpen, setIsArchiveModalOpen] = useState(false);
  const [columnToArchive, setColumnToArchive] = useState<
    ProjectWithTasks["columns"][number] | null
  >(null);

  const columns = useMemo(
    () =>
      getVisibleTableColumns({
        showAssignees,
        showDueDates,
        showLabels,
        showPriority,
      }),
    [showAssignees, showDueDates, showLabels, showPriority],
  );

  useEffect(() => {
    if (project?.columns) {
      const visibleTaskIds = project.columns
        .filter((column) => expandedSections[column.id])
        .flatMap((column) => column.tasks.map((task) => task.id));
      setAvailableTasks(visibleTaskIds);
    }
  }, [project, expandedSections, setAvailableTasks]);

  useEffect(() => {
    clearFocus();
  }, [clearFocus]);

  useRegisterShortcuts({
    shortcuts: {
      j: () => {
        focusNext();
        const state = useBulkSelectionStore.getState();
        if (state.focusedTaskId) {
          navigate({ to: ".", search: { taskId: state.focusedTaskId } });
        }
      },
      k: () => {
        focusPrevious();
        const state = useBulkSelectionStore.getState();
        if (state.focusedTaskId) {
          navigate({ to: ".", search: { taskId: state.focusedTaskId } });
        }
      },
      Enter: () => {
        if (focusedTaskId && project) {
          navigate({
            to: "/dashboard/workspace/$workspaceId/project/$projectId/task/$taskId",
            params: {
              workspaceId: project.workspaceId,
              projectId: project.id,
              taskId: focusedTaskId,
            },
          });
        }
      },
    },
  });

  const toggleSection = useCallback((sectionId: string) => {
    setExpandedSections((prev) => ({
      ...prev,
      [sectionId]: !prev[sectionId],
    }));
  }, []);

  const handleAddTaskClick = useCallback((sectionId: string) => {
    setIsTaskModalOpen(true);
    setActiveColumn(sectionId);
  }, []);

  const handleArchiveClick = useCallback(
    (column: ProjectWithTasks["columns"][number]) => {
      if (!column.isFinal || column.tasks.length === 0) return;
      setColumnToArchive(column);
      setIsArchiveModalOpen(true);
    },
    [],
  );

  const handleConfirmArchive = () => {
    if (!columnToArchive) return;

    const updatedProject = produce(project, (draft) => {
      const archivedColumn = draft?.columns?.find(
        (col) => col.id === columnToArchive.id,
      );
      if (!archivedColumn) return;

      for (const task of archivedColumn.tasks) {
        updateTask({
          ...task,
          status: "archived",
        });
      }

      archivedColumn.tasks = [];
    });

    setProject(updatedProject);
    toast.success(
      t("tasks:archive.success", { count: columnToArchive.tasks.length }),
    );

    setIsArchiveModalOpen(false);
    setColumnToArchive(null);
  };

  if (!project?.columns) {
    return null;
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
      modifiers={[snapCenterToCursor]}
    >
      <div className="h-full w-full overflow-auto bg-muted/20">
        <TableHeaderRow
          columns={columns}
          sort={sort}
          onSortChange={onSortChange}
        />

        <div className="min-w-fit divide-y divide-border/50">
          {project.columns.map((column) => (
            <ColumnSection
              key={column.id}
              column={column}
              columns={columns}
              projectSlug={project.slug ?? ""}
              isExpanded={Boolean(expandedSections[column.id])}
              isDropTarget={Boolean(activeId) && overColumnId === column.id}
              onToggle={toggleSection}
              onAddTask={handleAddTaskClick}
              onArchive={handleArchiveClick}
            />
          ))}
        </div>
      </div>

      <DragOverlay>
        {activeTask && (
          <div className="max-w-[240px] cursor-grabbing rounded-lg border border-border bg-card p-2 shadow-lg">
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-[10px] text-muted-foreground">
                {project?.slug}-{activeTask.number}
              </span>
              <span className="truncate text-xs text-foreground">
                {activeTask.title}
              </span>
            </div>
          </div>
        )}
      </DragOverlay>

      <CreateTaskModal
        open={isTaskModalOpen}
        projectId={project.id}
        onClose={() => setIsTaskModalOpen(false)}
        status={activeColumn ?? "done"}
      />
      <ArchiveTasksModal
        open={isArchiveModalOpen}
        onClose={() => {
          setIsArchiveModalOpen(false);
          setColumnToArchive(null);
        }}
        onConfirm={handleConfirmArchive}
        taskCount={columnToArchive?.tasks.length ?? 0}
      />

      <BulkToolbar />
    </DndContext>
  );
}

export default TableView;
