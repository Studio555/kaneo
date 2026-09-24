import type { InferSelectModel } from "drizzle-orm";
import { and, eq } from "drizzle-orm";
import db from "../../../database";
import {
  columnTable,
  integrationTable,
  taskTable,
  userTable,
} from "../../../database/schema";
import { SYSTEM_BACKLOG_STATUSES } from "../../../task/validate-task-fields";
import {
  filterAssignableUsers,
  getProjectWorkspaceId,
} from "../../../utils/assert-assignable-user";

export type TaskRow = InferSelectModel<typeof taskTable>;

export type UpdateTaskStatusResult =
  | { applied: false }
  | { applied: true; before: TaskRow; after: TaskRow };

export type UpdateTaskAssigneeResult =
  | { applied: false }
  | {
      applied: true;
      before: TaskRow;
      after: TaskRow;
      /** The new assignee's display name, for the published event. */
      assigneeName: string | undefined;
    };

export async function findTaskByNumber(projectId: string, taskNumber: number) {
  return db.query.taskTable.findFirst({
    where: and(
      eq(taskTable.projectId, projectId),
      eq(taskTable.number, taskNumber),
    ),
  });
}

export async function findTaskById(taskId: string) {
  return db.query.taskTable.findFirst({
    where: eq(taskTable.id, taskId),
  });
}

/**
 * The task plus its craft, which the issue labels need but the task row only
 * references by id.
 */
export async function findTaskWithCraft(taskId: string) {
  return db.query.taskTable.findFirst({
    where: eq(taskTable.id, taskId),
    with: { craft: true },
  });
}

export async function updateTaskStatus(
  taskId: string,
  newStatus: string,
): Promise<UpdateTaskStatusResult> {
  const task = await db.query.taskTable.findFirst({
    where: eq(taskTable.id, taskId),
  });

  if (!task) {
    return { applied: false };
  }

  let columnId: string | null = null;

  const column = await db.query.columnTable.findFirst({
    where: and(
      eq(columnTable.projectId, task.projectId),
      eq(columnTable.slug, newStatus),
    ),
  });

  if (column) {
    columnId = column.id;
  } else if (
    !(SYSTEM_BACKLOG_STATUSES as readonly string[]).includes(newStatus)
  ) {
    console.warn(
      `[GitHub] Skipping status update for task ${taskId}: column "${newStatus}" not found in project ${task.projectId}`,
    );
    return { applied: false };
  }

  await db
    .update(taskTable)
    .set({ status: newStatus, columnId })
    .where(eq(taskTable.id, taskId));

  const after = await db.query.taskTable.findFirst({
    where: eq(taskTable.id, taskId),
  });

  if (!after) {
    return { applied: false };
  }

  return { applied: true, before: task, after };
}

export async function isTaskInFinalState(task: {
  projectId: string;
  status: string;
  columnId: string | null;
}): Promise<boolean> {
  if (task.columnId) {
    const columnById = await db.query.columnTable.findFirst({
      where: and(
        eq(columnTable.id, task.columnId),
        eq(columnTable.projectId, task.projectId),
      ),
    });

    if (columnById) {
      return columnById.isFinal;
    }
  }

  const columnByStatus = await db.query.columnTable.findFirst({
    where: and(
      eq(columnTable.projectId, task.projectId),
      eq(columnTable.slug, task.status),
    ),
  });

  if (columnByStatus) {
    return columnByStatus.isFinal;
  }

  return task.status === "done";
}

export async function getIntegrationWithProject(integrationId: string) {
  return db.query.integrationTable.findFirst({
    where: eq(integrationTable.id, integrationId),
    with: {
      project: true,
    },
  });
}

export async function findIntegrationByRepo(owner: string, repo: string) {
  const integrations = await findAllIntegrationsByRepo(owner, repo);
  return integrations[0] || null;
}

export async function findAllActiveGithubIntegrations() {
  return db.query.integrationTable.findMany({
    where: and(
      eq(integrationTable.type, "github"),
      eq(integrationTable.isActive, true),
    ),
    with: {
      project: true,
    },
  });
}

export async function findAllIntegrationsByRepo(owner: string, repo: string) {
  const integrations = await findAllActiveGithubIntegrations();

  return integrations.filter((integration) => {
    try {
      const config = JSON.parse(integration.config);
      return config.repositoryOwner === owner && config.repositoryName === repo;
    } catch {
      return false;
    }
  });
}

/**
 * Sets a task's assignee on behalf of an inbound forge event, or clears it
 * when `assigneeId` is null.
 *
 * This lives beside the other webhook-facing task writes rather than calling
 * the task controller, because the plugin layer importing a controller closes
 * a require cycle through the event registry. It therefore repeats the
 * controller's workspace-membership check — which is the boundary that
 * matters: a GitHub assignee who is not a member of the project's workspace
 * must not end up on the task, whatever the payload says.
 *
 * Returns `applied: false` when there is nothing to do or the assignee was
 * refused, so the caller knows not to publish an event.
 */
export async function updateTaskAssignee(
  taskId: string,
  assigneeId: string | null,
): Promise<UpdateTaskAssigneeResult> {
  const task = await db.query.taskTable.findFirst({
    where: eq(taskTable.id, taskId),
  });

  if (!task || task.userId === assigneeId) {
    return { applied: false };
  }

  let assigneeName: string | undefined;

  if (assigneeId) {
    const workspaceId = await getProjectWorkspaceId(task.projectId);
    const assignable = await filterAssignableUsers([assigneeId], workspaceId);

    if (!assignable.has(assigneeId)) {
      console.warn(
        `[GitHub] Skipping assignee update for task ${taskId}: user ${assigneeId} is not a member of workspace ${workspaceId}`,
      );
      return { applied: false };
    }

    const [assignee] = await db
      .select({ name: userTable.name })
      .from(userTable)
      .where(eq(userTable.id, assigneeId))
      .limit(1);
    assigneeName = assignee?.name;
  }

  await db
    .update(taskTable)
    .set({ userId: assigneeId })
    .where(eq(taskTable.id, taskId));

  const after = await db.query.taskTable.findFirst({
    where: eq(taskTable.id, taskId),
  });

  if (!after) {
    return { applied: false };
  }

  return { applied: true, before: task, after, assigneeName };
}
