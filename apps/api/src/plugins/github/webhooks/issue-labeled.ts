import { resumeLabelChanges } from "../../sync/resume-label-changes";
import {
  labelReadDeadline,
  syncLabelFieldsFromIssue,
} from "../../sync/sync-label-fields-from-issue";
import { acceptsIssue, readSyncRules } from "../../sync/rules";
import { handleIssueOpened } from "./issue-opened";
import { withIntegrationLink } from "../services/with-integration-link";
import { linkedTaskScope } from "../services/integration-task-scope";
import { eq } from "drizzle-orm";
import database from "../../../database";
import { labelTable, taskTable } from "../../../database/schema";
import { publishEvent } from "../../../events";
import { reconcileCraftFromIssueLabels } from "../../reconcile-craft-from-labels";
import { isSystemLabelName, parseCraftLabelName } from "../../system-labels";
import { findExternalLink, updateExternalLink } from "../services/link-manager";
import { findAllIntegrationsByRepo } from "../services/task-service";

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
  installation?: { id: number };
  repository: {
    id: number;
    owner: { login: string };
    name: string;
  };
};

export async function handleIssueLabeled(payload: IssueLabeledPayload) {
  const { issue, label: addedLabel } = payload;

  const integrations = await findAllIntegrationsByRepo(payload);
  const deadline = labelReadDeadline();

  for (const integration of integrations) {
    const existingLink = await findExternalLink(
      integration.id,
      "issue",
      issue.number.toString(),
    );

    if (!existingLink) {
      const fullIssue = issue as typeof issue &
        Partial<Parameters<typeof handleIssueOpened>[0]["issue"]>;
      if (
        payload.action === "labeled" &&
        readSyncRules(integration.config)?.incoming.mode === "labels" &&
        acceptsIssue(integration.config, issue.labels) &&
        fullIssue.title &&
        fullIssue.html_url
      ) {
        await handleIssueOpened(
          payload as Parameters<typeof handleIssueOpened>[0],
          integration.id,
        );
      }
      continue;
    }

    const fieldEvent =
      !addedLabel ||
      addedLabel.name.startsWith("priority:") ||
      addedLabel.name.startsWith("status:");
    // Other label events skip the provider read; status and priority come
    // only from the issue's current labels, never from this snapshot.
    if (fieldEvent)
      await syncLabelFieldsFromIssue(
        integration,
        existingLink,
        payload.action === "labeled" ? addedLabel?.name : null,
        deadline,
      );

    // A craft label changed, so the craft is reconciled against the issue's
    // whole label set: whatever `craft:` label it carries now is the task's.
    if (addedLabel && parseCraftLabelName(addedLabel.name)) {
      const craftTask = await database.query.taskTable.findFirst({
        where: eq(taskTable.id, existingLink.taskId),
        with: { project: true },
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
    }

    await withIntegrationLink(
      existingLink,
      integration,
      async (db, afterCommit, existingLink) => {
        const names = (issue.labels ?? []).flatMap((label) => {
          const name = typeof label === "string" ? label : label.name;
          return name ? [name] : [];
        });
        const changes = resumeLabelChanges(existingLink, names);
        if (changes.baseline && issue.labels !== undefined)
          await updateExternalLink(
            existingLink.id,
            { metadata: { syncResumeLabelBaseline: names } },
            db,
          );
        if (!addedLabel || isSystemLabelName(addedLabel.name)) return;

        if (payload.action === "labeled") {
          const task = await db.query.taskTable.findFirst({
            where: linkedTaskScope(existingLink.taskId, integration.projectId),
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
              const color = addedLabel.color
                ? `#${addedLabel.color}`
                : "#6B7280";
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

        afterCommit(() =>
          publishEvent("task.labels_updated", {
            projectId: integration.projectId,
            taskId: existingLink.taskId,
          }),
        );
        return;
      },
    );
  }
}
