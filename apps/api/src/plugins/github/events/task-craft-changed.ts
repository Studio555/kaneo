import { toCraftLabelName } from "../../system-labels";
import type { PluginContext, TaskCraftChangedEvent } from "../../types";
import type { GitHubConfig } from "../config";
import { findExternalLinksByTask } from "../services/link-manager";
import { getGithubApp, getInstallationIdForRepo } from "../utils/github-app";
import { addLabelsToIssue, removeLabel } from "../utils/labels";

export async function handleTaskCraftChanged(
  event: TaskCraftChangedEvent,
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

    if (event.oldCraftName) {
      await removeLabel(
        octokit,
        repositoryOwner,
        repositoryName,
        issueNumber,
        toCraftLabelName(event.oldCraftName),
      );
    }

    if (event.newCraftName) {
      const labelName = toCraftLabelName(event.newCraftName);
      await addLabelsToIssue(
        octokit,
        repositoryOwner,
        repositoryName,
        issueNumber,
        [labelName],
        event.newCraftColor ? { [labelName]: event.newCraftColor } : undefined,
      );
    }
  } catch (error) {
    console.error("Failed to update GitHub issue craft:", error);
  }
}
