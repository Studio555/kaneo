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
import { AnimatePresence, motion } from "framer-motion";
import { ChevronRight, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useTaskViewShortcuts } from "@/components/project/task-view-keys/use-task-view-shortcuts";
import {
  backlogSectionDropId,
  useBacklogSectionDnd,
} from "@/hooks/use-backlog-section-dnd";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { getBacklogSectionLabel } from "@/lib/backlog-sections";
import { cn } from "@/lib/cn";
import type { SortConfig } from "@/lib/sort-tasks";
import useBacklogBulkSelectionStore from "@/store/backlog-bulk-selection";
import { useUserPreferencesStore } from "@/store/user-preferences";
import type {
  BacklogSection as BacklogSectionData,
  ProjectWithTasks,
} from "@/types/project";
import { BacklogSectionIcon } from "../backlog-sections/backlog-section-icon";
import { BacklogSectionMenu } from "../backlog-sections/backlog-section-menu";
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
  section: BacklogSectionData;
  columns: TableColumn[];
  projectId: string;
  projectSlug: string;
  isExpanded: boolean;
  isDropTarget: boolean;
  canManage: boolean;
  onToggle: (sectionId: string) => void;
  onAddTask: (sectionId: string) => void;
};

// Module scope on purpose: nested inside BacklogTableView this would be a new
// component type every render, remounting every row whenever drag state changed.
function BacklogSection({
  section,
  columns,
  projectId,
  projectSlug,
  isExpanded,
  isDropTarget,
  canManage,
  onToggle,
  onAddTask,
}: BacklogSectionProps) {
  const { t } = useTranslation();
  const sectionId = section.slug;
  const { tasks } = section;
  // The whole section is the drop target, header included, so a task can
  // still be dropped on a section that is collapsed.
  const { setNodeRef } = useDroppable({
    id: backlogSectionDropId(sectionId),
    data: { type: "section", sectionId },
  });

  const title = getBacklogSectionLabel(section, t);

  return (
    <div
      ref={setNodeRef}
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
            <BacklogSectionIcon
              section={section}
              className="size-3.5 text-muted-foreground"
            />
            <span className="flex items-center gap-1.5">
              <span>{title}</span>
              <span className="text-xs text-muted-foreground">
                {tasks.length}
              </span>
            </span>
          </span>
        </button>

        <div className="flex items-center gap-1">
          {section.systemKey !== "archived" && (
            <button
              type="button"
              onClick={() => onAddTask(sectionId)}
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              title={t("tasks:backlog.addTask")}
            >
              <Plus className="size-3" />
            </button>
          )}
          {canManage && !section.systemKey && (
            <BacklogSectionMenu projectId={projectId} section={section} />
          )}
        </div>
      </div>

      {isExpanded && (
        <div className="bg-card">
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
                    selectionStore={useBacklogBulkSelectionStore}
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
  const setAvailableTasks = useBacklogBulkSelectionStore(
    (state) => state.setAvailableTasks,
  );
  const clearFocus = useBacklogBulkSelectionStore((state) => state.clearFocus);
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
  const { canUpdateProjects } = useWorkspacePermission();
  const canManageSections = canUpdateProjects();
  // Keyed by section slug; a section nobody has toggled yet starts open.
  const [collapsedSections, setCollapsedSections] = useState<
    Record<string, boolean>
  >({});
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [taskModalStatus, setTaskModalStatus] = useState("planned");

  // Status is deliberately absent: every task here sits in a backlog section,
  // so the cell would only restate the section it sits in, and changing it
  // would move the task onto the board and out of this view entirely. The
  // row's context menu still offers it.
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

  useEffect(() => {
    if (!project) return;

    setAvailableTasks(
      project.backlogSections
        .filter((section) => !collapsedSections[section.slug])
        .flatMap((section) => section.tasks.map((task) => task.id)),
    );
  }, [project, collapsedSections, setAvailableTasks]);

  useEffect(() => {
    clearFocus();
  }, [clearFocus]);

  const toggleSection = useCallback((sectionId: string) => {
    setCollapsedSections((prev) => ({
      ...prev,
      [sectionId]: !prev[sectionId],
    }));
  }, []);

  useTaskViewShortcuts({
    layout: "list",
    selection: useBacklogBulkSelectionStore,
    getGroups: () =>
      (project?.backlogSections ?? []).map((section) => ({
        id: section.slug,
        taskIds: section.tasks.map((task) => task.id),
        collapsed: Boolean(collapsedSections[section.slug]),
      })),
    project,
    enabled: activeId === null,
    onToggleGroup: toggleSection,
    onToggleAllGroups: () =>
      setCollapsedSections((prev) => {
        const slugs = (project?.backlogSections ?? []).map(
          (section) => section.slug,
        );
        const collapse = !slugs.every((slug) => prev[slug]);
        return Object.fromEntries(slugs.map((slug) => [slug, collapse]));
      }),
  });

  const handleAddTaskClick = useCallback((sectionId: string) => {
    setTaskModalStatus(sectionId);
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
          {project.backlogSections.map((section) => (
            <BacklogSection
              key={section.slug}
              section={section}
              columns={columns}
              projectId={project.id}
              projectSlug={project.slug ?? ""}
              isExpanded={!collapsedSections[section.slug]}
              isDropTarget={Boolean(activeId) && overSectionId === section.slug}
              canManage={canManageSections}
              onToggle={toggleSection}
              onAddTask={handleAddTaskClick}
            />
          ))}
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
        status={taskModalStatus}
      />

      <BacklogBulkToolbar />
    </DndContext>
  );
}

export default BacklogTableView;
