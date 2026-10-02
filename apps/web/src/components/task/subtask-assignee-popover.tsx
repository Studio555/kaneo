import { Check, Search } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ShortcutNumber } from "@/components/ui/shortcut-number";
import { useUpdateTaskAssignee } from "@/hooks/mutations/task/use-update-task-assignee";
import { useGetActiveWorkspaceUsers } from "@/hooks/queries/workspace-users/use-get-active-workspace-users";
import { useNumberedShortcuts } from "@/hooks/use-numbered-shortcuts";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { getInitials } from "@/lib/get-initials";
import { toast } from "@/lib/toast";
import type Task from "@/types/task";

const INITIAL_VISIBLE_USERS = 40;
const VISIBLE_USERS_STEP = 40;

type SubtaskAssigneePopoverProps = {
  tasks: Task[];
  workspaceId: string;
  children: React.ReactNode;
};

export default function SubtaskAssigneePopover({
  tasks,
  workspaceId,
  children,
}: SubtaskAssigneePopoverProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const [visibleUsersCount, setVisibleUsersCount] = useState(
    INITIAL_VISIBLE_USERS,
  );
  const { mutateAsync: updateTaskAssignee } = useUpdateTaskAssignee();
  const { data: workspaceUsers } = useGetActiveWorkspaceUsers(workspaceId);
  const { canAssignTasks } = useWorkspacePermission();
  const canAssign = canAssignTasks();

  const usersOptions = useMemo(() => {
    return workspaceUsers?.members?.map((member) => ({
      label: member?.user?.name ?? member.userId,
      value: member.userId,
      image: member?.user?.image ?? "",
      name: member?.user?.name ?? "",
      email: member?.user?.email ?? "",
    }));
  }, [workspaceUsers]);

  const allSameAssignee =
    tasks.length > 0 && tasks.every((t) => t.userId === tasks[0].userId);
  const currentAssignee = allSameAssignee ? tasks[0].userId : null;

  const filteredUsersOptions = useMemo(() => {
    const query = searchValue.trim().toLowerCase();
    return (usersOptions ?? []).filter(
      (user) =>
        user.label.toLowerCase().includes(query) ||
        user.email.toLowerCase().includes(query),
    );
  }, [usersOptions, searchValue]);

  const handleAssigneeChange = useCallback(
    async (newUserId: string) => {
      try {
        await Promise.all(
          tasks.map((task) =>
            updateTaskAssignee({
              ...task,
              userId: newUserId,
            }),
          ),
        );
        setOpen(false);
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : t("tasks:popover.assignee.updateError"),
        );
      }
    },
    [t, tasks, updateTaskAssignee],
  );

  const shortcutOptions = useMemo(() => {
    const unassignedOption = { onSelect: () => handleAssigneeChange("") };
    const userOptions = filteredUsersOptions.slice(0, 8).map((user) => ({
      onSelect: () => handleAssigneeChange(user.value),
    }));
    return [unassignedOption, ...userOptions];
  }, [filteredUsersOptions, handleAssigneeChange]);

  const visibleUsersOptions = useMemo(() => {
    return filteredUsersOptions.slice(0, visibleUsersCount);
  }, [filteredUsersOptions, visibleUsersCount]);

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) {
      setSearchValue("");
      setVisibleUsersCount(INITIAL_VISIBLE_USERS);
    }
  }, []);

  const handleListScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      const target = event.currentTarget;
      const nearBottom =
        target.scrollHeight - target.scrollTop - target.clientHeight < 48;

      if (!nearBottom) return;

      setVisibleUsersCount((current) => {
        const totalUsers = filteredUsersOptions.length;
        return Math.min(current + VISIBLE_USERS_STEP, totalUsers);
      });
    },
    [filteredUsersOptions.length],
  );

  useNumberedShortcuts(open, shortcutOptions);

  if (!canAssign) return <>{children}</>;

  return (
    <Popover open={open} onOpenChange={handleOpenChange} modal={false}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-56 p-0" align="start">
        <div className="flex items-center gap-2 p-2 border-b border-border">
          <Search className="w-3 h-3 shrink-0 text-muted-foreground" />
          <Input
            unstyled
            size="sm"
            value={searchValue}
            onChange={(event) => {
              setSearchValue(event.target.value);
              setVisibleUsersCount(INITIAL_VISIBLE_USERS);
            }}
            placeholder={t("tasks:popover.assignee.searchPlaceholder")}
            aria-label={t("tasks:popover.assignee.searchPlaceholder")}
          />
        </div>
        <div
          className="max-h-80 space-y-1 overflow-y-auto p-1"
          onScroll={handleListScroll}
        >
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2 h-8 px-2"
            onClick={() => handleAssigneeChange("")}
          >
            <div
              className="w-6 h-6 rounded-full bg-muted border border-border flex items-center justify-center"
              title={t("tasks:popover.assignee.unassigned")}
            >
              <span className="text-[10px] font-medium text-muted-foreground">
                ?
              </span>
            </div>
            <span className="text-sm">
              {t("tasks:popover.assignee.unassigned")}
            </span>
            {allSameAssignee && !currentAssignee ? (
              <Check className="ml-auto h-4 w-4" />
            ) : (
              <ShortcutNumber number={1} />
            )}
          </Button>
          {filteredUsersOptions.length === 0 && (
            <p
              className="px-2 py-1.5 text-xs text-muted-foreground"
              role="status"
            >
              {t("tasks:popover.assignee.empty")}
            </p>
          )}
          {visibleUsersOptions.map((user, index) => (
            <Button
              key={user.value}
              variant="ghost"
              size="sm"
              className="w-full justify-start gap-2 h-8 px-2"
              onClick={() => handleAssigneeChange(user.value)}
            >
              <Avatar className="h-6 w-6">
                <AvatarImage src={user.image ?? ""} alt={user.name || ""} />
                <AvatarFallback className="text-xs font-medium border border-border/30">
                  {getInitials(user.name)}
                </AvatarFallback>
              </Avatar>
              <span className="text-sm truncate">{user.label}</span>
              {currentAssignee === user.value ? (
                <Check className="ml-auto h-4 w-4 shrink-0" />
              ) : index < 8 ? (
                <ShortcutNumber number={index + 2} />
              ) : null}
            </Button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
