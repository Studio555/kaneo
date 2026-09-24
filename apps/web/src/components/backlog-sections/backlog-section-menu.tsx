import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import { useDeleteColumn } from "@/hooks/mutations/column/use-delete-column";
import { useUpdateColumn } from "@/hooks/mutations/column/use-update-column";
import { toast } from "@/lib/toast";
import type { BacklogSection } from "@/types/project";
import { BacklogSectionNameDialog } from "./backlog-section-name-dialog";

type BacklogSectionMenuProps = {
  projectId: string;
  section: Pick<BacklogSection, "columnId" | "name">;
};

/**
 * Rename and delete for a custom backlog section. The built-in Planned and
 * Archived sections get no menu: the API refuses both actions on them.
 */
export function BacklogSectionMenu({
  projectId,
  section,
}: BacklogSectionMenuProps) {
  const { t } = useTranslation();
  const { mutateAsync: updateColumn } = useUpdateColumn();
  const { mutateAsync: deleteColumn } = useDeleteColumn();
  const [isRenameOpen, setIsRenameOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);

  const handleRename = async (name: string) => {
    try {
      await updateColumn({ id: section.columnId, projectId, data: { name } });
      toast.success(t("tasks:backlog.sectionActions.renamed"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("tasks:backlog.sectionActions.renameError"),
      );
      throw error;
    }
  };

  const handleDelete = async () => {
    try {
      await deleteColumn({ id: section.columnId, projectId });
      toast.success(t("tasks:backlog.sectionActions.deleted"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("tasks:backlog.sectionActions.deleteError"),
      );
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label={t("tasks:backlog.sectionActions.menu")}
              title={t("tasks:backlog.sectionActions.menu")}
            />
          }
        >
          <MoreHorizontal className="size-3" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setIsRenameOpen(true)}>
            <Pencil />
            {t("tasks:backlog.sectionActions.rename")}
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onClick={() => setIsDeleteOpen(true)}
          >
            <Trash2 />
            {t("tasks:backlog.sectionActions.delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <BacklogSectionNameDialog
        open={isRenameOpen}
        onOpenChange={setIsRenameOpen}
        title={t("tasks:backlog.sectionActions.renameTitle")}
        submitLabel={t("tasks:backlog.sectionActions.save")}
        initialName={section.name}
        onSubmit={handleRename}
      />

      <AlertDialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("tasks:backlog.sectionActions.deleteTitle", {
                name: section.name,
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("tasks:backlog.sectionActions.deleteDescription")}
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
                  onClick={handleDelete}
                />
              }
            >
              {t("tasks:backlog.sectionActions.delete")}
            </AlertDialogClose>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
