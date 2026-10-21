import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { OptionMenu } from "@/components/common/option-menu/option-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useUpdateTaskCraft } from "@/hooks/mutations/task/use-update-task-craft";
import useGetCraftsByWorkspace from "@/hooks/queries/craft/use-get-crafts-by-workspace";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { resolveLabelColor } from "@/lib/label-color";
import { toast } from "@/lib/toast";
import type Task from "@/types/task";

const NO_CRAFT = ":none";

type TaskCraftPopoverProps = {
  task: Task;
  workspaceId: string;
  children: React.ReactNode;
};

export default function TaskCraftPopover({
  task,
  workspaceId,
  children,
}: TaskCraftPopoverProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { mutateAsync: updateTaskCraft } = useUpdateTaskCraft();
  const { canUpdateTasks } = useWorkspacePermission();
  const canEdit = canUpdateTasks();

  const { data: crafts = [] } = useGetCraftsByWorkspace(workspaceId);

  const currentCraftId = task.craft?.id ?? task.craftId ?? null;

  const handleCraftChange = useCallback(
    async (craftId: string | null) => {
      try {
        await updateTaskCraft({
          taskId: task.id,
          craftId,
          projectId: task.projectId,
        });
        setOpen(false);
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : t("tasks:popover.craft.updateError"),
        );
      }
    },
    [t, task.id, task.projectId, updateTaskCraft],
  );

  // Read-only role: render the trigger child as a plain element so the user
  // still sees the current craft but can't open the popover.
  if (!canEdit) return <>{children}</>;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-60 p-0" align="start">
        {crafts.length === 0 ? (
          <p className="px-3 py-2.5 text-sm text-muted-foreground">
            {t("tasks:popover.craft.empty")}
          </p>
        ) : (
          <OptionMenu
            label={t("tasks:properties.craft")}
            placeholder={t("tasks:popover.craft.searchPlaceholder")}
            options={[
              ...crafts.map((craft) => ({
                value: craft.id,
                label: craft.name,
                icon: (
                  <span
                    aria-hidden="true"
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: resolveLabelColor(craft.color) }}
                  />
                ),
                selected: currentCraftId === craft.id,
              })),
              {
                value: NO_CRAFT,
                label: t("tasks:popover.craft.none"),
                selected: currentCraftId === null,
                pinned: true,
              },
            ]}
            onSelect={(value) =>
              handleCraftChange(value === NO_CRAFT ? null : value)
            }
          />
        )}
      </PopoverContent>
    </Popover>
  );
}
