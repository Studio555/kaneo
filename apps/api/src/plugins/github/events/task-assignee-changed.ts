import type { PluginContext, TaskAssigneeChangedEvent } from "../../types";
import { syncIssueAssignee } from "../utils/sync-issue-assignee";

export async function handleTaskAssigneeChanged(
  event: TaskAssigneeChangedEvent,
  context: PluginContext,
): Promise<void> {
  await syncIssueAssignee(
    event.taskId,
    event.newAssigneeId,
    context,
    "task_assignee_changed",
  );
}
