import type { SortField } from "@/lib/sort-tasks";

export type TableColumnKey =
  | "name"
  | "status"
  | "assignee"
  | "priority"
  | "dueDate"
  | "craft"
  | "labels";

export type TableColumn = {
  key: TableColumnKey;
  labelKey: string;
  /** A single CSS grid track. Header and rows share one template built from these. */
  width: string;
  /** null means the header is not clickable: status is the grouping, labels are multi-valued. */
  sortField: SortField | null;
};

export type TableColumnVisibility = {
  showAssignees: boolean;
  showDueDates: boolean;
  showLabels: boolean;
  showPriority: boolean;
};

const TABLE_COLUMNS: readonly (TableColumn & {
  visibilityKey: keyof TableColumnVisibility | null;
})[] = [
  {
    key: "name",
    labelKey: "tasks:table.columns.name",
    width: "minmax(240px, 1fr)",
    sortField: "title",
    visibilityKey: null,
  },
  {
    key: "status",
    labelKey: "tasks:status.label",
    width: "minmax(140px, 160px)",
    sortField: null,
    visibilityKey: null,
  },
  {
    key: "assignee",
    labelKey: "tasks:assignee.label",
    width: "minmax(160px, 180px)",
    sortField: "assignee",
    visibilityKey: "showAssignees",
  },
  {
    key: "priority",
    labelKey: "tasks:priority.label",
    width: "minmax(120px, 140px)",
    sortField: "priority",
    visibilityKey: "showPriority",
  },
  {
    key: "dueDate",
    labelKey: "tasks:dueDate.label",
    width: "minmax(120px, 140px)",
    sortField: "dueDate",
    visibilityKey: "showDueDates",
  },
  {
    key: "craft",
    labelKey: "tasks:properties.craft",
    // Craft has no display preference of its own, unlike the columns around it.
    width: "minmax(140px, 170px)",
    sortField: "craft",
    visibilityKey: null,
  },
  {
    key: "labels",
    labelKey: "tasks:properties.labels",
    width: "minmax(160px, 220px)",
    sortField: null,
    visibilityKey: "showLabels",
  },
];

export function getVisibleTableColumns(
  visibility: TableColumnVisibility,
): TableColumn[] {
  return TABLE_COLUMNS.filter(
    ({ visibilityKey }) => visibilityKey === null || visibility[visibilityKey],
  ).map(({ visibilityKey: _visibilityKey, ...column }) => column);
}

export function getTableGridTemplate(columns: TableColumn[]): string {
  return columns.map((column) => column.width).join(" ");
}
