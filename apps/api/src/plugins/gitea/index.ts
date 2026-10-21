import type { IntegrationPlugin } from "../types";
import { validateGiteaConfig } from "./config";
import { handleCraftLabelSync } from "./events/craft-label-sync";
import { handleTaskCommentCreated } from "./events/task-comment-created";
import { handleTaskCraftChanged } from "./events/task-craft-changed";
import { handleTaskCreated } from "./events/task-created";
import { handleTaskDescriptionChanged } from "./events/task-description-changed";
import { handleTaskPriorityChanged } from "./events/task-priority-changed";
import { handleTaskStatusChanged } from "./events/task-status-changed";
import { handleTaskTitleChanged } from "./events/task-title-changed";

export const giteaPlugin: IntegrationPlugin = {
  type: "gitea",
  name: "Gitea",
  onTaskCreated: handleTaskCreated,
  onTaskStatusChanged: handleTaskStatusChanged,
  onTaskPriorityChanged: handleTaskPriorityChanged,
  onTaskCraftChanged: handleTaskCraftChanged,
  onCraftLabelSync: handleCraftLabelSync,
  onTaskTitleChanged: handleTaskTitleChanged,
  onTaskDescriptionChanged: handleTaskDescriptionChanged,
  onTaskCommentCreated: handleTaskCommentCreated,
  validateConfig: validateGiteaConfig,
};
