import { ArrowDown, ArrowUp } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import type { SortConfig } from "@/lib/sort-tasks";
import { getTableGridTemplate, type TableColumn } from "./columns";
import { getNextHeaderSort } from "./header-sort";

function TableHeaderCell({
  column,
  sort,
  onSortChange,
}: {
  column: TableColumn;
  sort: SortConfig;
  onSortChange: (sort: SortConfig) => void;
}) {
  const { t } = useTranslation();
  const isActive = column.sortField !== null && sort.field === column.sortField;

  const label = (
    <span className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
      {t(column.labelKey)}
    </span>
  );

  if (column.sortField === null) {
    return <div className="flex min-w-0 items-center px-1.5">{label}</div>;
  }

  const sortField = column.sortField;

  return (
    <div className="flex min-w-0 items-center">
      <button
        type="button"
        onClick={() => onSortChange(getNextHeaderSort(sort, sortField))}
        className={cn(
          "flex h-7 w-full min-w-0 items-center gap-1 rounded-md px-1.5 text-left transition-colors hover:bg-accent/70",
          isActive && "text-foreground",
        )}
      >
        {label}
        {isActive && (
          <>
            {sort.direction === "asc" ? (
              <ArrowUp className="size-3 shrink-0 text-muted-foreground" />
            ) : (
              <ArrowDown className="size-3 shrink-0 text-muted-foreground" />
            )}
            {/* The arrow is the only visual cue, so the direction is also part
                of the button's accessible name. */}
            <span className="sr-only">
              {sort.direction === "asc"
                ? t("tasks:sort.ascending")
                : t("tasks:sort.descending")}
            </span>
          </>
        )}
      </button>
    </div>
  );
}

type TableHeaderRowProps = {
  columns: TableColumn[];
  sort: SortConfig;
  onSortChange: (sort: SortConfig) => void;
};

/** The sticky header shared by the board and backlog table views. */
export function TableHeaderRow({
  columns,
  sort,
  onSortChange,
}: TableHeaderRowProps) {
  return (
    // The rows scroll under the header, so it needs its own opaque background.
    <div
      style={{ gridTemplateColumns: getTableGridTemplate(columns) }}
      className="sticky top-0 z-10 grid min-w-fit items-center gap-2 border-b border-border/80 bg-card/95 px-2 py-1.5 backdrop-blur supports-[backdrop-filter]:bg-card/80"
    >
      {columns.map((column) => (
        <TableHeaderCell
          key={column.key}
          column={column}
          sort={sort}
          onSortChange={onSortChange}
        />
      ))}
    </div>
  );
}
