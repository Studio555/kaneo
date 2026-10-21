import { toCraftLabelName } from "../../system-labels";
import type { CraftLabelSyncEvent, PluginContext } from "../../types";
import type { GitHubConfig } from "../config";
import { findExternalLinksByTask } from "../services/link-manager";
import { getGithubApp, getInstallationIdForRepo } from "../utils/github-app";
import { ensureLabelsExist, removeLabel } from "../utils/labels";

/**
 * Replace (rename) or drop (delete) the `craft:` label across every linked
 * issue in this integration's project.
 *
 * The replacement label is created once for the repo up front, then added to
 * each issue directly. Going through `addLabelsToIssue` instead would re-probe
 * the label with a getLabel call on every task in the fan-out.
 */
export async function handleCraftLabelSync(
  event: CraftLabelSyncEvent,
  context: PluginContext,
): Promise<void> {
  const githubApp = getGithubApp();
  if (!githubApp) {
    return;
  }

  const config = context.config as GitHubConfig;
  const { repositoryOwner, repositoryName } = config;

  try {
    let installationId = config.installationId;
    if (!installationId) {
      installationId = await getInstallationIdForRepo(
        repositoryOwner,
        repositoryName,
      );
    }

    const octokit = await githubApp.getInstallationOctokit(installationId);
    const oldLabelName = toCraftLabelName(event.oldName);
    const newLabelName = event.newName ? toCraftLabelName(event.newName) : null;

    if (newLabelName) {
      await ensureLabelsExist(
        octokit,
        repositoryOwner,
        repositoryName,
        [newLabelName],
        false,
        undefined,
        event.color ? { [newLabelName]: event.color } : undefined,
      );
    }

    for (const taskId of event.taskIds) {
      try {
        const links = await findExternalLinksByTask(taskId);
        const issueLink = links.find(
          (link) =>
            link.integrationId === context.integrationId &&
            link.resourceType === "issue",
        );

        if (!issueLink) {
          continue;
        }

        const issueNumber = Number.parseInt(issueLink.externalId, 10);

        await removeLabel(
          octokit,
          repositoryOwner,
          repositoryName,
          issueNumber,
          oldLabelName,
        );

        if (newLabelName) {
          await octokit.rest.issues.addLabels({
            owner: repositoryOwner,
            repo: repositoryName,
            issue_number: issueNumber,
            labels: [newLabelName],
          });
        }
      } catch (error) {
        // One unreachable issue must not abandon the rest of the fan-out.
        console.error(
          `Failed to sync craft label for task ${taskId} in GitHub:`,
          error,
        );
      }
    }
  } catch (error) {
    console.error("Failed to sync craft label to GitHub:", error);
  }
}
