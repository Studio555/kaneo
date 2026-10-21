import { useRestoreTaskFocus } from "@/components/project/task-view-keys/use-restore-task-focus";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useNavigate } from "@tanstack/react-router";
import { ChevronRight, Trash2Icon } from "lucide-react";
import { type CSSProperties, useMemo, useState, memo } from "react";
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
import { Button } from "@/components/ui/button";
import { useDeleteTask } from "@/hooks/mutations/task/use-delete-task";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useGetActiveWorkspaceUsers } from "@/hooks/queries/workspace-users/use-get-active-workspace-users";
import { useTaskHoverPrefetch } from "@/hooks/use-task-hover-prefetch";
import { cn } from "@/lib/cn";
import { isKeyboardFocus } from "@/lib/is-keyboard-focus";
import { isOwnDomEvent } from "@/lib/is-own-dom-event";
import { isTaskCompleted } from "@/lib/due-date-status";
import { toast } from "@/lib/toast";
import useBulkSelectionStore from "@/store/bulk-selection";
import useProjectStore from "@/store/project";
import type Task from "@/types/task";
import TaskCardContextMenuContent from "../kanban-board/task-card-context-menu/task-card-context-menu-content";
import { ContextMenu, ContextMenuTrigger } from "../ui/context-menu";
import { TaskRowBody } from "./task-row-body";
import { EASE_OUT_CSS } from "@/lib/motion";

type TaskRowProps = {
  task: Task;
  projectSlug: string;
  /** Nesting level; 0 for a task shown in its own status group. */
  depth?: number;
  /** Unique per rendered row; a task with several parents repeats. */
  rowId?: string;
  childCount?: number;
  isExpanded?: boolean;
  onToggleExpanded?: (rowId: string) => void;
  /** Keeps the toggle column on childless rows so titles stay aligned. */
  reserveToggleSpace?: boolean;
  /** True while this task is dragged from another of its rows. */
  isTaskDragging?: boolean;
};

function TaskRow({
  task,
  projectSlug,
  depth = 0,
  rowId,
  childCount = 0,
  isExpanded = false,
  onToggleExpanded,
  reserveToggleSpace = false,
  isTaskDragging = false,
}: TaskRowProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const showToggleColumn = depth > 0 || childCount > 0 || reserveToggleSpace;
  // Only the top-level row is a drag source; a nested repeat shares its task
  // id with that row and would register the same drag identity twice.
  const isNestedRepeat = depth > 0;
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: rowId ?? task.id,
    disabled: isNestedRepeat,
    transition: { duration: 200, easing: EASE_OUT_CSS },
  });

  const { project } = useProjectStore();
  const taskIsCompleted = isTaskCompleted(task.status, project?.columns);
  const { data: workspace } = useActiveWorkspace();
  const [isDeleteTaskModalOpen, setIsDeleteTaskModalOpen] = useState<
    boolean | null
  >(null);
  const [hasOpenedMenu, setHasOpenedMenu] = useState(false);
  const { mutateAsync: deleteTask } = useDeleteTask();
  const toggleSelection = useBulkSelectionStore(
    (state) => state.toggleSelection,
  );
  const selectRange = useBulkSelectionStore((state) => state.selectRange);
  const setFocusedTask = useBulkSelectionStore((state) => state.setFocusedTask);
  useRestoreTaskFocus(task.id, useBulkSelectionStore);
  const setSelectionAnchor = useBulkSelectionStore(
    (state) => state.setSelectionAnchor,
  );
  const isTaskSelected = useBulkSelectionStore((state) =>
    state.selectedTaskIds.has(task.id),
  );
  const isTaskFocused = useBulkSelectionStore(
    (state) => state.focusedTaskId === task.id,
  );

  const hoverPrefetch = useTaskHoverPrefetch(task.id);
  const { data: workspaceUsers } = useGetActiveWorkspaceUsers(
    workspace?.id ?? "",
  );

  const assignee = useMemo(() => {
    return workspaceUsers?.members?.find(
      (member) => member.userId === task.userId,
    );
  }, [workspaceUsers, task.userId]);

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: transition || `transform 200ms ${EASE_OUT_CSS}`,
    touchAction: isDragging ? "none" : "auto",
  };

  const handleClick = (e: React.MouseEvent) => {
    if (!project || !task || !isOwnDomEvent(e)) return;
    if (e.defaultPrevented) return;

    if (e.shiftKey) {
      e.preventDefault();
      selectRange(task.id);
      return;
    }

    if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      toggleSelection(task.id);
      return;
    }

    setSelectionAnchor(task.id);
    const currentParams = new URLSearchParams(window.location.search);
    const currentTaskId = currentParams.get("taskId");

    if (currentTaskId === task.id) {
      navigate({
        to: ".",
        search: {},
      });
    } else {
      navigate({
        to: ".",
        search: { taskId: task.id },
      });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.defaultPrevented || e.target !== e.currentTarget) return;
    if (e.key === "Enter" && e.shiftKey) {
      e.preventDefault();
      selectRange(task.id);
    }
  };

  const handleDeleteTask = async () => {
    try {
      await deleteTask(task.id);
      toast.success(t("tasks:delete.success"), { icon: Trash2Icon });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("tasks:delete.error"),
      );
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-kaneo-sortable
      className={cn(
        // The toggle sits beside the draggable region, not inside it: dnd-kit
        // gives its activator role="button", and nested buttons are ambiguous.
        "group/row flex items-stretch border-b border-border/50 transition-colors duration-150",
        (isDragging || isTaskDragging) && "opacity-50",
        isTaskSelected &&
          "bg-accent/60 shadow-sm ring-1 ring-inset ring-ring/30",
        isTaskFocused && "ring-1 ring-board-card-focus ring-inset",
      )}
    >
      {showToggleColumn && (
        <div
          className={cn(
            "flex shrink-0 items-center pl-3.5",
            isTaskSelected ? "bg-accent/45" : "group-hover/row:bg-accent/60",
          )}
        >
          {depth > 0 && (
            <span
              aria-hidden="true"
              className="shrink-0"
              // Capped so a deep chain cannot push the title off the row.
              style={{ width: `${Math.min(depth, 6) * 1.25}rem` }}
            />
          )}
          {childCount > 0 ? (
            <button
              type="button"
              onClick={() => onToggleExpanded?.(rowId ?? task.id)}
              aria-expanded={isExpanded}
              aria-label={
                isExpanded
                  ? t("tasks:listView.collapseSubtasks", { title: task.title })
                  : t("tasks:listView.expandSubtasks", { title: task.title })
              }
              className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
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
        </div>
      )}

      <ContextMenu
        onOpenChange={(open) => {
          if (open) setHasOpenedMenu(true);
        }}
      >
        <ContextMenuTrigger asChild>
          {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- false positive for onClick and onKeyDown */}
          <div
            onClick={handleClick}
            className={cn(
              "group relative flex h-10 min-w-0 flex-1 cursor-pointer items-center gap-3 outline-none transition-colors",
              showToggleColumn ? "pr-3.5 pl-1.5" : "px-3.5",
              isTaskSelected ? "bg-accent/45" : "group-hover/row:bg-accent/60",
            )}
            data-task-id={task.id}
            data-shortcut-surface
            // A repeat still opens its task, so it keeps button semantics but
            // not dnd-kit's attributes, whose aria-disabled would mislead.
            {...(isNestedRepeat
              ? { role: "button" as const, tabIndex: 0 }
              : { ...attributes, ...listeners })}
            {...hoverPrefetch}
            onKeyDown={handleKeyDown}
            onFocus={(event) => {
              if (event.target !== event.currentTarget) return;
              setFocusedTask(isKeyboardFocus(event) ? task.id : null);
            }}
          >
            {isNestedRepeat && (
              // The indent is decorative; this joins the row's accessible name.
              <span className="sr-only">
                {t("tasks:listView.subtaskLevel", { level: depth })}
              </span>
            )}
            <TaskRowBody
              task={task}
              projectSlug={projectSlug}
              workspaceId={workspace?.id ?? ""}
              isCompleted={taskIsCompleted}
              assigneeName={assignee?.user?.name ?? task.assigneeName}
              assigneeImage={assignee?.user?.image}
            />
          </div>
        </ContextMenuTrigger>

        {hasOpenedMenu && project && workspace && (
          <TaskCardContextMenuContent
            task={task}
            taskCardContext={{
              projectId: project.id,
              worskpaceId: workspace.id,
              workspaceSlug: workspace.slug,
            }}
            onDeleteClick={() => setIsDeleteTaskModalOpen(true)}
          />
        )}
      </ContextMenu>

      {isDeleteTaskModalOpen !== null && (
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
      )}
    </div>
  );
}

export default memo(TaskRow);
