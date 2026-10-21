import { reconcileProjectSync, reconcileTaskSync } from "./sync/reconcile";
import { and, eq } from "drizzle-orm";
import db from "../database";
import { integrationTable } from "../database/schema";
import { subscribeToEvent } from "../events";
import type {
  CraftLabelSyncEvent,
  IntegrationPlugin,
  PluginContext,
  TaskAssigneeChangedEvent,
  TaskCommentCreatedEvent,
  TaskCraftChangedEvent,
  TaskCreatedEvent,
  TaskDeletedEvent,
  TaskDescriptionChangedEvent,
  TaskDueDateChangedEvent,
  TaskMovedEvent,
  TaskPriorityChangedEvent,
  TaskRelationChangedEvent,
  TaskStatusChangedEvent,
  TaskTitleChangedEvent,
  TaskUnassignedEvent,
} from "./types";

const plugins = new Map<string, IntegrationPlugin>();
let eventSubscriptionsInitialized = false;

export function registerPlugin(plugin: IntegrationPlugin): void {
  if (plugins.has(plugin.type)) {
    throw new Error(`Plugin ${plugin.type} already registered`);
  }
  plugins.set(plugin.type, plugin);
  console.log(`✓ Registered plugin: ${plugin.name}`);
}

export function initializeEventSubscriptions(): void {
  if (eventSubscriptionsInitialized) {
    return;
  }

  subscribeToEvent<{
    taskId: string;
    userId: string;
    title: string;
    description: string;
    priority: string;
    status: string;
    number: number;
    projectId: string;
    craftName?: string | null;
    craftColor?: string | null;
  }>("task.created", async (data) => {
    await broadcastTaskCreated({
      taskId: data.taskId,
      projectId: data.projectId,
      userId: data.userId,
      title: data.title,
      description: data.description,
      priority: data.priority,
      status: data.status,
      number: data.number,
      craftName: data.craftName,
      craftColor: data.craftColor,
    });
  });

  subscribeToEvent<{
    taskId: string;
    userId: string | null;
    oldStatus: string;
    newStatus: string;
    sourceIntegrationId?: string;
    title: string;
    projectId: string;
  }>("task.status_changed", async (data) => {
    await broadcastTaskStatusChanged({
      sourceIntegrationId: data.sourceIntegrationId,
      taskId: data.taskId,
      projectId: data.projectId,
      userId: data.userId,
      oldStatus: data.oldStatus,
      newStatus: data.newStatus,
      title: data.title,
    });
  });

  subscribeToEvent<{
    taskId: string;
    userId: string | null;
    oldPriority: string;
    newPriority: string;
    title: string;
    projectId: string;
  }>("task.priority_changed", async (data) => {
    await broadcastTaskPriorityChanged({
      taskId: data.taskId,
      projectId: data.projectId,
      userId: data.userId,
      oldPriority: data.oldPriority,
      newPriority: data.newPriority,
      title: data.title,
    });
  });

  subscribeToEvent<TaskCraftChangedEvent>(
    "task.craft_changed",
    async (data) => {
      await broadcastTaskCraftChanged({
        taskId: data.taskId,
        projectId: data.projectId,
        userId: data.userId,
        oldCraftId: data.oldCraftId,
        newCraftId: data.newCraftId,
        oldCraftName: data.oldCraftName,
        newCraftName: data.newCraftName,
        newCraftColor: data.newCraftColor,
        title: data.title,
      });
    },
  );

  subscribeToEvent<{
    craftId: string;
    workspaceId: string;
    oldName: string;
    newName: string;
    color: string;
    targets: Array<{ taskId: string; projectId: string }>;
  }>("craft.renamed", async (data) => {
    await broadcastCraftLabelSync({
      craftId: data.craftId,
      workspaceId: data.workspaceId,
      oldName: data.oldName,
      newName: data.newName,
      color: data.color,
      targets: data.targets,
    });
  });

  subscribeToEvent<{
    craftId: string;
    workspaceId: string;
    name: string;
    targets: Array<{ taskId: string; projectId: string }>;
  }>("craft.deleted", async (data) => {
    await broadcastCraftLabelSync({
      craftId: data.craftId,
      workspaceId: data.workspaceId,
      oldName: data.name,
      newName: null,
      color: null,
      targets: data.targets,
    });
  });

  subscribeToEvent<TaskTitleChangedEvent>(
    "task.title_changed",
    async (data) => {
      await broadcastTaskTitleChanged({
        sourceIntegrationId: data.sourceIntegrationId,
        taskId: data.taskId,
        projectId: data.projectId,
        userId: data.userId,
        oldTitle: data.oldTitle,
        newTitle: data.newTitle,
      });
    },
  );

  subscribeToEvent<TaskDescriptionChangedEvent>(
    "task.description_changed",
    async (data) => {
      await broadcastTaskDescriptionChanged({
        sourceIntegrationId: data.sourceIntegrationId,
        taskId: data.taskId,
        projectId: data.projectId,
        userId: data.userId,
        oldDescription: data.oldDescription,
        newDescription: data.newDescription,
      });
    },
  );

  subscribeToEvent<{
    taskId: string;
    userId: string;
    comment: string;
    projectId: string;
  }>("comment.created", async (data) => {
    await broadcastTaskCommentCreated({
      taskId: data.taskId,
      projectId: data.projectId,
      userId: data.userId,
      comment: data.comment,
    });
  });

  subscribeToEvent<{
    taskId: string;
    userId: string | null;
    title: string;
    projectId: string;
  }>("task.deleted", async (data) => {
    await broadcastTaskDeleted({
      taskId: data.taskId,
      projectId: data.projectId,
      userId: data.userId,
      title: data.title,
    });
  });

  subscribeToEvent<{
    taskId: string;
    userId: string | null;
    fromProjectId: string;
    fromProjectName: string;
    toProjectId: string;
    toProjectName: string;
    oldStatus: string;
    newStatus: string;
  }>("task.moved", async (data) => {
    await broadcastTaskMoved({
      taskId: data.taskId,
      projectId: data.toProjectId,
      userId: data.userId,
      fromProjectId: data.fromProjectId,
      fromProjectName: data.fromProjectName,
      toProjectId: data.toProjectId,
      toProjectName: data.toProjectName,
      oldStatus: data.oldStatus,
      newStatus: data.newStatus,
    });
  });

  subscribeToEvent<{
    taskId: string;
    userId: string | null;
    oldDueDate: Date | null;
    newDueDate: Date | null;
    title: string;
    projectId: string;
  }>("task.due_date_changed", async (data) => {
    await broadcastTaskDueDateChanged({
      taskId: data.taskId,
      projectId: data.projectId,
      userId: data.userId,
      title: data.title,
      oldDueDate: data.oldDueDate,
      newDueDate: data.newDueDate,
    });
  });

  subscribeToEvent<{
    taskId: string;
    userId: string | null;
    oldAssignee: string | null;
    newAssignee: string | undefined;
    newAssigneeId: string;
    title: string;
    projectId: string;
  }>("task.assignee_changed", async (data) => {
    await broadcastTaskAssigneeChanged({
      taskId: data.taskId,
      projectId: data.projectId,
      userId: data.userId,
      title: data.title,
      oldAssignee: data.oldAssignee,
      newAssignee: data.newAssignee,
      newAssigneeId: data.newAssigneeId,
    });
  });

  subscribeToEvent<{
    taskId: string;
    userId: string | null;
    title: string;
    projectId: string;
  }>("task.unassigned", async (data) => {
    await broadcastTaskUnassigned({
      taskId: data.taskId,
      projectId: data.projectId,
      userId: data.userId,
      title: data.title,
    });
  });

  for (const event of [
    "task.label_created",
    "task.label_deleted",
    "task.label_assigned",
    "task.label_unassigned",
    "task.labels_updated",
  ]) {
    subscribeToEvent<{ projectId: string; taskId: string }>(
      event,
      async (data) => {
        await reconcileTaskSync(data.projectId, data.taskId);
      },
    );
  }
  subscribeToEvent<{ taskId: string; toProjectId: string }>(
    "task.moved",
    async (data) => {
      await reconcileTaskSync(data.toProjectId, data.taskId);
    },
  );
  subscribeToEvent<{ projectId: string; integrationId: string }>(
    "integration.sync_rules_changed",
    async (data) => {
      await reconcileProjectSync(data.projectId, data.integrationId);
    },
  );

  subscribeToEvent<{ projectId: string; integrationId?: string }>(
    "integration.sync_labels_changed",
    async (data) => {
      await reconcileProjectSync(data.projectId, data.integrationId);
    },
  );
  for (const [eventType, hook] of [
    ["task-relation.created", "onTaskRelationCreated"],
    ["task-relation.deleted", "onTaskRelationDeleted"],
  ] as const) {
    subscribeToEvent<TaskRelationChangedEvent>(eventType, async (data) => {
      await broadcastTaskRelationChanged(eventType, hook, {
        sourceTaskId: data.sourceTaskId,
        targetTaskId: data.targetTaskId,
        relationType: data.relationType,
        projectId: data.projectId,
        userId: data.userId,
        origin: data.origin,
      });
    });
  }

  eventSubscriptionsInitialized = true;
  console.log("✓ Plugin event subscriptions initialized");
}

export function getPlugin(type: string): IntegrationPlugin | undefined {
  return plugins.get(type);
}

export function listPlugins(): IntegrationPlugin[] {
  return Array.from(plugins.values());
}

async function getActiveIntegrations(projectId: string) {
  return db.query.integrationTable.findMany({
    where: and(
      eq(integrationTable.projectId, projectId),
      eq(integrationTable.isActive, true),
    ),
    with: {
      project: true,
    },
  });
}

function createContext(integration: {
  id: string;
  projectId: string;
  config: string;
}): PluginContext {
  return {
    integrationId: integration.id,
    projectId: integration.projectId,
    config: JSON.parse(integration.config) as Record<string, unknown>,
  };
}

export async function broadcastTaskCreated(
  event: TaskCreatedEvent,
): Promise<void> {
  const integrations = await getActiveIntegrations(event.projectId);

  for (const integration of integrations) {
    const plugin = getPlugin(integration.type);
    if (!plugin?.onTaskCreated) continue;

    const context = createContext(integration);

    try {
      await plugin.onTaskCreated(event, context);
    } catch (error) {
      console.error(`Plugin ${plugin.type} error on task.created:`, error);
    }
  }
}

export async function broadcastTaskStatusChanged(
  event: TaskStatusChangedEvent,
): Promise<void> {
  const integrations = await getActiveIntegrations(event.projectId);

  for (const integration of integrations) {
    if (integration.id === event.sourceIntegrationId) continue;
    const plugin = getPlugin(integration.type);
    if (!plugin?.onTaskStatusChanged) continue;

    const context = createContext(integration);

    try {
      await plugin.onTaskStatusChanged(event, context);
    } catch (error) {
      console.error(
        `Plugin ${plugin.type} error on task.status_changed:`,
        error,
      );
    }
  }
}

export async function broadcastTaskCraftChanged(
  event: TaskCraftChangedEvent,
): Promise<void> {
  const integrations = await getActiveIntegrations(event.projectId);

  for (const integration of integrations) {
    const plugin = getPlugin(integration.type);
    if (!plugin?.onTaskCraftChanged) continue;

    const context = createContext(integration);

    try {
      await plugin.onTaskCraftChanged(event, context);
    } catch (error) {
      console.error(
        `Plugin ${plugin.type} error on task.craft_changed:`,
        error,
      );
    }
  }
}

/**
 * Re-label the forge issues of tasks that carried a renamed or deleted craft.
 *
 * Craft is workspace-scoped while integrations hang off a project, so the
 * targets arrive pre-resolved and get grouped by project here; each plugin
 * then sees only the tasks belonging to the project its integration covers.
 */
export async function broadcastCraftLabelSync(event: {
  craftId: string;
  workspaceId: string;
  oldName: string;
  newName: string | null;
  color: string | null;
  targets: Array<{ taskId: string; projectId: string }>;
}): Promise<void> {
  const byProject = new Map<string, string[]>();
  for (const target of event.targets) {
    const existing = byProject.get(target.projectId);
    if (existing) {
      existing.push(target.taskId);
    } else {
      byProject.set(target.projectId, [target.taskId]);
    }
  }

  for (const [projectId, taskIds] of byProject) {
    const integrations = await getActiveIntegrations(projectId);

    for (const integration of integrations) {
      const plugin = getPlugin(integration.type);
      if (!plugin?.onCraftLabelSync) continue;

      const context = createContext(integration);
      const payload: CraftLabelSyncEvent = {
        craftId: event.craftId,
        workspaceId: event.workspaceId,
        oldName: event.oldName,
        newName: event.newName,
        color: event.color,
        taskIds,
      };

      try {
        await plugin.onCraftLabelSync(payload, context);
      } catch (error) {
        console.error(
          `Plugin ${plugin.type} error on craft label sync:`,
          error,
        );
      }
    }
  }
}

export async function broadcastTaskPriorityChanged(
  event: TaskPriorityChangedEvent,
): Promise<void> {
  const integrations = await getActiveIntegrations(event.projectId);

  for (const integration of integrations) {
    const plugin = getPlugin(integration.type);
    if (!plugin?.onTaskPriorityChanged) continue;

    const context = createContext(integration);

    try {
      await plugin.onTaskPriorityChanged(event, context);
    } catch (error) {
      console.error(
        `Plugin ${plugin.type} error on task.priority_changed:`,
        error,
      );
    }
  }
}

export async function broadcastTaskTitleChanged(
  event: TaskTitleChangedEvent,
): Promise<void> {
  const integrations = await getActiveIntegrations(event.projectId);

  for (const integration of integrations) {
    if (integration.id === event.sourceIntegrationId) continue;
    const plugin = getPlugin(integration.type);
    if (!plugin?.onTaskTitleChanged) continue;

    const context = createContext(integration);

    try {
      await plugin.onTaskTitleChanged(event, context);
    } catch (error) {
      console.error(
        `Plugin ${plugin.type} error on task.title_changed:`,
        error,
      );
    }
  }
}

export async function broadcastTaskDescriptionChanged(
  event: TaskDescriptionChangedEvent,
): Promise<void> {
  const integrations = await getActiveIntegrations(event.projectId);

  for (const integration of integrations) {
    if (integration.id === event.sourceIntegrationId) continue;
    const plugin = getPlugin(integration.type);
    if (!plugin?.onTaskDescriptionChanged) continue;

    const context = createContext(integration);

    try {
      await plugin.onTaskDescriptionChanged(event, context);
    } catch (error) {
      console.error(
        `Plugin ${plugin.type} error on task.description_changed:`,
        error,
      );
    }
  }
}

export async function broadcastTaskCommentCreated(
  event: TaskCommentCreatedEvent,
): Promise<void> {
  const integrations = await getActiveIntegrations(event.projectId);

  for (const integration of integrations) {
    const plugin = getPlugin(integration.type);
    if (!plugin?.onTaskCommentCreated) continue;

    const context = createContext(integration);

    try {
      await plugin.onTaskCommentCreated(event, context);
    } catch (error) {
      console.error(`Plugin ${plugin.type} error on comment.created:`, error);
    }
  }
}

export async function broadcastTaskDeleted(
  event: TaskDeletedEvent,
): Promise<void> {
  const integrations = await getActiveIntegrations(event.projectId);

  for (const integration of integrations) {
    const plugin = getPlugin(integration.type);
    if (!plugin?.onTaskDeleted) continue;

    const context = createContext(integration);

    try {
      await plugin.onTaskDeleted(event, context);
    } catch (error) {
      console.error(`Plugin ${plugin.type} error on task.deleted:`, error);
    }
  }
}

export async function broadcastTaskMoved(event: TaskMovedEvent): Promise<void> {
  const integrations = await getActiveIntegrations(event.projectId);

  for (const integration of integrations) {
    const plugin = getPlugin(integration.type);
    if (!plugin?.onTaskMoved) continue;

    const context = createContext(integration);

    try {
      await plugin.onTaskMoved(event, context);
    } catch (error) {
      console.error(`Plugin ${plugin.type} error on task.moved:`, error);
    }
  }
}

export async function broadcastTaskDueDateChanged(
  event: TaskDueDateChangedEvent,
): Promise<void> {
  const integrations = await getActiveIntegrations(event.projectId);

  for (const integration of integrations) {
    const plugin = getPlugin(integration.type);
    if (!plugin?.onTaskDueDateChanged) continue;

    const context = createContext(integration);

    try {
      await plugin.onTaskDueDateChanged(event, context);
    } catch (error) {
      console.error(
        `Plugin ${plugin.type} error on task.due_date_changed:`,
        error,
      );
    }
  }
}

export async function broadcastTaskAssigneeChanged(
  event: TaskAssigneeChangedEvent,
): Promise<void> {
  const integrations = await getActiveIntegrations(event.projectId);

  for (const integration of integrations) {
    const plugin = getPlugin(integration.type);
    if (!plugin?.onTaskAssigneeChanged) continue;

    const context = createContext(integration);

    try {
      await plugin.onTaskAssigneeChanged(event, context);
    } catch (error) {
      console.error(
        `Plugin ${plugin.type} error on task.assignee_changed:`,
        error,
      );
    }
  }
}

export async function broadcastTaskUnassigned(
  event: TaskUnassignedEvent,
): Promise<void> {
  const integrations = await getActiveIntegrations(event.projectId);

  for (const integration of integrations) {
    const plugin = getPlugin(integration.type);
    if (!plugin?.onTaskUnassigned) continue;

    const context = createContext(integration);

    try {
      await plugin.onTaskUnassigned(event, context);
    } catch (error) {
      console.error(`Plugin ${plugin.type} error on task.unassigned:`, error);
    }
  }
}

export async function broadcastTaskRelationChanged(
  eventType: "task-relation.created" | "task-relation.deleted",
  hook: "onTaskRelationCreated" | "onTaskRelationDeleted",
  event: TaskRelationChangedEvent,
): Promise<void> {
  const integrations = await getActiveIntegrations(event.projectId);

  for (const integration of integrations) {
    const plugin = getPlugin(integration.type);
    const handler = plugin?.[hook];
    if (!plugin || !handler) continue;

    const context = createContext(integration);

    try {
      await handler(event, context);
    } catch (error) {
      console.error(`Plugin ${plugin.type} error on ${eventType}:`, error);
    }
  }
}
