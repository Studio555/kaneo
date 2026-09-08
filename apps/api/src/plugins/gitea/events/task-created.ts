import type { PluginContext, TaskCreatedEvent } from "../../types";
import { isVirtualStatus } from "../../virtual-status";
import type { GiteaConfig } from "../config";
import { ensureIssueForTask } from "../services/issue-creator";

export async function handleTaskCreated(
  event: TaskCreatedEvent,
  context: PluginContext,
): Promise<void> {
  if (isVirtualStatus(event.status)) {
    return;
  }

  const config = context.config as GiteaConfig;
  if (!config.baseUrl || !config.accessToken) {
    return;
  }

  try {
    await ensureIssueForTask(
      {
        taskId: event.taskId,
        title: event.title,
        description: event.description,
        priority: event.priority,
        status: event.status,
        craftName: event.craftName,
        craftColor: event.craftColor,
      },
      context,
    );
  } catch (error) {
    console.error("Failed to create Gitea issue:", error);
  }
}
