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
import { produce } from "immer";
import { Archive, ChevronRight, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useTaskViewShortcuts } from "@/components/project/task-view-keys/use-task-view-shortcuts";
import { useUpdateTask } from "@/hooks/mutations/task/use-update-task";
import useGetProjectTaskRelations from "@/hooks/queries/task-relation/use-get-project-task-relations";
import { useShowDueDates } from "@/hooks/use-dates-enabled";
import { useTaskColumnDnd } from "@/hooks/use-task-column-dnd";
import { cn } from "@/lib/cn";
import { getColumnIcon } from "@/lib/column";
import {
  readExpandedRows,
  writeExpandedRows,
} from "@/lib/expanded-rows-storage";
import type { SortConfig } from "@/lib/sort-tasks";
import {
  buildSubtaskChildren,
  findNestedTaskIds,
  flattenSubtaskRows,
} from "@/lib/subtask-tree";
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

type Task = ProjectWithTasks["columns"][number]["tasks"][number];

type SubtaskTree = {
  children: Map<string, string[]>;
  tasksById: Map<string, Task>;
  nestedTaskIds: Set<string>;
  expandedRows: Record<string, boolean>;
  onToggleRow: (rowId: string) => void;
  /** Relations still loading: hold the toggle slot so titles do not shift. */
  isLoading: boolean;
};

type ColumnSectionProps = {
  column: ProjectWithTasks["columns"][number];
  columns: TableColumn[];
  projectSlug: string;
  isExpanded: boolean;
  isDropTarget: boolean;
  activeTaskId: string | null;
  subtaskTree: SubtaskTree;
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
  activeTaskId,
  subtaskTree,
  onToggle,
  onAddTask,
  onArchive,
}: ColumnSectionProps) {
  const { t } = useTranslation();

  const rows = flattenSubtaskRows({
    tasks: column.tasks,
    children: subtaskTree.children,
    tasksById: subtaskTree.tasksById,
    nestedTaskIds: subtaskTree.nestedTaskIds,
    // Nothing stays expanded during a drag: nested rows are not sortable, so
    // they would stay put while the rows around them moved.
    isExpanded: (rowId) =>
      !activeTaskId && Boolean(subtaskTree.expandedRows[rowId]),
  });

  // A subtask renders under its parent instead of in its own group, so the
  // group counts and sorts only the rows that are its own.
  const topLevelTasks = rows
    .filter((row) => row.depth === 0)
    .map((row) => row.task);

  const groupHasSubtasks =
    subtaskTree.isLoading ||
    rows.some((row) => row.childCount > 0 || row.depth > 0);
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
                {topLevelTasks.length}
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
            items={topLevelTasks}
            strategy={verticalListSortingStrategy}
          >
            <AnimatePresence initial={false} mode="popLayout">
              {rows.map((row) => (
                <motion.div
                  key={row.rowId}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15, ease: [0.23, 1, 0.32, 1] }}
                >
                  <TaskTableRow
                    task={row.task}
                    projectSlug={projectSlug}
                    columns={columns}
                    depth={row.depth}
                    rowId={row.rowId}
                    childCount={row.childCount}
                    isExpanded={row.isExpanded}
                    onToggleExpanded={() => subtaskTree.onToggleRow(row.rowId)}
                    reserveToggleSpace={groupHasSubtasks}
                    isTaskDragging={activeTaskId === row.task.id}
                  />
                </motion.div>
              ))}
            </AnimatePresence>
          </SortableContext>

          {rows.length === 0 && (
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
  const setAvailableTasks = useBulkSelectionStore(
    (state) => state.setAvailableTasks,
  );
  const clearFocus = useBulkSelectionStore((state) => state.clearFocus);
  const { mutate: updateTask } = useUpdateTask();
  const { showAssignees, showLabels, showPriority } = useUserPreferencesStore();
  const showDueDates = useShowDueDates();
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

  // isLoading rather than isPending: a disabled query is also pending.
  const { data: relations, isLoading: relationsLoading } =
    useGetProjectTaskRelations(project?.id ?? "");

  const subtaskChildren = useMemo(
    () => buildSubtaskChildren(relations ?? []),
    [relations],
  );

  const tasksById = useMemo(() => {
    const index = new Map<string, Task>();
    for (const column of project?.columns ?? []) {
      for (const task of column.tasks) {
        index.set(task.id, task);
      }
    }
    return index;
  }, [project?.columns]);

  const nestedTaskIds = useMemo(
    () => findNestedTaskIds(subtaskChildren, tasksById),
    [subtaskChildren, tasksById],
  );

  // Shared with the list view through the same per-project storage key, so a
  // parent opened in one view is open in the other.
  const projectId = project?.id ?? "";
  const [expandedRows, setExpandedRows] = useState(() => ({
    projectId,
    rows: readExpandedRows(projectId),
  }));

  // The route swaps this component's project rather than remounting it.
  if (expandedRows.projectId !== projectId) {
    setExpandedRows({ projectId, rows: readExpandedRows(projectId) });
  }

  useEffect(() => {
    writeExpandedRows(expandedRows.projectId, expandedRows.rows);
  }, [expandedRows]);

  const toggleRow = useCallback((rowId: string) => {
    setExpandedRows((previous) => ({
      ...previous,
      rows: { ...previous.rows, [rowId]: !previous.rows[rowId] },
    }));
  }, []);

  const subtaskTree = useMemo<SubtaskTree>(
    () => ({
      children: subtaskChildren,
      tasksById,
      nestedTaskIds,
      expandedRows: expandedRows.rows,
      onToggleRow: toggleRow,
      isLoading: relationsLoading,
    }),
    [
      subtaskChildren,
      tasksById,
      nestedTaskIds,
      expandedRows.rows,
      toggleRow,
      relationsLoading,
    ],
  );

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

  const toggleSection = useCallback((sectionId: string) => {
    setExpandedSections((prev) => ({
      ...prev,
      [sectionId]: !prev[sectionId],
    }));
  }, []);

  useTaskViewShortcuts({
    layout: "list",
    selection: useBulkSelectionStore,
    getGroups: () =>
      project.columns.map((column) => ({
        id: column.id,
        taskIds: column.tasks
          .filter((task) => !nestedTaskIds.has(task.id))
          .map((task) => task.id),
        collapsed: !expandedSections[column.id],
      })),
    project,
    enabled: activeId === null,
    onToggleGroup: toggleSection,
    onToggleAllGroups: () =>
      setExpandedSections((prev) => {
        const expand = project.columns.every((column) => !prev[column.id]);
        return Object.fromEntries(
          project.columns.map((column) => [column.id, expand]),
        );
      }),
  });

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
              activeTaskId={activeId ? activeId.toString() : null}
              subtaskTree={subtaskTree}
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
