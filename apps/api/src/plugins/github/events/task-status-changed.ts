import type { PluginContext, TaskStatusChangedEvent } from "../../types";
import { isVirtualStatus } from "../../virtual-status";
import type { GitHubConfig } from "../config";
import {
  ensureIssueForTask,
  type ResolvedIssue,
} from "../services/issue-creator";
import {
  findExternalLinksByTask,
  updateExternalLink,
} from "../services/link-manager";
import { findTaskWithCraft } from "../services/task-service";
import { getGithubApp, getInstallationIdForRepo } from "../utils/github-app";
import { addLabelsToIssue, removeLabel } from "../utils/labels";
import { parseLinkMetadata } from "../utils/parse-link-metadata";

export async function handleTaskStatusChanged(
  event: TaskStatusChangedEvent,
  context: PluginContext,
): Promise<void> {
  const githubApp = getGithubApp();
  if (!githubApp) {
    return;
  }

  const config = context.config as GitHubConfig;
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
    if (!issueLink && isVirtualStatus(event.newStatus)) {
      return;
    }

    let installationId = config.installationId;
    if (!installationId) {
      installationId = await getInstallationIdForRepo(
        repositoryOwner,
        repositoryName,
      );
    }

    const octokit = await githubApp.getInstallationOctokit(installationId);

    let issue: ResolvedIssue;

    if (issueLink) {
      issue = {
        externalLinkId: issueLink.id,
        issueNumber: Number.parseInt(issueLink.externalId, 10),
        metadata: parseLinkMetadata(issueLink.metadata, {
          externalLinkId: issueLink.id,
          source: "task_status_changed",
        }),
        created: false,
      };
    } else {
      const task = await findTaskWithCraft(event.taskId);
      if (!task) {
        return;
      }

      const resolved = await ensureIssueForTask(
        octokit,
        {
          taskId: task.id,
          projectId: task.projectId,
          number: task.number,
          title: task.title,
          description: task.description,
          priority: task.priority,
          status: event.newStatus,
          craftName: task.craft?.name ?? null,
          craftColor: task.craft?.color ?? null,
          assigneeId: task.userId,
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
      await removeLabel(
        octokit,
        repositoryOwner,
        repositoryName,
        issue.issueNumber,
        `status:${event.oldStatus}`,
      );

      await addLabelsToIssue(
        octokit,
        repositoryOwner,
        repositoryName,
        issue.issueNumber,
        [`status:${event.newStatus}`],
      );
    }

    if (event.newStatus === "done") {
      await octokit.rest.issues.update({
        owner: repositoryOwner,
        repo: repositoryName,
        issue_number: issue.issueNumber,
        state: "closed",
      });

      await updateExternalLink(issue.externalLinkId, {
        metadata: {
          ...issue.metadata,
          state: "closed",
          lastOutboundStateSyncAt: Date.now(),
        },
      });
    } else if (event.oldStatus === "done" && event.newStatus !== "done") {
      await octokit.rest.issues.update({
        owner: repositoryOwner,
        repo: repositoryName,
        issue_number: issue.issueNumber,
        state: "open",
      });

      await updateExternalLink(issue.externalLinkId, {
        metadata: {
          ...issue.metadata,
          state: "open",
          lastOutboundStateSyncAt: Date.now(),
        },
      });
    }
  } catch (error) {
    console.error("Failed to update GitHub issue status:", error);
  }
}
