import { Hammer } from "lucide-react";
import { useTranslation } from "react-i18next";
import { resolveLabelColor } from "@/lib/label-color";
import type { TaskCraft } from "@/types/task";

export function CraftValue({ craft }: { craft: TaskCraft | null }) {
  const { t } = useTranslation();

  if (!craft) {
    return (
      <>
        <Hammer className="text-muted-foreground" />
        <span className="truncate text-muted-foreground">
          {t("tasks:popover.craft.none")}
        </span>
      </>
    );
  }

  return (
    <>
      <span
        aria-hidden="true"
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: resolveLabelColor(craft.color) }}
      />
      <span className="truncate">{craft.name}</span>
    </>
  );
}
