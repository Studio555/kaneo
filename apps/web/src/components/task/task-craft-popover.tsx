import { Check } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ShortcutNumber } from "@/components/ui/shortcut-number";
import { useUpdateTaskCraft } from "@/hooks/mutations/task/use-update-task-craft";
import useGetCraftsByWorkspace from "@/hooks/queries/craft/use-get-crafts-by-workspace";
import { useNumberedShortcuts } from "@/hooks/use-numbered-shortcuts";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { resolveLabelColor } from "@/lib/label-color";
import { toast } from "@/lib/toast";
import type Task from "@/types/task";

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

  const shortcutOptions = useMemo(
    () =>
      crafts.map((craft) => ({
        onSelect: () => handleCraftChange(craft.id),
      })),
    [crafts, handleCraftChange],
  );

  useNumberedShortcuts(open, shortcutOptions);

  // Read-only role: render the trigger child as a plain element so the user
  // still sees the current craft but can't open the popover.
  if (!canEdit) return <>{children}</>;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-56 p-0" align="start">
        {crafts.length === 0 ? (
          <p className="px-3 py-2.5 text-sm text-muted-foreground">
            {t("tasks:popover.craft.empty")}
          </p>
        ) : (
          <div>
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start gap-2 h-8 px-2 rounded-none first:rounded-t-md"
              onClick={() => handleCraftChange(null)}
            >
              <span className="text-sm text-muted-foreground">
                {t("tasks:popover.craft.none")}
              </span>
              {currentCraftId === null && <Check className="ml-auto h-4 w-4" />}
            </Button>
            {crafts.map((craft, index) => (
              <Button
                key={craft.id}
                variant="ghost"
                size="sm"
                className="w-full justify-start gap-2 h-8 px-2 rounded-none last:rounded-b-md"
                onClick={() => handleCraftChange(craft.id)}
              >
                <span
                  aria-hidden="true"
                  className="inline-block w-2 h-2 shrink-0 rounded-full"
                  style={{ backgroundColor: resolveLabelColor(craft.color) }}
                />
                <span className="min-w-0 truncate text-sm">{craft.name}</span>
                {currentCraftId === craft.id ? (
                  <Check className="ml-auto h-4 w-4" />
                ) : (
                  <ShortcutNumber number={index + 1} />
                )}
              </Button>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
