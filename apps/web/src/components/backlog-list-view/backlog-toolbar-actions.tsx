import { ArrowRight, Layers, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type BacklogToolbarActionsProps = {
  onPlan: () => void;
  onMoveAll: () => void;
  /** Present only for people who can manage backlog sections. */
  onAddSection?: () => void;
};

export function BacklogToolbarActions({
  onPlan,
  onMoveAll,
  onAddSection,
}: BacklogToolbarActionsProps) {
  const { t } = useTranslation();
  const planLabel = t("tasks:backlog.plan");
  const moveAllLabel = t("tasks:backlog.moveAllTooltip");
  const addSectionLabel = t("tasks:backlog.sectionActions.addTooltip");

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={planLabel}
              onClick={onPlan}
            />
          }
        >
          <Plus />
        </TooltipTrigger>
        <TooltipContent>{planLabel}</TooltipContent>
      </Tooltip>
      {onAddSection && (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={addSectionLabel}
                onClick={onAddSection}
              />
            }
          >
            <Layers />
          </TooltipTrigger>
          <TooltipContent>{addSectionLabel}</TooltipContent>
        </Tooltip>
      )}
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={moveAllLabel}
              onClick={onMoveAll}
            />
          }
        >
          <ArrowRight />
        </TooltipTrigger>
        <TooltipContent>{moveAllLabel}</TooltipContent>
      </Tooltip>
    </>
  );
}
