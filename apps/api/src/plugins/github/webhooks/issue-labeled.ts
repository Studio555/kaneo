import { eq } from "drizzle-orm";
import db from "../../../database";
import { labelTable, taskTable } from "../../../database/schema";
import { publishEvent } from "../../../events";
import { reconcileCraftFromIssueLabels } from "../../reconcile-craft-from-labels";
import { isSystemLabelName, parseCraftLabelName } from "../../system-labels";
import { findExternalLink } from "../services/link-manager";
import {
  findAllIntegrationsByRepo,
  updateTaskStatus,
} from "../services/task-service";
import {
  extractIssuePriority,
  extractIssueStatus,
} from "../utils/extract-priority";

type IssueLabeledPayload = {
  action: string;
  issue: {
    number: number;
    labels?: Array<string | { name?: string }>;
  };
  label?: {
    name: string;
    color: string;
  };
  repository: {
    owner: { login: string };
    name: string;
  };
};

export async function handleIssueLabeled(payload: IssueLabeledPayload) {
  const { issue, repository, label: addedLabel } = payload;

  const integrations = await findAllIntegrationsByRepo(
    repository.owner.login,
    repository.name,
  );

  for (const integration of integrations) {
    const existingLink = await findExternalLink(
      integration.id,
      "issue",
      issue.number.toString(),
    );

    if (!existingLink) {
      continue;
    }

    const priority = extractIssuePriority(issue.labels);
    const status = extractIssueStatus(issue.labels);

    if (priority) {
      await db
        .update(taskTable)
        .set({ priority })
        .where(eq(taskTable.id, existingLink.taskId));
    }

    if (status) {
      const statusResult = await updateTaskStatus(existingLink.taskId, status);
      if (
        statusResult.applied &&
        statusResult.before.status !== statusResult.after.status
      ) {
        await publishEvent("task.status_changed", {
          taskId: statusResult.after.id,
          projectId: statusResult.after.projectId,
          userId: null,
          oldStatus: statusResult.before.status,
          newStatus: statusResult.after.status,
          title: statusResult.after.title,
          assigneeId: statusResult.after.userId,
          type: "status_changed",
        });
      }
    }

    if (!addedLabel) {
      return;
    }

    // A craft label changed, so the craft is reconciled against the issue's
    // whole label set rather than against this one delta. Both actions land
    // in the same place: whatever `craft:` label the issue carries now is
    // what the task should carry.
    if (parseCraftLabelName(addedLabel.name)) {
      const craftTask = await db.query.taskTable.findFirst({
        where: eq(taskTable.id, existingLink.taskId),
        with: {
          project: true,
        },
      });

      if (craftTask?.project?.workspaceId) {
        await reconcileCraftFromIssueLabels({
          taskId: existingLink.taskId,
          workspaceId: craftTask.project.workspaceId,
          labels: issue.labels,
          delta: {
            label: addedLabel.name,
            op: payload.action === "unlabeled" ? "removed" : "added",
          },
          link: { id: existingLink.id, metadata: existingLink.metadata },
          source: "github",
        });
      }

      return;
    }

    if (isSystemLabelName(addedLabel.name)) {
      return;
    }

    if (payload.action === "labeled") {
      const task = await db.query.taskTable.findFirst({
        where: eq(taskTable.id, existingLink.taskId),
        with: {
          project: true,
        },
      });

      if (task?.project?.workspaceId) {
        const existingLabel = await db.query.labelTable.findFirst({
          where: (table, { and, eq }) =>
            and(
              eq(table.workspaceId, task.project.workspaceId),
              eq(table.name, addedLabel.name),
              eq(table.taskId, task.id),
            ),
        });

        if (!existingLabel) {
          const color = addedLabel.color ? `#${addedLabel.color}` : "#6B7280";
          await db
            .insert(labelTable)
            .values({
              name: addedLabel.name,
              color,
              taskId: task.id,
              workspaceId: task.project.workspaceId,
            })
            .onConflictDoNothing({
              target: [labelTable.taskId, labelTable.name],
            });
        }
      }
    }

    if (payload.action === "unlabeled") {
      const labelsToDelete = await db.query.labelTable.findMany({
        where: (table, { and, eq }) =>
          and(
            eq(table.taskId, existingLink.taskId),
            eq(table.name, addedLabel.name),
          ),
      });

      for (const label of labelsToDelete) {
        await db.delete(labelTable).where(eq(labelTable.id, label.id));
      }
    }

    return;
  }
}
