import { createFileRoute } from "@tanstack/react-router";
import { Hammer, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardDescription,
  CardFrame,
  CardHeader,
  CardPanel,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import labelColors from "@/constants/label-colors";
import useCreateCraft from "@/hooks/mutations/craft/use-create-craft";
import useDeleteCraft from "@/hooks/mutations/craft/use-delete-craft";
import useUpdateCraft from "@/hooks/mutations/craft/use-update-craft";
import useGetCraftsByWorkspace from "@/hooks/queries/craft/use-get-crafts-by-workspace";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { cn } from "@/lib/cn";
import { resolveLabelColor } from "@/lib/label-color";
import { toast } from "@/lib/toast";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/settings/workspace/crafts",
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { t } = useTranslation();
  // Craft reuses the label permission statement, so a role that can manage
  // labels can manage crafts. See apps/api/src/craft/index.ts for why.
  const { workspace, canCreateLabels, canUpdateLabels, canDeleteLabels } =
    useWorkspacePermission();
  const canCreate = canCreateLabels();
  const canUpdate = canUpdateLabels();
  const canDelete = canDeleteLabels();

  const workspaceId = workspace?.id ?? "";

  const { data: crafts = [] } = useGetCraftsByWorkspace(workspaceId);

  const createCraft = useCreateCraft();
  const updateCraft = useUpdateCraft();
  const deleteCraft = useDeleteCraft();

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("gray");
  const [createError, setCreateError] = useState("");

  const [editOpen, setEditOpen] = useState(false);
  const [editingCraft, setEditingCraft] = useState<{
    id: string;
    name: string;
    color: string;
  } | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("gray");
  const [editError, setEditError] = useState("");

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletingCraft, setDeletingCraft] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const resetCreate = () => {
    setNewName("");
    setNewColor("gray");
    setCreateError("");
  };

  const openCreate = () => {
    resetCreate();
    setCreateOpen(true);
  };

  const handleCreate = async () => {
    const trimmed = newName.trim();
    if (!trimmed) {
      setCreateError(t("settings:workspaceCrafts.nameRequired"));
      return;
    }

    try {
      await createCraft.mutateAsync({
        name: trimmed,
        color: newColor,
        workspaceId,
      });
      toast.success(t("settings:workspaceCrafts.createSuccess"));
      setCreateOpen(false);
      resetCreate();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("settings:workspaceCrafts.createError"),
      );
    }
  };

  const openEdit = (craft: { id: string; name: string; color: string }) => {
    setEditingCraft(craft);
    setEditName(craft.name);
    setEditColor(craft.color);
    setEditError("");
    setEditOpen(true);
  };

  const handleEdit = async () => {
    if (!editingCraft) return;

    const trimmed = editName.trim();
    if (!trimmed) {
      setEditError(t("settings:workspaceCrafts.nameRequired"));
      return;
    }

    try {
      await updateCraft.mutateAsync({
        id: editingCraft.id,
        name: trimmed,
        color: editColor,
      });
      toast.success(t("settings:workspaceCrafts.updateSuccess"));
      setEditOpen(false);
      setEditingCraft(null);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("settings:workspaceCrafts.updateError"),
      );
    }
  };

  const openDelete = (craft: { id: string; name: string }) => {
    setDeletingCraft(craft);
    setDeleteOpen(true);
  };

  const handleDelete = async () => {
    if (!deletingCraft) return;

    try {
      await deleteCraft.mutateAsync({ id: deletingCraft.id });
      toast.success(t("settings:workspaceCrafts.deleteSuccess"));
      setDeleteOpen(false);
      setDeletingCraft(null);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("settings:workspaceCrafts.deleteError"),
      );
    }
  };

  return (
    <>
      <PageTitle title={t("settings:workspaceCrafts.pageTitle")} />
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">
            {t("settings:workspaceCrafts.title")}
          </h1>
          <p className="text-muted-foreground">
            {t("settings:workspaceCrafts.subtitle")}
          </p>
        </div>

        <CardFrame>
          <Card className="!rounded-none !border-t-0">
            <CardHeader>
              <CardTitle className="inline-flex items-center gap-2 text-base">
                <Hammer className="size-4" />
                {t("settings:workspaceCrafts.title")}
              </CardTitle>
              <CardDescription>
                {t("settings:workspaceCrafts.cardDescription")}
              </CardDescription>
              {canCreate && (
                <CardAction>
                  <Button onClick={openCreate} className="gap-2">
                    <Plus className="size-4" />
                    {t("settings:workspaceCrafts.createCraft")}
                  </Button>
                </CardAction>
              )}
            </CardHeader>
          </Card>

          <Card className="!rounded-none">
            <CardPanel className="p-4">
              {crafts.length === 0 ? (
                <Empty>
                  <EmptyHeader>
                    <EmptyMedia>
                      <Hammer className="size-8 text-muted-foreground" />
                    </EmptyMedia>
                    <EmptyTitle>
                      {t("settings:workspaceCrafts.empty")}
                    </EmptyTitle>
                    <EmptyDescription />
                  </EmptyHeader>
                </Empty>
              ) : (
                <div className="divide-y divide-border">
                  {crafts.map((craft) => (
                    <div
                      key={craft.id}
                      className="flex items-center justify-between py-2.5 px-1"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span
                          className="w-3 h-3 rounded-full flex-shrink-0"
                          style={{
                            backgroundColor: resolveLabelColor(craft.color),
                          }}
                        />
                        <span className="text-sm truncate">{craft.name}</span>
                      </div>
                      {(canUpdate || canDelete) && (
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {canUpdate && (
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={t(
                                "settings:workspaceCrafts.editCraft",
                              )}
                              className="h-8 w-8"
                              onClick={() =>
                                openEdit({
                                  id: craft.id,
                                  name: craft.name,
                                  color: craft.color,
                                })
                              }
                            >
                              <Pencil className="size-3.5" />
                            </Button>
                          )}
                          {canDelete && (
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={t(
                                "settings:workspaceCrafts.deleteCraft",
                              )}
                              className="h-8 w-8 text-destructive hover:text-destructive"
                              onClick={() =>
                                openDelete({ id: craft.id, name: craft.name })
                              }
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardPanel>
          </Card>
        </CardFrame>
      </div>

      {/* Create Dialog */}
      <Dialog
        open={createOpen}
        onOpenChange={(open) => !open && setCreateOpen(false)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {t("settings:workspaceCrafts.createCraft")}
            </DialogTitle>
            <DialogDescription>
              {t("settings:workspaceCrafts.createDescription")}
            </DialogDescription>
          </DialogHeader>

          <div className="p-6 pt-1 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-craft-name">
                {t("settings:workspaceCrafts.nameLabel")}
              </Label>
              <Input
                id="new-craft-name"
                value={newName}
                onChange={(e) => {
                  setNewName(e.target.value);
                  setCreateError("");
                }}
                placeholder={t("settings:workspaceCrafts.namePlaceholder")}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !createCraft.isPending)
                    handleCreate();
                }}
              />
              {createError && (
                <p className="text-sm text-destructive">{createError}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label>{t("settings:workspaceCrafts.colorLabel")}</Label>
              <div className="flex flex-wrap gap-2">
                {labelColors.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    title={c.label}
                    className={cn(
                      "w-8 h-8 rounded-full border-2 transition-[scale,border-color]",
                      newColor === c.value
                        ? "border-foreground scale-110"
                        : "border-transparent hover:scale-110",
                    )}
                    style={{ backgroundColor: c.color }}
                    onClick={() => setNewColor(c.value)}
                  />
                ))}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              {t("common:actions.cancel")}
            </Button>
            <Button onClick={handleCreate} disabled={createCraft.isPending}>
              {t("settings:workspaceCrafts.createCraft")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog
        open={editOpen}
        onOpenChange={(open) => {
          if (!open) {
            setEditOpen(false);
            setEditingCraft(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("settings:workspaceCrafts.editCraft")}</DialogTitle>
            <DialogDescription>
              {t("settings:workspaceCrafts.editDescription")}
            </DialogDescription>
          </DialogHeader>

          <div className="p-6 pt-1 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-craft-name">
                {t("settings:workspaceCrafts.nameLabel")}
              </Label>
              <Input
                id="edit-craft-name"
                value={editName}
                onChange={(e) => {
                  setEditName(e.target.value);
                  setEditError("");
                }}
                placeholder={t("settings:workspaceCrafts.namePlaceholder")}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !updateCraft.isPending) handleEdit();
                }}
              />
              {editError && (
                <p className="text-sm text-destructive">{editError}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label>{t("settings:workspaceCrafts.colorLabel")}</Label>
              <div className="flex flex-wrap gap-2">
                {labelColors.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    title={c.label}
                    className={cn(
                      "w-8 h-8 rounded-full border-2 transition-[scale,border-color]",
                      editColor === c.value
                        ? "border-foreground scale-110"
                        : "border-transparent hover:scale-110",
                    )}
                    style={{ backgroundColor: c.color }}
                    onClick={() => setEditColor(c.value)}
                  />
                ))}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setEditOpen(false);
                setEditingCraft(null);
              }}
            >
              {t("common:actions.cancel")}
            </Button>
            <Button onClick={handleEdit} disabled={updateCraft.isPending}>
              {t("settings:workspaceCrafts.saveCraft")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog
        open={deleteOpen}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteOpen(false);
            setDeletingCraft(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("settings:workspaceCrafts.deleteConfirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("settings:workspaceCrafts.deleteConfirmDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDeleteOpen(false);
                setDeletingCraft(null);
              }}
            >
              {t("common:actions.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteCraft.isPending}
            >
              {t("settings:workspaceCrafts.deleteCraft")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
