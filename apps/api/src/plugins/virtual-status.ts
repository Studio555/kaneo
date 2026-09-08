import { VIRTUAL_STATUSES } from "../task/validate-task-fields";

/**
 * Backlog and archive are buckets rather than board columns. A task sitting in
 * one is not committed work, so forge integrations leave it without an issue
 * until it lands in a real column.
 */
export function isVirtualStatus(status: string): boolean {
  return (VIRTUAL_STATUSES as readonly string[]).includes(status);
}
