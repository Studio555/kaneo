import { useRestoreTaskFocus } from "@/components/project/task-view-keys/use-restore-task-focus";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useNavigate } from "@tanstack/react-router";
import { format } from "date-fns";
import { Calendar, CalendarClock, CalendarX, ChevronRight } from "lucide-react";
import { type CSSProperties, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useDeleteTask } from "@/hooks/mutations/task/use-delete-task";
import { useGetColumns } from "@/hooks/queries/column/use-get-columns";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useGetActiveWorkspaceUsers } from "@/hooks/queries/workspace-users/use-get-active-workspace-users";
import { cn } from "@/lib/cn";
import { getColumnIcon } from "@/lib/column";
import {
  dueDateStatusColors,
  getDueDateStatus,
  isTaskCompleted,
} from "@/lib/due-date-status";
import { getInitials } from "@/lib/get-initials";
import { isKeyboardFocus } from "@/lib/is-keyboard-focus";
import { getPriorityLabel, getStatusDisplayLabel } from "@/lib/i18n/domain";
import { getPriorityIcon } from "@/lib/priority";
import { toast } from "@/lib/toast";
import useBulkSelectionStore from "@/store/bulk-selection";
import { useUserPreferencesStore } from "@/store/user-preferences";
import type Task from "@/types/task";
import TaskCardContextMenuContent from "../kanban-board/task-card-context-menu/task-card-context-menu-content";
import { TaskCraft } from "../kanban-board/task-craft";
import { TaskLabels } from "../kanban-board/task-labels";
import TaskAssigneePopover from "../task/task-assignee-popover";
import TaskCraftPopover from "../task/task-craft-popover";
import TaskDueDatePopover from "../task/task-due-date-popover";
import TaskLabelsPopover from "../task/task-labels-popover";
import TaskPriorityPopover from "../task/task-priority-popover";
import TaskStatusPopover from "../task/task-status-popover";
import { ContextMenu, ContextMenuTrigger } from "../ui/context-menu";
import { getTableGridTemplate, type TableColumn } from "./columns";

type TaskTableRowProps = {
  task: Task;
  projectSlug: string;
  columns: TableColumn[];
  /** Nesting level; 0 for a task shown in its own status group. */
  depth?: number;
  /**
   * Identifies the row rather than the task: a task with several parents is
   * rendered under each, so the task id is not unique and cannot be the drag
   * identity.
   */
  rowId?: string;
  childCount?: number;
  isExpanded?: boolean;
  onToggleExpanded?: () => void;
  /**
   * Keeps the toggle slot on rows without a toggle, so titles in a group that
   * has subtasks stay on one vertical line.
   */
  reserveToggleSpace?: boolean;
  /** True while this task is being dragged from another of its rows. */
  isTaskDragging?: boolean;
  /** The backlog keeps its own selection, apart from the board's. */
  selectionStore?: typeof useBulkSelectionStore;
};

/**
 * A cell whose whole area opens a property picker. Rest props must be spread and
 * the handlers composed: the popover trigger injects its own onClick, ref and
 * aria state through asChild, and dropping them would leave the cell inert.
 * The click is stopped from bubbling so editing a property does not also open
 * the task detail sheet.
 */
function CellTrigger({
  children,
  className,
  onClick,
  onPointerDown,
  ...props
}: React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      {...props}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.(event);
      }}
      onPointerDown={(event) => {
        event.stopPropagation();
        onPointerDown?.(event);
      }}
      className={cn(
        "flex h-7 w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 text-left text-xs text-foreground transition-colors hover:bg-accent/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        className,
      )}
    >
      {children}
    </button>
  );
}

function TaskTableRow({
  task,
  projectSlug,
  columns,
  depth = 0,
  rowId,
  childCount = 0,
  isExpanded = false,
  onToggleExpanded,
  reserveToggleSpace = false,
  isTaskDragging = false,
  selectionStore = useBulkSelectionStore,
}: TaskTableRowProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // Only top-level rows are drag sources. A nested row is not in the
  // SortableContext, and one task may be nested under several parents.
  const isNested = depth > 0;
  const showToggleSlot = isNested || childCount > 0 || reserveToggleSpace;
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: rowId ?? task.id, disabled: isNested });

  const { data: workspace } = useActiveWorkspace();
  const { data: projectColumns = [] } = useGetColumns(task.projectId);
  const { showTaskNumbers } = useUserPreferencesStore();
  const [isDeleteTaskModalOpen, setIsDeleteTaskModalOpen] = useState(false);
  const [isLabelPickerMounted, setIsLabelPickerMounted] = useState(false);
  const { mutateAsync: deleteTask } = useDeleteTask();
  const toggleSelection = selectionStore((state) => state.toggleSelection);
  const setFocusedTask = selectionStore((state) => state.setFocusedTask);
  useRestoreTaskFocus(task.id, selectionStore);
  const isTaskSelected = selectionStore((state) =>
    state.selectedTaskIds.has(task.id),
  );
  const isTaskFocused = selectionStore(
    (state) => state.focusedTaskId === task.id,
  );

  const { data: workspaceUsers } = useGetActiveWorkspaceUsers(
    workspace?.id ?? "",
  );

  const assignee = useMemo(
    () =>
      workspaceUsers?.members?.find((member) => member.userId === task.userId),
    [workspaceUsers, task.userId],
  );

  const statusColumn = useMemo(
    () => projectColumns.find((column) => column.slug === task.status),
    [projectColumns, task.status],
  );

  const taskIsCompleted = isTaskCompleted(task.status, projectColumns);
  const dueDateStatus = getDueDateStatus(task.dueDate, taskIsCompleted);

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: transition || "transform 200ms cubic-bezier(0.23, 1, 0.32, 1)",
    touchAction: isDragging ? "none" : "auto",
  };

  const handleClick = (e: React.MouseEvent) => {
    if (e.defaultPrevented) return;

    if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      toggleSelection(task.id);
      return;
    }

    const currentParams = new URLSearchParams(window.location.search);

    if (currentParams.get("taskId") === task.id) {
      navigate({ to: ".", search: {} });
    } else {
      navigate({ to: ".", search: { taskId: task.id } });
    }
  };

  // Enter opens the task, so it must not reach dnd-kit's keyboard activator.
  // Every other key is forwarded, keeping Space-to-lift and the arrow keys.
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleClick(e as unknown as React.MouseEvent);
      return;
    }
    // A nested row has no drag to start, so Space opens it like a button.
    if (isNested) {
      if (e.key === " ") {
        handleClick(e as unknown as React.MouseEvent);
        e.preventDefault();
      }
      return;
    }
    listeners?.onKeyDown?.(e);
  };

  const handleDeleteTask = async () => {
    try {
      await deleteTask(task.id);
      toast.success(t("tasks:delete.success"));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("tasks:delete.error"),
      );
    }
  };

  const renderCell = (column: TableColumn) => {
    switch (column.key) {
      case "name":
        return (
          <div className="flex min-w-0 items-center gap-2 px-1.5">
            {showToggleSlot && (
              <span className="flex shrink-0 items-center">
                {isNested && (
                  <span
                    aria-hidden="true"
                    className="shrink-0"
                    // Capped so a deep chain cannot push the title out of
                    // the cell; the chevrons still convey the nesting.
                    style={{ width: `${Math.min(depth, 6) * 1.25}rem` }}
                  />
                )}
                {childCount > 0 ? (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggleExpanded?.();
                    }}
                    onPointerDown={(event) => event.stopPropagation()}
                    onKeyDown={(event) => event.stopPropagation()}
                    aria-expanded={isExpanded}
                    aria-label={
                      isExpanded
                        ? t("tasks:listView.collapseSubtasks", {
                            title: task.title,
                          })
                        : t("tasks:listView.expandSubtasks", {
                            title: task.title,
                          })
                    }
                    className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    <ChevronRight
                      className={cn(
                        "size-3 transition-transform",
                        isExpanded && "rotate-90",
                      )}
                    />
                  </button>
                ) : (
                  <span aria-hidden="true" className="w-5 shrink-0" />
                )}
              </span>
            )}
            {isNested && (
              <span className="sr-only">
                {t("tasks:listView.subtaskLevel", { level: depth })}
              </span>
            )}
            {showTaskNumbers && (
              <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                {projectSlug}-{task.number}
              </span>
            )}
            <span className="truncate text-sm text-foreground">
              {task.title}
            </span>
          </div>
        );

      case "status":
        return (
          <TaskStatusPopover task={task}>
            <CellTrigger>
              <span className="flex size-4 shrink-0 items-center justify-center">
                {getColumnIcon(
                  task.status,
                  statusColumn?.isFinal,
                  statusColumn?.icon,
                )}
              </span>
              <span className="truncate">
                {getStatusDisplayLabel(task.status, statusColumn?.name)}
              </span>
            </CellTrigger>
          </TaskStatusPopover>
        );

      case "assignee":
        return (
          <TaskAssigneePopover task={task} workspaceId={workspace?.id ?? ""}>
            <CellTrigger>
              {task.userId ? (
                <>
                  <Avatar className="size-5 shrink-0">
                    <AvatarImage
                      src={assignee?.user?.image ?? ""}
                      alt={assignee?.user?.name || ""}
                    />
                    <AvatarFallback className="border border-border/30 text-[9px] font-medium">
                      {getInitials(assignee?.user?.name ?? task.assigneeName)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="truncate">
                    {assignee?.user?.name ??
                      task.assigneeName ??
                      t("common:people.unknown")}
                  </span>
                </>
              ) : (
                <>
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-[9px] font-medium text-muted-foreground">
                    ?
                  </span>
                  <span className="truncate text-muted-foreground">
                    {t("tasks:assignee.unassigned")}
                  </span>
                </>
              )}
            </CellTrigger>
          </TaskAssigneePopover>
        );

      case "priority":
        return (
          <TaskPriorityPopover task={task}>
            <CellTrigger>
              <span className="flex size-4 shrink-0 items-center justify-center [&>svg]:size-4">
                {getPriorityIcon(task.priority ?? "no-priority")}
              </span>
              <span className="truncate">
                {getPriorityLabel(task.priority ?? "no-priority")}
              </span>
            </CellTrigger>
          </TaskPriorityPopover>
        );

      case "dueDate":
        return (
          <TaskDueDatePopover task={task}>
            <CellTrigger>
              {task.dueDate ? (
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px]",
                    dueDateStatusColors[dueDateStatus],
                  )}
                >
                  {dueDateStatus === "overdue" ? (
                    <CalendarX className="size-3" />
                  ) : dueDateStatus === "due-soon" ? (
                    <CalendarClock className="size-3" />
                  ) : (
                    <Calendar className="size-3" />
                  )}
                  {format(new Date(task.dueDate), "MMM d")}
                </span>
              ) : (
                <span className="truncate text-muted-foreground">
                  {t("tasks:properties.noDate")}
                </span>
              )}
            </CellTrigger>
          </TaskDueDatePopover>
        );

      case "craft":
        return (
          <TaskCraftPopover task={task} workspaceId={workspace?.id ?? ""}>
            <CellTrigger>
              {task.craft ? (
                <TaskCraft craft={task.craft} />
              ) : (
                <span className="truncate text-muted-foreground">
                  {t("tasks:popover.craft.none")}
                </span>
              )}
            </CellTrigger>
          </TaskCraftPopover>
        );

      case "labels": {
        const labelsCell = task.labels?.length ? (
          <TaskLabels labels={task.labels} />
        ) : (
          <span className="truncate text-muted-foreground">
            {t("tasks:table.addLabel")}
          </span>
        );

        // The picker fetches this task's labels on mount, so mounting one per
        // row would fire a request per task on every table load. It stays out
        // of the tree until the cell is actually used; the labels already on
        // `task` are enough to render the cell.
        if (!isLabelPickerMounted) {
          return (
            <CellTrigger onClick={() => setIsLabelPickerMounted(true)}>
              {labelsCell}
            </CellTrigger>
          );
        }

        return (
          <TaskLabelsPopover
            task={task}
            workspaceId={workspace?.id ?? ""}
            defaultOpen
          >
            <CellTrigger>{labelsCell}</CellTrigger>
          </TaskLabelsPopover>
        );
      }

      default:
        return null;
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "border-b border-border/50 transition-colors duration-150",
        (isDragging || isTaskDragging) && "opacity-50",
        isTaskSelected &&
          "bg-accent/60 shadow-sm ring-1 ring-inset ring-ring/30",
        isTaskFocused && "ring-2 ring-inset ring-ring/50",
      )}
    >
      <ContextMenu>
        <ContextMenuTrigger asChild>
          {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- mirrors the list view row, which is clickable to open the task */}
          <div
            style={{ gridTemplateColumns: getTableGridTemplate(columns) }}
            className={cn(
              "group grid cursor-pointer items-center gap-2 px-2 py-1 transition-colors",
              isTaskSelected ? "bg-accent/45" : "hover:bg-accent/60",
            )}
            // A nested row keeps button semantics but none of dnd-kit's
            // attributes, which would mark it aria-disabled.
            {...(isNested
              ? { role: "button" as const, tabIndex: 0 }
              : { ...attributes, ...listeners })}
            data-task-id={task.id}
            data-shortcut-surface
            onClick={handleClick}
            onKeyDown={handleKeyDown}
            onFocus={(event) => {
              if (event.target !== event.currentTarget) return;
              setFocusedTask(isKeyboardFocus(event) ? task.id : null);
            }}
          >
            {columns.map((column) => (
              <div
                key={column.key}
                data-column={column.key}
                className="min-w-0"
              >
                {renderCell(column)}
              </div>
            ))}
          </div>
        </ContextMenuTrigger>

        {workspace && (
          <TaskCardContextMenuContent
            task={task}
            taskCardContext={{
              projectId: task.projectId,
              worskpaceId: workspace.id,
            }}
            onDeleteClick={() => setIsDeleteTaskModalOpen(true)}
          />
        )}
      </ContextMenu>

      <AlertDialog
        open={isDeleteTaskModalOpen}
        onOpenChange={setIsDeleteTaskModalOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("tasks:delete.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("tasks:delete.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" size="sm" />}>
              {t("common:actions.cancel")}
            </AlertDialogClose>
            <AlertDialogClose
              render={
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleDeleteTask}
                />
              }
            >
              {t("tasks:delete.action")}
            </AlertDialogClose>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default TaskTableRow;
