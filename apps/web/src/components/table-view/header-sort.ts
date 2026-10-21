import type { SortConfig, SortDirection, SortField } from "@/lib/sort-tasks";

const MANUAL_SORT: SortConfig = { field: "position", direction: "asc" };

/**
 * Priority reads best highest-first, so its first click is descending. Every
 * other field starts ascending. Matches SortControl's field picker.
 */
export function getDefaultSortDirection(field: SortField): SortDirection {
  return field === "priority" ? "desc" : "asc";
}

/** Cycles a header through default direction, reversed, then back to manual order. */
export function getNextHeaderSort(
  current: SortConfig,
  field: SortField,
): SortConfig {
  const defaultDirection = getDefaultSortDirection(field);

  if (current.field !== field) {
    return { field, direction: defaultDirection };
  }

  if (current.direction === defaultDirection) {
    return {
      field,
      direction: defaultDirection === "asc" ? "desc" : "asc",
    };
  }

  return MANUAL_SORT;
}
