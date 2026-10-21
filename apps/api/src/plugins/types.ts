export type PluginContext = {
  integrationId: string;
  projectId: string;
  config: Record<string, unknown>;
};

export type TaskCreatedEvent = {
  taskId: string;
  projectId: string;
  userId: string;
  title: string;
  description: string | null;
  priority: string | null;
  status: string;
  number: number;
  craftName?: string | null;
  craftColor?: string | null;
};

export type TaskStatusChangedEvent = {
  sourceIntegrationId?: string;
  taskId: string;
  projectId: string;
  userId: string | null;
  oldStatus: string;
  newStatus: string;
  title: string;
};

export type TaskPriorityChangedEvent = {
  taskId: string;
  projectId: string;
  userId: string | null;
  oldPriority: string;
  newPriority: string;
  title: string;
};

export type TaskTitleChangedEvent = {
  sourceIntegrationId?: string;
  taskId: string;
  projectId: string;
  userId: string | null;
  oldTitle: string;
  newTitle: string;
};

export type TaskDescriptionChangedEvent = {
  sourceIntegrationId?: string;
  taskId: string;
  projectId: string;
  userId: string | null;
  oldDescription: string | null;
  newDescription: string | null;
};

export type TaskCommentCreatedEvent = {
  taskId: string;
  projectId: string;
  userId: string;
  comment: string;
};

export type TaskDeletedEvent = {
  taskId: string;
  projectId: string;
  userId: string | null;
  title: string;
};

export type TaskMovedEvent = {
  taskId: string;
  projectId: string;
  userId: string | null;
  fromProjectId: string;
  fromProjectName: string;
  toProjectId: string;
  toProjectName: string;
  oldStatus: string;
  newStatus: string;
};

export type TaskDueDateChangedEvent = {
  taskId: string;
  projectId: string;
  userId: string | null;
  title: string;
  oldDueDate: Date | null;
  newDueDate: Date | null;
};

export type TaskAssigneeChangedEvent = {
  taskId: string;
  projectId: string;
  userId: string | null;
  title: string;
  oldAssignee: string | null;
  newAssignee: string | undefined;
  newAssigneeId: string;
};

export type TaskUnassignedEvent = {
  taskId: string;
  projectId: string;
  userId: string | null;
  title: string;
};

export type TaskCraftChangedEvent = {
  taskId: string;
  projectId: string;
  userId: string | null;
  oldCraftId: string | null;
  newCraftId: string | null;
  oldCraftName: string | null;
  newCraftName: string | null;
  newCraftColor: string | null;
  title: string;
};

/**
 * A relation between two tasks was added or removed. `projectId` is the
 * source task's project; for a subtask the source is the parent.
 */
export type TaskRelationChangedEvent = {
  sourceTaskId: string;
  targetTaskId: string;
  /** Absent when the relation went with a deleted task. */
  relationType?: string;
  projectId: string;
  userId: string | null;
  /** Set to an integration's name when that integration made the change. */
  origin?: string;
};

/**
 * A craft rename or delete, fanned out per project. Craft is workspace-scoped
 * but integrations are project-scoped, so the registry resolves the affected
 * tasks and hands each plugin only the ones in its own project.
 */
export type CraftLabelSyncEvent = {
  craftId: string;
  workspaceId: string;
  /** The label name currently on the forge issues. */
  oldName: string;
  /** The replacement name, or null when the craft was deleted. */
  newName: string | null;
  color: string | null;
  taskIds: string[];
};

export type CraftLabelSyncHandler = (
  event: CraftLabelSyncEvent,
  context: PluginContext,
) => Promise<void>;

export type TaskEvent =
  | TaskCreatedEvent
  | TaskStatusChangedEvent
  | TaskPriorityChangedEvent
  | TaskCraftChangedEvent
  | TaskTitleChangedEvent
  | TaskDescriptionChangedEvent
  | TaskCommentCreatedEvent
  | TaskDeletedEvent
  | TaskMovedEvent
  | TaskDueDateChangedEvent
  | TaskAssigneeChangedEvent
  | TaskUnassignedEvent
  | TaskRelationChangedEvent;

export type ExternalMetadata = {
  type: "issue" | "pull_request" | "branch";
  id: string;
  externalId: string;
  title: string | null;
  url: string;
  status: string;
  metadata: Record<string, unknown>;
};

export type TaskEventHandler<T extends TaskEvent = TaskEvent> = (
  event: T,
  context: PluginContext,
) => Promise<void>;

export type WebhookHandler = (
  payload: unknown,
  headers: Record<string, string>,
) => Promise<void>;

export type MetadataProvider = (
  taskId: string,
  context: PluginContext,
) => Promise<ExternalMetadata[]>;

export type ConfigValidator = (
  config: unknown,
) => Promise<{ valid: boolean; errors?: string[] }>;

export type IntegrationPlugin = {
  type: string;
  name: string;

  onTaskCreated?: TaskEventHandler<TaskCreatedEvent>;
  onTaskStatusChanged?: TaskEventHandler<TaskStatusChangedEvent>;
  onTaskPriorityChanged?: TaskEventHandler<TaskPriorityChangedEvent>;
  onTaskCraftChanged?: TaskEventHandler<TaskCraftChangedEvent>;
  onCraftLabelSync?: CraftLabelSyncHandler;
  onTaskTitleChanged?: TaskEventHandler<TaskTitleChangedEvent>;
  onTaskDescriptionChanged?: TaskEventHandler<TaskDescriptionChangedEvent>;
  onTaskCommentCreated?: TaskEventHandler<TaskCommentCreatedEvent>;
  onTaskDeleted?: TaskEventHandler<TaskDeletedEvent>;
  onTaskMoved?: TaskEventHandler<TaskMovedEvent>;
  onTaskDueDateChanged?: TaskEventHandler<TaskDueDateChangedEvent>;
  onTaskAssigneeChanged?: TaskEventHandler<TaskAssigneeChangedEvent>;
  onTaskUnassigned?: TaskEventHandler<TaskUnassignedEvent>;
  onTaskRelationCreated?: TaskEventHandler<TaskRelationChangedEvent>;
  onTaskRelationDeleted?: TaskEventHandler<TaskRelationChangedEvent>;

  handleWebhook?: WebhookHandler;
  getTaskMetadata?: MetadataProvider;
  validateConfig: ConfigValidator;
};
