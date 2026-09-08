import type { IntegrationPlugin } from "../types";
import { validateGitHubConfig } from "./config";
import { handleCraftLabelSync } from "./events/craft-label-sync";
import { handleTaskAssigneeChanged } from "./events/task-assignee-changed";
import { handleTaskCommentCreated } from "./events/task-comment-created";
import { handleTaskCraftChanged } from "./events/task-craft-changed";
import { handleTaskCreated } from "./events/task-created";
import { handleTaskDescriptionChanged } from "./events/task-description-changed";
import { handleTaskPriorityChanged } from "./events/task-priority-changed";
import { handleTaskStatusChanged } from "./events/task-status-changed";
import { handleTaskTitleChanged } from "./events/task-title-changed";
import { handleTaskUnassigned } from "./events/task-unassigned";
import { setupWebhookHandlers } from "./webhook-handler";

export const githubPlugin: IntegrationPlugin = {
  type: "github",
  name: "GitHub",
  onTaskCreated: handleTaskCreated,
  onTaskStatusChanged: handleTaskStatusChanged,
  onTaskPriorityChanged: handleTaskPriorityChanged,
  onTaskCraftChanged: handleTaskCraftChanged,
  onCraftLabelSync: handleCraftLabelSync,
  onTaskTitleChanged: handleTaskTitleChanged,
  onTaskDescriptionChanged: handleTaskDescriptionChanged,
  onTaskCommentCreated: handleTaskCommentCreated,
  onTaskAssigneeChanged: handleTaskAssigneeChanged,
  onTaskUnassigned: handleTaskUnassigned,
  validateConfig: validateGitHubConfig,
};

export function initializeGitHubPlugin() {
  setupWebhookHandlers();
}
