import { Rows3, Table2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { BacklogViewMode } from "@/store/user-preferences";

const BACKLOG_VIEW_OPTIONS = [
  { mode: "list", icon: Rows3, labelKey: "tasks:view.list" },
  { mode: "table", icon: Table2, labelKey: "tasks:view.table" },
] as const satisfies ReadonlyArray<{
  mode: BacklogViewMode;
  icon: typeof Rows3;
  labelKey: string;
}>;

type BacklogViewSwitcherProps = {
  backlogViewMode: BacklogViewMode;
  setBacklogViewMode: (mode: BacklogViewMode) => void;
};

/**
 * The backlog keeps its own list/table choice. It has no board layout, so the
 * board's three-way viewMode does not fit here.
 */
export default function BacklogViewSwitcher({
  backlogViewMode,
  setBacklogViewMode,
}: BacklogViewSwitcherProps) {
  const { t } = useTranslation();

  return (
    <div className="inline-flex items-center gap-1">
      {BACKLOG_VIEW_OPTIONS.map(({ mode, icon: Icon, labelKey }) => (
        <button
          key={mode}
          type="button"
          aria-current={backlogViewMode === mode ? "page" : undefined}
          className={`inline-flex h-6 items-center gap-1 rounded-md px-2 text-xs font-medium transition-colors ${
            backlogViewMode === mode
              ? "bg-accent text-foreground"
              : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
          }`}
          onClick={() => setBacklogViewMode(mode)}
        >
          <Icon className="h-3 w-3" />
          {t(labelKey)}
        </button>
      ))}
    </div>
  );
}
