import type { PluginContext, TaskStatusChangedEvent } from "../../types";
import type { GitHubConfig } from "../config";
import {
  findExternalLinksByTask,
  updateExternalLink,
} from "../services/link-manager";
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

    if (!issueLink) {
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
    const issueNumber = Number.parseInt(issueLink.externalId, 10);
    const existingMetadata = parseLinkMetadata(issueLink.metadata, {
      externalLinkId: issueLink.id,
      source: "task_status_changed",
    });

    await removeLabel(
      octokit,
      repositoryOwner,
      repositoryName,
      issueNumber,
      `status:${event.oldStatus}`,
    );

    await addLabelsToIssue(
      octokit,
      repositoryOwner,
      repositoryName,
      issueNumber,
      [`status:${event.newStatus}`],
    );

    if (event.newStatus === "done") {
      await octokit.rest.issues.update({
        owner: repositoryOwner,
        repo: repositoryName,
        issue_number: issueNumber,
        state: "closed",
      });

      await updateExternalLink(issueLink.id, {
        metadata: {
          ...existingMetadata,
          state: "closed",
          lastOutboundStateSyncAt: Date.now(),
        },
      });
    } else if (event.oldStatus === "done" && event.newStatus !== "done") {
      await octokit.rest.issues.update({
        owner: repositoryOwner,
        repo: repositoryName,
        issue_number: issueNumber,
        state: "open",
      });

      await updateExternalLink(issueLink.id, {
        metadata: {
          ...existingMetadata,
          state: "open",
          lastOutboundStateSyncAt: Date.now(),
        },
      });
    }
  } catch (error) {
    console.error("Failed to update GitHub issue status:", error);
  }
}
