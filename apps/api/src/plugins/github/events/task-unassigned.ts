import type { PluginContext, TaskUnassignedEvent } from "../../types";
import { syncIssueAssignee } from "../utils/sync-issue-assignee";

export async function handleTaskUnassigned(
  event: TaskUnassignedEvent,
  context: PluginContext,
): Promise<void> {
  await syncIssueAssignee(event.taskId, null, context, "task_unassigned");
}
