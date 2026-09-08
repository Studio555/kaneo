import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  columnTable,
  craftTable,
  projectTable,
  taskTable,
} from "../../database/schema";
import { publishEvent } from "../../events";
import { filterAssignableUsers } from "../../utils/assert-assignable-user";
import { areDatesEnabled } from "../../utils/dates-enabled";
import {
  coercePriority,
  coerceStatus,
  getValidTaskStatuses,
} from "../validate-task-fields";
import { claimTaskNumber } from "./claim-task-numbers";

export type ImportTask = {
  title: string;
  description?: string;
  status: string;
  priority?: string;
  startDate?: string | null;
  dueDate?: string | null;
  userId?: string | null;
  craft?: string | null;
};

async function importTasks(
  projectId: string,
  tasksToImport: ImportTask[],
  currentUserId?: string,
) {
  const project = await db.query.projectTable.findFirst({
    where: eq(projectTable.id, projectId),
  });

  if (!project) {
    throw new HTTPException(404, {
      message: "Project not found",
    });
  }

  const assigneeIds = [
    ...new Set(
      tasksToImport
        .map((task) => task.userId?.trim())
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  const assignableIds = await filterAssignableUsers(
    assigneeIds,
    project.workspaceId,
  );

  const validStatuses = await getValidTaskStatuses(projectId);

  // Craft is exported by name, so imports resolve it back against the target
  // workspace's vocabulary. An unknown name imports the task with no craft
  // rather than inventing one, matching how inbound `craft:` labels behave.
  const workspaceCrafts = await db
    .select({
      id: craftTable.id,
      name: craftTable.name,
      color: craftTable.color,
    })
    .from(craftTable)
    .where(eq(craftTable.workspaceId, project.workspaceId));
  const craftByName = new Map(
    workspaceCrafts.map((craft) => [craft.name.toLowerCase(), craft]),
  );

  const results = [];
  const datesEnabled = areDatesEnabled();

  for (const taskData of tasksToImport) {
    const assigneeId = taskData.userId?.trim() || null;

    if (assigneeId && !assignableIds.has(assigneeId)) {
      results.push({
        success: false,
        error: "Assignee is not a member of this workspace",
        task: taskData,
      });
      continue;
    }

    // A dated row in the file is a per-task failure, exactly like an unknown
    // assignee: throwing here instead would abort the loop with the earlier
    // rows already committed and no result body to say which ones landed.
    if (!datesEnabled && (taskData.startDate || taskData.dueDate)) {
      results.push({
        success: false,
        error: "Date fields are disabled on this instance",
        task: taskData,
      });
      continue;
    }

    try {
      const { status, warning: statusWarning } = coerceStatus(
        taskData.status,
        validStatuses,
      );
      const { priority, warning: priorityWarning } = coercePriority(
        taskData.priority || "low",
      );
      const warnings = [statusWarning, priorityWarning].filter(Boolean);

      const craft = craftByName.get(taskData.craft?.trim().toLowerCase() ?? "");

      const column = await db.query.columnTable.findFirst({
        where: and(
          eq(columnTable.projectId, projectId),
          eq(columnTable.slug, status),
        ),
      });

      const createdTask = await db.transaction(async (tx) => {
        const taskNumber = await claimTaskNumber(projectId, tx);

        const [task] = await tx
          .insert(taskTable)
          .values({
            projectId,
            userId: assigneeId,
            title: taskData.title,
            status,
            columnId: column?.id ?? null,
            startDate: taskData.startDate ? new Date(taskData.startDate) : null,
            dueDate: taskData.dueDate ? new Date(taskData.dueDate) : null,
            description: taskData.description || "",
            priority,
            craftId: craft?.id ?? null,
            number: taskNumber,
          })
          .returning();

        return task;
      });

      if (createdTask) {
        await publishEvent("task.created", {
          ...createdTask,
          taskId: createdTask.id,
          userId: createdTask.userId ?? "",
          currentUserId: currentUserId ?? "",
          craftName: craft?.name ?? null,
          craftColor: craft?.color ?? null,
          type: "create",
          content: "imported the task",
        });

        results.push({
          success: true,
          task: createdTask,
          ...(warnings.length > 0 && { warnings }),
        });
      } else {
        results.push({
          success: false,
          error: "Failed to create task",
          task: taskData,
        });
      }
    } catch (error) {
      if (error instanceof HTTPException) {
        throw error;
      }
      results.push({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        task: taskData,
      });
    }
  }

  return {
    importedAt: new Date().toISOString(),
    project: {
      id: project.id,
      name: project.name,
      slug: project.slug,
    },
    results: {
      total: tasksToImport.length,
      successful: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      tasks: results,
    },
  };
}

export default importTasks;
