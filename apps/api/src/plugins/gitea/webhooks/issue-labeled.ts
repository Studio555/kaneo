import { eq, inArray } from "drizzle-orm";
import db from "../../../database";
import { labelTable, taskTable } from "../../../database/schema";
import { publishEvent } from "../../../events";
import updateTaskCraft from "../../../task/controllers/update-task-craft";
import { findExternalLink } from "../../github/services/link-manager";
import { updateTaskStatus } from "../../github/services/task-service";
import {
  extractIssuePriority,
  extractIssueStatus,
} from "../../github/utils/extract-priority";
import {
  findCraftLabelName,
  resolveCraftByName,
  resolveCraftLabel,
} from "../../resolve-craft-label";
import { isSystemLabelName, parseCraftLabelName } from "../../system-labels";
import {
  findAllIntegrationsByGiteaRepo,
  repoOwnerLogin,
} from "../services/integration-lookup";
import { baseUrlFromRepositoryHtmlUrl } from "../utils/webhook-repo";

type IssueLabeledPayload = {
  action: string;
  issue: {
    number: number;
    labels?: Array<string | { name?: string; color?: string }>;
  };
  label?: {
    name: string;
    color: string;
  };
  repository: {
    owner: { login?: string; username?: string };
    name: string;
    html_url: string;
  };
};

/** Non-system labels from a Gitea issue (used when action is label_updated). */
function giteaLabelsForSync(
  labels: IssueLabeledPayload["issue"]["labels"],
): Array<{ name: string; color?: string }> {
  if (!labels) return [];
  const out: Array<{ name: string; color?: string }> = [];
  for (const raw of labels) {
    const name = typeof raw === "string" ? raw : raw.name;
    if (!name || isSystemLabelName(name)) continue;
    const color =
      typeof raw === "object" && raw && "color" in raw ? raw.color : undefined;
    out.push({ name, color });
  }
  return out;
}

function normalizedGiteaLabelColor(g: { color?: string }): string {
  return g.color ? `#${g.color.replace(/^#/, "")}` : "#6B7280";
}

async function syncGiteaLabelsToTask(
  taskId: string,
  workspaceId: string,
  giteaLabels: Array<{ name: string; color?: string }>,
) {
  const desiredNames = new Set(giteaLabels.map((l) => l.name));
  const existingRows = await db.query.labelTable.findMany({
    where: eq(labelTable.taskId, taskId),
  });

  const labelsToInsert = giteaLabels
    .filter((g) => !existingRows.some((row) => row.name === g.name))
    .map((g) => ({
      name: g.name,
      color: normalizedGiteaLabelColor(g),
      taskId,
      workspaceId,
    }));

  const colorToIds = new Map<string, string[]>();
  for (const g of giteaLabels) {
    if (isSystemLabelName(g.name)) continue;
    const row = existingRows.find((r) => r.name === g.name);
    if (!row) continue;
    const want = normalizedGiteaLabelColor(g);
    const have = row.color ? `#${row.color.replace(/^#/, "")}` : "#6B7280";
    if (have === want) continue;
    const list = colorToIds.get(want) ?? [];
    list.push(row.id);
    colorToIds.set(want, list);
  }

  for (const [color, ids] of colorToIds) {
    if (ids.length === 0) continue;
    await db
      .update(labelTable)
      .set({ color })
      .where(inArray(labelTable.id, ids));
  }

  if (labelsToInsert.length > 0) {
    await db
      .insert(labelTable)
      .values(labelsToInsert)
      .onConflictDoNothing({
        target: [labelTable.taskId, labelTable.name],
      });
  }

  const labelsToDelete = existingRows
    .filter(
      (row) => !desiredNames.has(row.name) && !isSystemLabelName(row.name),
    )
    .map((row) => row.id);

  if (labelsToDelete.length > 0) {
    await db.delete(labelTable).where(inArray(labelTable.id, labelsToDelete));
  }
}

export async function handleGiteaIssueLabeled(
  payload: IssueLabeledPayload,
  integrationId?: string,
) {
  const { issue, repository, label: addedLabel } = payload;

  const baseUrl = baseUrlFromRepositoryHtmlUrl(repository.html_url);
  if (!baseUrl) return;

  const owner = repoOwnerLogin(repository);
  const integrations = await findAllIntegrationsByGiteaRepo(
    baseUrl,
    owner,
    repository.name,
    integrationId,
  );

  for (const integration of integrations) {
    try {
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
        const statusResult = await updateTaskStatus(
          existingLink.taskId,
          status,
        );
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

      if (payload.action === "label_updated") {
        if (issue.labels === undefined) {
          continue;
        }

        const task = await db.query.taskTable.findFirst({
          where: eq(taskTable.id, existingLink.taskId),
          with: {
            project: true,
          },
        });
        if (task?.project?.workspaceId) {
          await syncGiteaLabelsToTask(
            existingLink.taskId,
            task.project.workspaceId,
            giteaLabelsForSync(issue.labels),
          );

          // label_updated carries the issue's whole label set and no single
          // added label, so the craft is derived from that set: a resolvable
          // `craft:` label wins, its absence clears the craft, and an
          // unrecognized one is left alone rather than wiping the current one.
          const craftLabelName = findCraftLabelName(issue.labels);

          if (craftLabelName) {
            const craft = await resolveCraftByName(
              task.project.workspaceId,
              craftLabelName,
            );

            if (craft) {
              await updateTaskCraft({
                id: existingLink.taskId,
                craftId: craft.id,
                currentUserId: null,
              });
            }
          } else if (task.craftId) {
            await updateTaskCraft({
              id: existingLink.taskId,
              craftId: null,
              currentUserId: null,
            });
          }
        }
        continue;
      }

      if (!addedLabel) {
        continue;
      }

      // Craft is single-select, so this keys off the label that was just
      // added or removed rather than scanning the issue's full label set.
      if (parseCraftLabelName(addedLabel.name)) {
        const craft = await resolveCraftLabel(
          existingLink.taskId,
          addedLabel.name,
        );

        if (payload.action === "labeled" && craft) {
          // An unrecognized craft name is ignored: the vocabulary is curated
          // in Kaneo, not seeded from the forge.
          await updateTaskCraft({
            id: existingLink.taskId,
            craftId: craft.id,
            currentUserId: null,
          });
        }

        if (payload.action === "unlabeled" && craft) {
          const craftTask = await db.query.taskTable.findFirst({
            where: eq(taskTable.id, existingLink.taskId),
          });

          // Only clear when the removed label is the craft the task actually
          // carries, so a stale `craft:` label doesn't wipe the real one.
          if (craftTask?.craftId === craft.id) {
            await updateTaskCraft({
              id: existingLink.taskId,
              craftId: null,
              currentUserId: null,
            });
          }
        }

        continue;
      }

      if (isSystemLabelName(addedLabel.name)) {
        continue;
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
            where: (table, { and, eq: e }) =>
              and(
                e(table.workspaceId, task.project.workspaceId),
                e(table.name, addedLabel.name),
                e(table.taskId, task.id),
              ),
          });

          if (!existingLabel) {
            const color = addedLabel.color
              ? `#${addedLabel.color.replace(/^#/, "")}`
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
          where: (table, { and, eq: e }) =>
            and(
              e(table.taskId, existingLink.taskId),
              e(table.name, addedLabel.name),
            ),
        });

        for (const label of labelsToDelete) {
          await db.delete(labelTable).where(eq(labelTable.id, label.id));
        }
      }
    } catch (error) {
      console.error("Gitea issue_labeled handler failed for integration", {
        integrationId: integration.id,
        issueNumber: issue.number,
        repository: `${owner}/${repository.name}`,
        error,
      });
    }
  }
}
