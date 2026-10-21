import { closestCorners, DndContext, DragOverlay } from "@dnd-kit/core";
import { snapCenterToCursor } from "@dnd-kit/modifiers";
import { Flag } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { priorityColorsTaskCard } from "@/constants/priority-colors";
import { useTaskViewShortcuts } from "@/components/project/task-view-keys/use-task-view-shortcuts";
import { useBacklogSectionDnd } from "@/hooks/use-backlog-section-dnd";
import { useCollapsedSections } from "@/hooks/use-collapsed-sections";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { cn } from "@/lib/cn";
import useBacklogBulkSelectionStore from "@/store/backlog-bulk-selection";
import type { ProjectWithTasks } from "@/types/project";
import BacklogBulkToolbar from "../bulk-selection/backlog-bulk-toolbar";
import CreateTaskModal from "../shared/modals/create-task-modal";
import BacklogSection from "./backlog-section";

type BacklogListViewProps = {
  project?: ProjectWithTasks;
  disableDragDrop?: boolean;
};

function BacklogListView({
  project,
  disableDragDrop = false,
}: BacklogListViewProps) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  const setAvailableTasks = useBacklogBulkSelectionStore(
    (state) => state.setAvailableTasks,
  );
  const clearFocus = useBacklogBulkSelectionStore((state) => state.clearFocus);
  const {
    sensors,
    activeId,
    activeTask,
    overSectionId,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleDragCancel,
    moveTask,
  } = useBacklogSectionDnd(project, {
    disabled: disableDragDrop,
    keyboard: false,
  });
  const { canUpdateProjects } = useWorkspacePermission();
  const canManageSections = canUpdateProjects();
  const { isExpanded, toggleSection, toggleAllSections } = useCollapsedSections(
    project?.id,
    "backlog",
  );
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [activeColumn, setActiveColumn] = useState<string | null>(null);
  const sections = project?.backlogSections ?? [];

  useEffect(() => {
    if (project) {
      setAvailableTasks(
        project.backlogSections
          .filter((section) => isExpanded(section.slug))
          .flatMap((section) => section.tasks.map((task) => task.id)),
      );
    }
  }, [project, isExpanded, setAvailableTasks]);

  useEffect(() => {
    clearFocus();
  }, [clearFocus]);

  useTaskViewShortcuts({
    layout: "list",
    selection: useBacklogBulkSelectionStore,
    getGroups: () =>
      sections.map((section) => ({
        id: section.slug,
        taskIds: section.tasks.map((task) => task.id),
        collapsed: !isExpanded(section.slug),
      })),
    project,
    enabled: activeId === null,
    canMove: !disableDragDrop,
    onMove: moveTask,
    onToggleGroup: toggleSection,
    onToggleAllGroups: () =>
      toggleAllSections(sections.map((section) => section.slug)),
  });

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
      accessibility={{
        screenReaderInstructions: {
          draggable: t("tasks:board.keyboardInstructions"),
        },
      }}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
      modifiers={[snapCenterToCursor]}
    >
      <div className="w-full h-full overflow-auto bg-muted/20">
        <div className="divide-y divide-border/50">
          {sections.map((section) => (
            <BacklogSection
              key={section.slug}
              section={section}
              projectId={project.id}
              isExpanded={isExpanded(section.slug)}
              showDropIndicator={
                activeId !== null && overSectionId === section.slug
              }
              canManage={canManageSections}
              onToggle={toggleSection}
              onAddTask={handleAddTask}
            />
          ))}
        </div>
      </div>

      <DragOverlay dropAnimation={reduceMotion ? null : undefined}>
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
