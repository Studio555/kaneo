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
import { ChevronRight, Flag, Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { priorityColorsTaskCard } from "@/constants/priority-colors";
import {
  backlogSectionDropId,
  useBacklogSectionDnd,
} from "@/hooks/use-backlog-section-dnd";
import { useRegisterShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import {
  getBacklogSectionIcon,
  getBacklogSectionLabel,
} from "@/lib/backlog-sections";
import { cn } from "@/lib/cn";
import useBacklogBulkSelectionStore from "@/store/backlog-bulk-selection";
import type {
  BacklogSection as BacklogSectionData,
  ProjectWithTasks,
} from "@/types/project";
import { BacklogSectionMenu } from "../backlog-sections/backlog-section-menu";
import BacklogBulkToolbar from "../bulk-selection/backlog-bulk-toolbar";
import CreateTaskModal from "../shared/modals/create-task-modal";
import BacklogTaskRow from "./backlog-task-row";

type BacklogListViewProps = {
  project?: ProjectWithTasks;
  disableDragDrop?: boolean;
};

type BacklogSectionProps = {
  section: BacklogSectionData;
  projectId: string;
  isExpanded: boolean;
  isDropTarget: boolean;
  canManage: boolean;
  onToggle: (sectionId: string) => void;
  onAddTask: (sectionId: string) => void;
};

// Module scope on purpose: nested inside BacklogListView this would be a new
// component type every render, remounting the section (and closing its menu's
// dialogs) whenever the board refetched or drag state changed.
function BacklogSection({
  section,
  projectId,
  isExpanded,
  isDropTarget,
  canManage,
  onToggle,
  onAddTask,
}: BacklogSectionProps) {
  const { t } = useTranslation();
  const sectionId = section.slug;
  const title = getBacklogSectionLabel(section, t);
  const IconComponent = getBacklogSectionIcon(section);
  const { tasks } = section;
  // The whole section is the drop target, header included, so a task can
  // still be dropped on a section that is collapsed.
  const { setNodeRef } = useDroppable({
    id: backlogSectionDropId(sectionId),
    data: {
      type: "column",
      column: { id: sectionId, name: title },
    },
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "border-b border-border/50 transition-colors duration-150 overflow-auto",
        isDropTarget && "border-l-4 border-l-ring bg-accent/35",
      )}
    >
      <div className="flex items-center justify-between py-2 px-4 bg-muted/60 border-b border-border/50">
        <button
          type="button"
          onClick={() => onToggle(sectionId)}
          className="flex items-center gap-2 text-sm font-medium text-foreground hover:text-foreground transition-colors"
        >
          <ChevronRight
            className={cn(
              "w-3 h-3 transition-transform",
              isExpanded && "rotate-90",
            )}
          />
          <div className="flex items-center gap-2 h-4">
            <IconComponent className="w-4 h-4 flex-shrink-0 text-muted-foreground" />
            <div className="flex items-center gap-1">
              <span className="mt-1 mr-1">{title}</span>
              <span className="text-xs text-muted-foreground mt-0.5">
                {tasks.length}
              </span>
            </div>
          </div>
        </button>

        <div className="flex items-center gap-1">
          {section.systemKey !== "archived" && (
            <button
              type="button"
              onClick={() => onAddTask(sectionId)}
              className="p-1 hover:bg-accent rounded text-muted-foreground hover:text-foreground transition-colors"
              title={t("tasks:backlog.addTask")}
            >
              <Plus className="w-3 h-3" />
            </button>
          )}
          {canManage && !section.systemKey && (
            <BacklogSectionMenu projectId={projectId} section={section} />
          )}
        </div>
      </div>

      {isExpanded && (
        <div className="bg-card transition-[translate,opacity] duration-150 ease-out starting:-translate-y-1 starting:opacity-0 motion-reduce:starting:translate-y-0">
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
                  <BacklogTaskRow task={task} />
                </motion.div>
              ))}
            </AnimatePresence>
          </SortableContext>

          {tasks.length === 0 && (
            <div className="py-6 px-4 text-center text-xs text-muted-foreground">
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

function BacklogListView({
  project,
  disableDragDrop = false,
}: BacklogListViewProps) {
  const {
    setAvailableTasks,
    focusNext,
    focusPrevious,
    focusedTaskId,
    clearFocus,
  } = useBacklogBulkSelectionStore();
  const navigate = useNavigate();
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
  const [activeColumn, setActiveColumn] = useState<string | null>(null);

  useEffect(() => {
    if (project) {
      setAvailableTasks(
        project.backlogSections
          .filter((section) => !collapsedSections[section.slug])
          .flatMap((section) => section.tasks.map((task) => task.id)),
      );
    }
  }, [project, collapsedSections, setAvailableTasks]);

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
    setCollapsedSections((prev) => ({
      ...prev,
      [sectionId]: !prev[sectionId],
    }));
  }, []);

  const handleAddTask = useCallback((sectionId: string) => {
    setActiveColumn(sectionId);
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
      <div className="w-full h-full overflow-auto bg-muted/20">
        <div className="divide-y divide-border/50">
          {project.backlogSections.map((section) => (
            <BacklogSection
              key={section.slug}
              section={section}
              projectId={project.id}
              isExpanded={!collapsedSections[section.slug]}
              isDropTarget={Boolean(activeId) && overSectionId === section.slug}
              canManage={canManageSections}
              onToggle={toggleSection}
              onAddTask={handleAddTask}
            />
          ))}
        </div>
      </div>

      <DragOverlay>
        {activeTask && (
          <div className="bg-card border border-border rounded-lg shadow-lg p-2 max-w-[200px] cursor-grabbing">
            <div className="flex items-center gap-2">
              <div className="flex-shrink-0">
                <Flag
                  className={cn(
                    "w-3 h-3",
                    priorityColorsTaskCard[
                      activeTask.priority as keyof typeof priorityColorsTaskCard
                    ],
                  )}
                />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-mono text-muted-foreground">
                    {project?.slug}-{activeTask.number}
                  </span>
                  <span className="text-xs text-foreground truncate">
                    {activeTask.title}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
      </DragOverlay>

      <CreateTaskModal
        open={isTaskModalOpen}
        projectId={project?.id}
        onClose={() => setIsTaskModalOpen(false)}
        status={activeColumn ?? "planned"}
      />

      <BacklogBulkToolbar />
    </DndContext>
  );
}

export default BacklogListView;
