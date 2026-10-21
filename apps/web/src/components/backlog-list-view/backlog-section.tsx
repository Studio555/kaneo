import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronRight, Plus } from "lucide-react";
import { memo, useState } from "react";
import { useTranslation } from "react-i18next";
import { backlogSectionDropId } from "@/hooks/use-backlog-section-dnd";
import { getBacklogSectionLabel } from "@/lib/backlog-sections";
import { cn } from "@/lib/cn";
import { EASE_OUT } from "@/lib/motion";
import type { BacklogSection as BacklogSectionData } from "@/types/project";
import { BacklogSectionIcon } from "../backlog-sections/backlog-section-icon";
import { BacklogSectionMenu } from "../backlog-sections/backlog-section-menu";
import BacklogTaskRow from "./backlog-task-row";

const BacklogSection = memo(function BacklogSection({
  section,
  projectId,
  isExpanded,
  showDropIndicator,
  canManage,
  onToggle,
  onAddTask,
}: {
  section: BacklogSectionData;
  projectId: string;
  isExpanded: boolean;
  showDropIndicator: boolean;
  canManage: boolean;
  onToggle: (sectionId: string) => void;
  onAddTask: (sectionId: string) => void;
}) {
  const { t } = useTranslation();
  const [animateExpand, setAnimateExpand] = useState(false);
  const sectionId = section.slug;
  const title = getBacklogSectionLabel(section, t);
  const { tasks } = section;
  // The whole section is the drop target, header included, so a task can
  // still be dropped on a collapsed section.
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
        showDropIndicator && "border-l-4 border-l-ring bg-accent/35",
      )}
    >
      <div className="flex items-center justify-between py-2 px-4 bg-muted/60 border-b border-border/50">
        <button
          type="button"
          onClick={() => {
            setAnimateExpand(true);
            onToggle(sectionId);
          }}
          aria-expanded={isExpanded}
          className="touch-hitbox relative flex items-center gap-2 text-sm font-medium text-foreground hover:text-foreground transition-colors"
        >
          <ChevronRight
            className={cn(
              "w-3 h-3 transition-transform duration-150 ease-out",
              isExpanded && "rotate-90",
            )}
          />
          <div className="flex items-center gap-2 h-4">
            <BacklogSectionIcon
              section={section}
              className="w-4 h-4 flex-shrink-0 text-muted-foreground"
            />
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
              className="touch-hitbox relative p-1 hover:bg-accent rounded text-muted-foreground hover:text-foreground transition-colors"
              title={t("tasks:backlog.addTask")}
              aria-label={t("tasks:backlog.addTask")}
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
        <div
          className={cn(
            "bg-card",
            animateExpand &&
              "transition-[translate,opacity] duration-150 ease-out starting:-translate-y-1 starting:opacity-0 motion-reduce:starting:translate-y-0",
          )}
        >
          <SortableContext items={tasks} strategy={verticalListSortingStrategy}>
            <AnimatePresence initial={false} mode="popLayout">
              {tasks.map((task) => (
                <motion.div
                  key={task.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15, ease: EASE_OUT }}
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
});

export default BacklogSection;
