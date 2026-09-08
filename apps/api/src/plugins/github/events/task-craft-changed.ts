import {
  addPendingCraftLabelOps,
  expectedCraftLabelOps,
  isOutboundCraftEcho,
  parseLinkMetadata,
  recordCraftSync,
} from "../../craft-sync-provenance";
import { toCraftLabelName } from "../../system-labels";
import type { PluginContext, TaskCraftChangedEvent } from "../../types";
import type { GitHubConfig } from "../config";
import {
  findExternalLinksByTask,
  updateExternalLink,
} from "../services/link-manager";
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

    const metadata = parseLinkMetadata(issueLink.metadata);

    // The issue already carries this craft because the issue is where it came
    // from. Writing the label again would only produce another webhook.
    if (isOutboundCraftEcho(metadata, event.newCraftName ?? null)) {
      return;
    }

    // Written before the first label call, not after the last one. Removing
    // the outgoing label makes GitHub deliver `unlabeled` immediately, and
    // that webhook can be handled while the add below is still in flight; if
    // the ledger were not already stored it would read the issue as having no
    // craft and clear the task.
    const ops = expectedCraftLabelOps(
      event.oldCraftName ?? null,
      event.newCraftName ?? null,
    );

    if (ops.length > 0) {
      await updateExternalLink(issueLink.id, {
        metadata: addPendingCraftLabelOps(
          recordCraftSync(metadata, {
            source: "kaneo",
            value: event.newCraftName ?? null,
          }),
          ops,
        ),
      });
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
