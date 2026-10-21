import { syncTaskFieldLabels } from "../../sync/sync-task-field-labels";
import { canSyncTask } from "../../sync/eligibility";
import { syncLatestTaskValue } from "../../github/services/sync-latest-task-value";
import { resolveIssueStateChange } from "../../sync/issue-state-change";
import { findExternalLinksByTask } from "../../github/services/link-manager";
import type { PluginContext, TaskStatusChangedEvent } from "../../types";
import type { GiteaConfig } from "../config";
import { createGiteaClient } from "../utils/gitea-api";
import { addLabelsToIssueGitea, removeLabelGitea } from "../utils/labels";
import { handleTaskCreated } from "./task-created";

export async function handleTaskStatusChanged(
  event: TaskStatusChangedEvent,
  context: PluginContext,
): Promise<void> {
  if (
    !(await canSyncTask(
      event.taskId,
      context.integrationId,
      undefined,
      JSON.stringify(context.config),
    ))
  )
    return;

  const config = context.config as GiteaConfig;
  if (!config.baseUrl || !config.accessToken) {
    return;
  }

  const { repositoryOwner, repositoryName } = config;

  try {
    const links = await findExternalLinksByTask(event.taskId);
    const issueLink = links.find(
      (link) =>
        link.integrationId === context.integrationId &&
        link.resourceType === "issue",
    );

    // task.created skipped backlog tasks; moving into a board column is what
    // commits the task and opens its issue (handleTaskCreated re-reads it).
    if (!issueLink) {
      await handleTaskCreated(
        {
          taskId: event.taskId,
          projectId: event.projectId,
          userId: "",
          title: event.title,
          description: null,
          priority: null,
          status: event.newStatus,
          number: 0,
        },
        context,
      );
      return;
    }
    const client = createGiteaClient(config);
    const issueNumber = Number.parseInt(issueLink.externalId, 10);

    const currentValue = await syncTaskFieldLabels(
      event.taskId,
      context,
      issueLink,
      "gitea",
      "status",
      async ({ add, remove }, write) => {
        for (const name of remove)
          await removeLabelGitea(config, issueNumber, name, write, true);
        if (add.length)
          await addLabelsToIssueGitea(config, issueNumber, add, true, write);
      },
    );
    if (currentValue === undefined) return;
    const change = await resolveIssueStateChange(
      event.projectId,
      event.oldStatus,
      currentValue,
    );
    if (change) {
      const closing = change === "close";
      await syncLatestTaskValue(
        event.taskId,
        event.projectId,
        issueLink,
        "state",
        closing ? "closed" : "open",
        async (value) => {
          const response = await client.updateIssue(
            repositoryOwner,
            repositoryName,
            issueNumber,
            { state: value === "closed" ? "closed" : "open" },
          );
          return response?.updated_at;
        },
        async () =>
          (await client.getIssue(repositoryOwner, repositoryName, issueNumber))
            .state ?? "open",
        { type: "gitea", config: JSON.stringify(config) },
      );
    }
  } catch (error) {
    console.error("Failed to update Gitea issue status:", error);
  }
}
