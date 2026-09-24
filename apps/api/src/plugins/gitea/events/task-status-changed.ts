import { isBacklogStatus } from "../../backlog-status";
import {
  findExternalLinksByTask,
  updateExternalLink,
} from "../../github/services/link-manager";
import { findTaskWithCraft } from "../../github/services/task-service";
import type { PluginContext, TaskStatusChangedEvent } from "../../types";
import type { GiteaConfig } from "../config";
import {
  ensureIssueForTask,
  type ResolvedIssue,
} from "../services/issue-creator";
import { createGiteaClient } from "../utils/gitea-api";
import { addLabelsToIssueGitea, removeLabelGitea } from "../utils/labels";

export async function handleTaskStatusChanged(
  event: TaskStatusChangedEvent,
  context: PluginContext,
): Promise<void> {
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

    // A task that has never left the backlog has no issue yet: task.created
    // deliberately skipped it. Moving into a board column is what commits it.
    if (
      !issueLink &&
      (await isBacklogStatus(event.projectId, event.newStatus))
    ) {
      return;
    }

    const client = createGiteaClient(config);

    let issue: ResolvedIssue;

    if (issueLink) {
      issue = {
        externalLinkId: issueLink.id,
        issueNumber: Number.parseInt(issueLink.externalId, 10),
        metadata: issueLink.metadata ? JSON.parse(issueLink.metadata) : {},
        created: false,
      };
    } else {
      const task = await findTaskWithCraft(event.taskId);
      if (!task) {
        return;
      }

      const resolved = await ensureIssueForTask(
        {
          taskId: task.id,
          title: task.title,
          description: task.description,
          priority: task.priority,
          status: event.newStatus,
          craftName: task.craft?.name ?? null,
          craftColor: task.craft?.color ?? null,
        },
        context,
      );

      if (!resolved) {
        return;
      }

      issue = resolved;
    }

    // An issue this handler opened is already labelled with the new status;
    // one that existed, or that task.created opened while this handler was in
    // flight, still carries the old one.
    if (!issue.created) {
      await removeLabelGitea(
        config,
        issue.issueNumber,
        `status:${event.oldStatus}`,
      );

      await addLabelsToIssueGitea(config, issue.issueNumber, [
        `status:${event.newStatus}`,
      ]);
    }

    if (event.newStatus === "done") {
      await client.updateIssue(
        repositoryOwner,
        repositoryName,
        issue.issueNumber,
        {
          state: "closed",
        },
      );

      await updateExternalLink(issue.externalLinkId, {
        metadata: {
          ...issue.metadata,
          state: "closed",
          lastOutboundStateSyncAt: Date.now(),
        },
      });
    } else if (event.oldStatus === "done" && event.newStatus !== "done") {
      await client.updateIssue(
        repositoryOwner,
        repositoryName,
        issue.issueNumber,
        {
          state: "open",
        },
      );

      await updateExternalLink(issue.externalLinkId, {
        metadata: {
          ...issue.metadata,
          state: "open",
          lastOutboundStateSyncAt: Date.now(),
        },
      });
    }
  } catch (error) {
    console.error("Failed to update Gitea issue status:", error);
  }
}
