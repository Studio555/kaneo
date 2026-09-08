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
import { Archive, ChevronRight, Clock, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useBacklogSectionDnd } from "@/hooks/use-backlog-section-dnd";
import { useRegisterShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { cn } from "@/lib/cn";
import type { SortConfig } from "@/lib/sort-tasks";
import useBacklogBulkSelectionStore from "@/store/backlog-bulk-selection";
import { useUserPreferencesStore } from "@/store/user-preferences";
import type { ProjectWithTasks } from "@/types/project";
import type Task from "@/types/task";
import BacklogBulkToolbar from "../bulk-selection/backlog-bulk-toolbar";
import CreateTaskModal from "../shared/modals/create-task-modal";
import {
  getVisibleTableColumns,
  type TableColumn,
} from "../table-view/columns";
import { TableHeaderRow } from "../table-view/table-header";
import TaskTableRow from "../table-view/task-table-row";

type BacklogTableViewProps = {
  project?: ProjectWithTasks;
  sort: SortConfig;
  onSortChange: (sort: SortConfig) => void;
  disableDragDrop?: boolean;
};

type BacklogSectionProps = {
  sectionId: "planned" | "archived";
  icon: typeof Clock;
  tasks: Task[];
  columns: TableColumn[];
  projectSlug: string;
  isExpanded: boolean;
  isDropTarget: boolean;
  showAddButton?: boolean;
  onToggle: (sectionId: string) => void;
  onAddTask: (sectionId: string) => void;
};

// Module scope on purpose: nested inside BacklogTableView this would be a new
// component type every render, remounting every row whenever drag state changed.
function BacklogSection({
  sectionId,
  icon: IconComponent,
  tasks,
  columns,
  projectSlug,
  isExpanded,
  isDropTarget,
  showAddButton = false,
  onToggle,
  onAddTask,
}: BacklogSectionProps) {
  const { t } = useTranslation();
  const { setNodeRef } = useDroppable({
    id: sectionId,
    data: { type: "section", sectionId },
  });

  const title = t(`tasks:backlog.sections.${sectionId}`);

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
          onClick={() => onToggle(sectionId)}
          className="flex items-center gap-2 text-sm font-medium text-foreground transition-colors"
        >
          <ChevronRight
            className={cn(
              "size-3 transition-transform",
              isExpanded && "rotate-90",
            )}
          />
          <span className="flex h-4 items-center gap-2">
            <IconComponent className="size-3.5 text-muted-foreground" />
            <span className="flex items-center gap-1.5">
              <span>{title}</span>
              <span className="text-xs text-muted-foreground">
                {tasks.length}
              </span>
            </span>
          </span>
        </button>

        {showAddButton && (
          <button
            type="button"
            onClick={() => onAddTask(sectionId)}
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            title={t("tasks:backlog.addTask")}
          >
            <Plus className="size-3" />
          </button>
        )}
      </div>

      {isExpanded && (
        <div ref={setNodeRef} className="bg-card">
          <SortableContext items={tasks} strategy={verticalListSortingStrategy}>
            <AnimatePresence initial={false} mode="popLayout">
              {tasks.map((task) => (
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

          {tasks.length === 0 && (
            <div className="px-4 py-6 text-center text-xs text-muted-foreground">
              {t("tasks:backlog.noTasksInSection", {
                section: title.toLowerCase(),
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function BacklogTableView({
  project,
  sort,
  onSortChange,
  disableDragDrop = false,
}: BacklogTableViewProps) {
  const {
    setAvailableTasks,
    focusNext,
    focusPrevious,
    focusedTaskId,
    clearFocus,
  } = useBacklogBulkSelectionStore();
  const navigate = useNavigate();
  const { showAssignees, showDueDates, showLabels, showPriority } =
    useUserPreferencesStore();
  const {
    sensors,
    activeId,
    activeTask,
    overSectionId,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleDragCancel,
  } = useBacklogSectionDnd(project, { disabled: disableDragDrop });
  const [expandedSections, setExpandedSections] = useState<
    Record<string, boolean>
  >({
    planned: true,
    archived: true,
  });
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);

  // Status is deliberately absent: every task here is planned or archived, so
  // the cell would only restate the section it sits in, and changing it would
  // move the task onto the board and out of this view entirely. The row's
  // context menu still offers it.
  const columns = useMemo(
    () =>
      getVisibleTableColumns({
        showAssignees,
        showDueDates,
        showLabels,
        showPriority,
      }).filter((column) => column.key !== "status"),
    [showAssignees, showDueDates, showLabels, showPriority],
  );

  const plannedTasks = project?.plannedTasks ?? [];
  const archivedTasks = project?.archivedTasks ?? [];

  useEffect(() => {
    if (!project) return;

    const visibleTaskIds: string[] = [];
    if (expandedSections.planned) {
      visibleTaskIds.push(...(project.plannedTasks || []).map((t) => t.id));
    }
    if (expandedSections.archived) {
      visibleTaskIds.push(...(project.archivedTasks || []).map((t) => t.id));
    }
    setAvailableTasks(visibleTaskIds);
  }, [project, expandedSections, setAvailableTasks]);

  useEffect(() => {
    clearFocus();
  }, [clearFocus]);

  useRegisterShortcuts({
    shortcuts: {
      j: () => {
        focusNext();
        const state = useBacklogBulkSelectionStore.getState();
        if (state.focusedTaskId) {
          navigate({ to: ".", search: { taskId: state.focusedTaskId } });
        }
      },
      k: () => {
        focusPrevious();
        const state = useBacklogBulkSelectionStore.getState();
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

  const handleAddTaskClick = useCallback(() => {
    setIsTaskModalOpen(true);
  }, []);

  if (!project) {
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
          <BacklogSection
            sectionId="planned"
            icon={Clock}
            tasks={plannedTasks}
            columns={columns}
            projectSlug={project.slug ?? ""}
            isExpanded={Boolean(expandedSections.planned)}
            isDropTarget={Boolean(activeId) && overSectionId === "planned"}
            showAddButton
            onToggle={toggleSection}
            onAddTask={handleAddTaskClick}
          />
          <BacklogSection
            sectionId="archived"
            icon={Archive}
            tasks={archivedTasks}
            columns={columns}
            projectSlug={project.slug ?? ""}
            isExpanded={Boolean(expandedSections.archived)}
            isDropTarget={Boolean(activeId) && overSectionId === "archived"}
            onToggle={toggleSection}
            onAddTask={handleAddTaskClick}
          />
        </div>
      </div>

      <DragOverlay>
        {activeTask && (
          <div className="max-w-[240px] cursor-grabbing rounded-lg border border-border bg-card p-2 shadow-lg">
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-[10px] text-muted-foreground">
                {project.slug}-{activeTask.number}
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
        status="planned"
      />

      <BacklogBulkToolbar />
    </DndContext>
  );
}

export default BacklogTableView;
